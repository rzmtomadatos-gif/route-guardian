/**
 * Utilidades puras para derivar información operativa a partir de los puntos
 * GPS persistidos por día y track (`trackGpsLogsByDay`).
 *
 * Reglas:
 * - Sin side effects.
 * - Sin mutación del estado.
 * - Si faltan puntos o el track está vacío, devolver estructura segura.
 * - Distancias en metros, tiempos en milisegundos.
 */

import type { Incident, Segment, TrackGpsPoint } from '@/types/route';
import { haversineMeters } from '@/utils/geo-distance';

/**
 * Devuelve el identificador "humano" preferido de un tramo para presentación.
 * Prioridad: companySegmentId → name → kmlId → id (fallback técnico).
 */
export function getSegmentDisplayId(segment: Segment | undefined | null): string {
  if (!segment) return '—';
  return (
    (segment.companySegmentId && segment.companySegmentId.trim()) ||
    (segment.name && segment.name.trim()) ||
    (segment.kmlId && segment.kmlId.trim()) ||
    segment.id
  );
}

/**
 * Devuelve nombre legible del tramo para tooltip/popup. Prioriza name,
 * pero garantiza que NUNCA devuelve el id interno como etiqueta principal
 * salvo último fallback.
 */
export function getSegmentDisplayName(segment: Segment | undefined | null): string {
  if (!segment) return '—';
  return (
    (segment.name && segment.name.trim()) ||
    (segment.companySegmentId && segment.companySegmentId.trim()) ||
    (segment.kmlId && segment.kmlId.trim()) ||
    segment.id
  );
}

/** Resumen métrico de un track GPS. */
export interface TrackGpsMetrics {
  pointCount: number;
  /** Distancia total recorrida en metros (suma de tramos consecutivos). */
  totalDistanceMeters: number;
  transportDistanceMeters: number;
  recordingDistanceMeters: number;
  /** Tiempo total en ms entre primer y último punto. */
  totalTimeMs: number;
  transportTimeMs: number;
  recordingTimeMs: number;
  /** Cantidad de segmentIds distintos detectados en fase recording. */
  distinctSegmentCount: number;
  /** Lista ordenada (por aparición) de segmentIds grabados. */
  recordedSegmentIds: string[];
  /** Conteo de puntos recording por segmentId. */
  pointsBySegmentId: Record<string, number>;
}

/** Cambio de fase dentro de un track. */
export interface PhaseTransition {
  /** Índice (0-based) en el array de puntos donde ocurre la transición. */
  index: number;
  from: 'transport' | 'recording';
  to: 'transport' | 'recording';
  point: TrackGpsPoint;
}

/** Hitos significativos de un track. */
export interface TrackGpsMilestones {
  first: TrackGpsPoint | null;
  last: TrackGpsPoint | null;
  phaseTransitions: PhaseTransition[];
  /** Puntos donde se inicia o cambia el segmentId grabado. */
  segmentBoundaries: Array<{
    index: number;
    segmentId: string;
    point: TrackGpsPoint;
  }>;
}

const EMPTY_METRICS: TrackGpsMetrics = {
  pointCount: 0,
  totalDistanceMeters: 0,
  transportDistanceMeters: 0,
  recordingDistanceMeters: 0,
  totalTimeMs: 0,
  transportTimeMs: 0,
  recordingTimeMs: 0,
  distinctSegmentCount: 0,
  recordedSegmentIds: [],
  pointsBySegmentId: {},
};

const EMPTY_MILESTONES: TrackGpsMilestones = {
  first: null,
  last: null,
  phaseTransitions: [],
  segmentBoundaries: [],
};

/** Asegura que el array recibido es válido para procesar. */
function safePoints(points: TrackGpsPoint[] | undefined | null): TrackGpsPoint[] {
  if (!Array.isArray(points)) return [];
  return points;
}

/**
 * Calcula métricas resumen de un track GPS.
 * Soporta tracks con solo `transport`, solo `recording` o vacíos.
 */
