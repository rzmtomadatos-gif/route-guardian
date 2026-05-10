/**
 * useTrimbleGpsLog — registro append-only del GPS en modo TRIMBLE_LIDAR.
 *
 * Reglas:
 *  - SOLO registra si `state.acquisitionMode === 'TRIMBLE_LIDAR'`
 *    && `state.activeMissionId` && `state.activeRunId`.
 *  - Persiste en `state.trimbleGpsLogsByRun[activeRunId]`.
 *  - Throttling por distancia ≥ 10 m respecto al último punto persistido del MISMO run.
 *  - `phase = 'capture'` SOLO si hay grabación continua activa
 *    (`state.activeTrimbleRecordingId`). La captura manual queda como
 *    emergencia y no activa la fase GPS de grabación continua.
 *  - Enriquecimiento por tramo más cercano (matchedSegmentId,
 *    distanceToMatchedSegmentMeters, progressOnMatchedSegment) usando
 *    findCurrentSegmentFromGps con preferencia por tramos en cola operativa.
 *  - Independiente de TrackSession: NO depende del flujo RST/Garmin.
 *  - En modos RST/GARMIN no hace nada.
 */
import { useEffect, useRef } from 'react';
import type { LatLng } from '@/types/route';
import type { TrimbleGpsPoint } from '@/types/trimble';
import { useRouteStateContext } from '@/context/RouteStateContext';
import { findCurrentSegmentFromGps } from '@/utils/trimble/gps-segment-matcher';

const MIN_DISTANCE_METERS = 10;

interface GeoSnapshot {
  position: LatLng | null;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
}

function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function useTrimbleGpsLog(geo: GeoSnapshot): void {
  const { state, appendTrimbleGpsPoint } = useRouteStateContext();
  const lastByRunRef = useRef<Map<string, LatLng>>(new Map());

  // Sembrar la cache desde el estado al cambiar de run.
  const runId = state.acquisitionMode === 'TRIMBLE_LIDAR' ? state.activeRunId : null;
  useEffect(() => {
    if (!runId) return;
    if (lastByRunRef.current.has(runId)) return;
    const points = state.trimbleGpsLogsByRun?.[runId];
    if (points && points.length > 0) {
      const last = points[points.length - 1];
      lastByRunRef.current.set(runId, { lat: last.lat, lng: last.lng });
    }
  }, [runId, state.trimbleGpsLogsByRun]);

  useEffect(() => {
    if (state.acquisitionMode !== 'TRIMBLE_LIDAR') return;
    const missionId = state.activeMissionId;
    const activeRunId = state.activeRunId;
    if (!missionId || !activeRunId) return;
    const pos = geo.position;
    if (!pos) return;
    if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) return;

    const lastPersisted = lastByRunRef.current.get(activeRunId);
    if (lastPersisted) {
      const dist = haversineMeters(lastPersisted, pos);
      if (dist < MIN_DISTANCE_METERS) return;
    }

    const recordingId = state.activeTrimbleRecordingId ?? null;
    const phase: TrimbleGpsPoint['phase'] = recordingId ? 'capture' : 'transport';

    // Enriquecimiento: detectar tramo más cercano para inteligencia operativa.
    let matchedSegmentId: string | null = null;
    let distanceToMatchedSegmentMeters: number | null = null;
    let progressOnMatchedSegment: number | null = null;
    const segments = state.route?.segments;
    if (segments && segments.length > 0) {
      // Preferimos los tramos del orden operativo (cola actual) cuando exista.
      const optimized = state.route?.optimizedOrder;
      const preferredSegmentIds = optimized && optimized.length > 0
        ? new Set(optimized.slice(0, 8))
        : undefined;
      const match = findCurrentSegmentFromGps(pos, segments, { preferredSegmentIds });
      matchedSegmentId = match.segmentId;
      distanceToMatchedSegmentMeters = match.distanceMeters;
      progressOnMatchedSegment = match.progress;
    }

    const point: TrimbleGpsPoint = {
      timestamp: new Date().toISOString(),
      lat: pos.lat,
      lng: pos.lng,
      accuracy: geo.accuracy ?? null,
      speed: geo.speed ?? null,
      heading: geo.heading ?? null,
      missionId,
      runId: activeRunId,
      phase,
      segmentId: matchedSegmentId,
      source: 'gps',
      recordingSessionId: recordingId,
      matchedSegmentId,
      distanceToMatchedSegmentMeters,
      progressOnMatchedSegment,
    };

    // Importante: solo actualizamos la caché local DESPUÉS de confirmar
    // que el append se ha aceptado.
    const result = appendTrimbleGpsPoint(point);
    if (result.ok) {
      lastByRunRef.current.set(activeRunId, { lat: pos.lat, lng: pos.lng });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.position]);
}
