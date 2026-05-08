/**
 * useTrimbleGpsLog — registro append-only del GPS en modo TRIMBLE_LIDAR.
 *
 * Reglas:
 *  - SOLO registra si `state.acquisitionMode === 'TRIMBLE_LIDAR'`
 *    && `state.activeMissionId` && `state.activeRunId`.
 *  - Persiste en `state.trimbleGpsLogsByRun[activeRunId]`.
 *  - Throttling por distancia ≥ 10 m respecto al último punto persistido del MISMO run.
 *  - `phase = 'capture'` si hay captura activa (derivada por findActiveCapture);
 *    si no, `phase = 'transport'`.
 *  - `segmentId` proviene de la captura activa.
 *  - Independiente de TrackSession: NO depende del flujo RST/Garmin.
 *  - En modos RST/GARMIN no hace nada.
 */
import { useEffect, useRef } from 'react';
import type { LatLng } from '@/types/route';
import type { TrimbleGpsPoint } from '@/types/trimble';
import { findActiveCapture } from '@/types/trimble';
import { useRouteStateContext } from '@/context/RouteStateContext';

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

    const activeCapture = findActiveCapture(state.trimbleSegmentCaptures ?? [], activeRunId);
    const phase: TrimbleGpsPoint['phase'] = activeCapture ? 'capture' : 'transport';

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
      segmentId: activeCapture?.segmentId ?? null,
      source: 'gps',
    };

    // Importante: solo actualizamos la caché local DESPUÉS de confirmar
    // que el append se ha aceptado. Si appendTrimbleGpsPoint rechaza el
    // punto (p.ej. límite de 100k por run), la caché debe quedar igual
    // para no divergir del estado real persistido.
    const result = appendTrimbleGpsPoint(point);
    if (result.ok) {
      lastByRunRef.current.set(activeRunId, { lat: pos.lat, lng: pos.lng });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.position]);
}

