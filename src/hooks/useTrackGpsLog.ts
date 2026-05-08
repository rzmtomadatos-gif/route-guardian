/**
 * useTrackGpsLog — registro append-only de la traza GPS real del vehículo.
 *
 * Reglas (ver custom_instructions y especificación de la fase):
 *  - Solo registra si `navigationActive === true` y existe `trackSession.active === true`.
 *  - El primer punto válido de un track se persiste siempre (no hay distancia previa).
 *  - A partir del segundo, solo se persiste si la distancia al ÚLTIMO punto del
 *    mismo `workDay`+`trackNumber` es ≥ 10 m.
 *  - `phase = 'recording'` si existe algún segmento con status `en_progreso`,
 *    en cuyo caso el punto guarda también `segmentId`. Si no, `phase = 'transport'`.
 *  - `trackNumber` y `workDay` salen de `state.trackSession` y `state.workDay`.
 *  - Si no hay GPS o no hay track activo → no se registra nada.
 *
 * Este hook NO modifica la lógica de navegación: solo observa y persiste.
 * Debe montarse en la capa alta (AppRoutes), donde ya conviven `geo`,
 * `routeState` y `navigationActive`.
 */
import { useEffect, useRef } from 'react';
import type { LatLng, TrackGpsPoint } from '@/types/route';
import { useRouteStateContext } from '@/context/RouteStateContext';

const MIN_DISTANCE_METERS = 10;

interface GeoSnapshot {
  position: LatLng | null;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
}

/** Haversine en metros. Robusto y suficiente para distancias cortas. */
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

export function useTrackGpsLog(geo: GeoSnapshot): void {
  const { state, appendTrackGpsPoint } = useRouteStateContext();

  // Cache local del último punto persistido por (workDay, trackNumber).
  // Evita recorrer el array completo en cada update del GPS.
  const lastByTrackRef = useRef<Map<string, LatLng>>(new Map());

  // Si cambia el track activo, sembramos la cache desde el estado para no
  // perder la referencia tras un remount o un cambio de día/track.
  const trackKey = state.trackSession?.active
    ? `${state.workDay}#${state.trackSession.trackNumber}`
    : null;

  useEffect(() => {
    if (!trackKey) return;
    if (lastByTrackRef.current.has(trackKey)) return;
    const [dayStr, trackStr] = trackKey.split('#');
    const day = Number(dayStr);
    const track = Number(trackStr);
    const points = state.trackGpsLogsByDay?.[day]?.[track];
    if (points && points.length > 0) {
      const last = points[points.length - 1];
      lastByTrackRef.current.set(trackKey, { lat: last.lat, lng: last.lng });
    }
  }, [trackKey, state.trackGpsLogsByDay]);

  useEffect(() => {
    // En modo TRIMBLE_LIDAR este hook NO registra nada — el GPS lo gestiona useTrimbleGpsLog.
    if (state.acquisitionMode === 'TRIMBLE_LIDAR') return;
    // Reglas 1, 5: navegación activa + track activo + GPS válido.
    if (!state.navigationActive) return;
    const session = state.trackSession;
    if (!session || !session.active) return;
    const pos = geo.position;
    if (!pos) return;
    if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) return;

    const workDay = state.workDay;
    const trackNumber = session.trackNumber;
    const key = `${workDay}#${trackNumber}`;

    // Regla 2: primer punto del track → siempre se guarda.
    // Regla del setter: comparar SIEMPRE contra el último persistido del mismo track.
    const lastPersisted = lastByTrackRef.current.get(key);
    if (lastPersisted) {
      const dist = haversineMeters(lastPersisted, pos);
      if (dist < MIN_DISTANCE_METERS) return;
    }

    // Regla 3: phase y segmentId.
    const inProgress = state.route?.segments.find((s) => s.status === 'en_progreso');
    const phase: TrackGpsPoint['phase'] = inProgress ? 'recording' : 'transport';

    const point: TrackGpsPoint = {
      timestamp: new Date().toISOString(),
      lat: pos.lat,
      lng: pos.lng,
      accuracy: geo.accuracy ?? null,
      speed: geo.speed ?? null,
      heading: geo.heading ?? null,
      workDay,
      trackNumber,
      phase,
      segmentId: phase === 'recording' && inProgress ? inProgress.id : null,
      source: 'gps',
    };

    // Actualizar cache ANTES del append para que renders intermedios no
    // disparen un segundo append con la misma posición.
    lastByTrackRef.current.set(key, { lat: pos.lat, lng: pos.lng });
    appendTrackGpsPoint(point);
    // `geo.position` es la dependencia que dispara cada nueva muestra.
    // El resto se lee siempre fresco desde el contexto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.position]);
}