export function computeTrackGpsMetrics(points: TrackGpsPoint[] | undefined | null): TrackGpsMetrics {
  const arr = safePoints(points);
  if (arr.length === 0) return { ...EMPTY_METRICS, pointsBySegmentId: {}, recordedSegmentIds: [] };

  let totalDistance = 0;
  let transportDistance = 0;
  let recordingDistance = 0;
  let transportTime = 0;
  let recordingTime = 0;

  const seenSegments = new Set<string>();
  const orderedSegments: string[] = [];
  const pointsBySegment: Record<string, number> = {};

  for (let i = 0; i < arr.length; i++) {
    const p = arr[i];
    if (p.phase === 'recording' && p.segmentId) {
      pointsBySegment[p.segmentId] = (pointsBySegment[p.segmentId] ?? 0) + 1;
      if (!seenSegments.has(p.segmentId)) {
        seenSegments.add(p.segmentId);
        orderedSegments.push(p.segmentId);
      }
    }

    if (i === 0) continue;
    const prev = arr[i - 1];
    const dM = haversineMeters(prev, p);
    const dtMs = Math.max(0, new Date(p.timestamp).getTime() - new Date(prev.timestamp).getTime());

    totalDistance += dM;
    // Atribuir el segmento al punto destino (criterio operativo: fase del momento actual).
    if (p.phase === 'recording') {
      recordingDistance += dM;
      recordingTime += dtMs;
    } else {
      transportDistance += dM;
      transportTime += dtMs;
    }
  }

  const first = arr[0];
  const last = arr[arr.length - 1];
  const totalTimeMs = Math.max(
    0,
    new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime(),
  );

  return {
    pointCount: arr.length,
    totalDistanceMeters: totalDistance,
    transportDistanceMeters: transportDistance,
    recordingDistanceMeters: recordingDistance,
    totalTimeMs,
    transportTimeMs: transportTime,
    recordingTimeMs: recordingTime,
    distinctSegmentCount: seenSegments.size,
    recordedSegmentIds: orderedSegments,
    pointsBySegmentId: pointsBySegment,
  };
}

/** Calcula los hitos visuales del track (primero, último, cambios de fase, frontera de segmentos). */
export function computeTrackGpsMilestones(
  points: TrackGpsPoint[] | undefined | null,
): TrackGpsMilestones {
  const arr = safePoints(points);
  if (arr.length === 0) return { ...EMPTY_MILESTONES, phaseTransitions: [], segmentBoundaries: [] };

  const transitions: PhaseTransition[] = [];
  const boundaries: TrackGpsMilestones['segmentBoundaries'] = [];

  let lastSegmentId: string | null | undefined = undefined;

  for (let i = 0; i < arr.length; i++) {
    const p = arr[i];

    if (i > 0) {
      const prev = arr[i - 1];
      if (prev.phase !== p.phase) {
        transitions.push({ index: i, from: prev.phase, to: p.phase, point: p });
      }
    }

    const currentSeg = p.phase === 'recording' ? p.segmentId ?? null : null;
    if (currentSeg && currentSeg !== lastSegmentId) {
      boundaries.push({ index: i, segmentId: currentSeg, point: p });
    }
    // Solo actualizamos referencia si hay segmento activo, para no marcar
    // como nueva frontera el reentrar al mismo tras un transport intermedio.
    if (currentSeg !== null) {
      lastSegmentId = currentSeg;
    }
  }

  return {
    first: arr[0],
    last: arr[arr.length - 1],
    phaseTransitions: transitions,
    segmentBoundaries: boundaries,
  };
}

/** Lista de pares (day, track) con puntos disponibles, ordenada por día asc, track asc. */
export function listAvailableTracks(
  logsByDay: Record<number, Record<number, TrackGpsPoint[]>> | undefined | null,
): Array<{ day: number; track: number; pointCount: number }> {
  if (!logsByDay) return [];
  const out: Array<{ day: number; track: number; pointCount: number }> = [];
  for (const dayKey of Object.keys(logsByDay)) {
    const day = Number(dayKey);
    if (!Number.isFinite(day)) continue;
    const tracks = logsByDay[day] ?? {};
    for (const trackKey of Object.keys(tracks)) {
      const track = Number(trackKey);
      if (!Number.isFinite(track)) continue;
      const pts = tracks[track] ?? [];
      out.push({ day, track, pointCount: pts.length });
    }
  }
  return out.sort((a, b) => (a.day - b.day) || (a.track - b.track));
}

/** Lista de días disponibles (ordenada asc). */
export function listAvailableDays(
  logsByDay: Record<number, Record<number, TrackGpsPoint[]>> | undefined | null,
): number[] {
  if (!logsByDay) return [];
  return Object.keys(logsByDay)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
}

/** Acceso seguro al array de puntos de un (day, track). */
export function getTrackPoints(
  logsByDay: Record<number, Record<number, TrackGpsPoint[]>> | undefined | null,
  day: number,
  track: number,
): TrackGpsPoint[] {
  if (!logsByDay) return [];
  const tracks = logsByDay[day];
  if (!tracks) return [];
  const pts = tracks[track];
  return Array.isArray(pts) ? pts : [];
}
