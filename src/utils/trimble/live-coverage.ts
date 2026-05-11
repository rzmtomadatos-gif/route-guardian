/**
 * live-coverage — análisis de cobertura GPS Trimble EN VIVO durante una
 * `TrimbleRecordingSession` activa.
 *
 * IMPORTANTE: este módulo es PURO y NO modifica estado persistente. Devuelve
 * una vista provisional por tramo que la UI/mapa usa solo para colorear.
 * Solo `closeTrimbleRecording` puede consolidar `SegmentCapture gps_auto`.
 *
 * Reglas alineadas con `analyzeTrimbleGpsCoverage` (`gps-coverage.ts`):
 *  - Filtrado de puntos por accuracy (`maxAllowedAccuracyMeters`).
 *  - Mínimo de matches `minMatchedPoints` para `live_covered`.
 *  - Dirección creciente en el tiempo (`requireForwardDirection`).
 *  - Inicio/fin alcanzados, sin hueco interior excesivo, coverage >= min.
 *
 * El "tramo actual" se representa como bandera `isCurrent` (overlay visual)
 * y NO como un estado de color: el color principal del tramo siempre
 * refleja la cobertura real (covered/partial/not_started).
 */
import type { Segment } from '@/types/route';
import type { TrimbleGpsPoint } from '@/types/trimble';
import { projectPointToPolyline } from '@/utils/trimble/gps-segment-matcher';

export type TrimbleLiveCoverageStatus =
  | 'live_covered'
  | 'live_partial'
  | 'live_not_started';

export interface TrimbleLiveCoverageItem {
  segmentId: string;
  coverageRatio: number;
  matchedPoints: number;
  startProgress: number | null;
  endProgress: number | null;
  distanceMeters?: number | null;
  status: TrimbleLiveCoverageStatus;
  /** El tramo está actualmente bajo el GPS (overlay visual, no color base). */
  isCurrent?: boolean;
}

export interface BuildLiveCoverageOptions {
  maxDistanceMeters?: number;
  maxAllowedAccuracyMeters?: number;
  minMatchedPoints?: number;
  requireForwardDirection?: boolean;
  minCoverageRatio?: number;
  maxGapRatio?: number;
  startToleranceRatio?: number;
  endToleranceRatio?: number;
  pointBufferMeters?: number;
  /** Tramos preferidos (cola operativa). Solo afectan al desempate de "tramo actual". */
  preferredSegmentIds?: ReadonlySet<string>;
  /** Tramo actualmente bajo el GPS (proviene de findCurrentSegmentFromGps). */
  currentSegmentId?: string | null;
  /** Distancia máxima al eje del tramo "actual" para confirmarlo isCurrent. */
  currentMaxDistanceMeters?: number;
}

const DEFAULTS: Required<Omit<BuildLiveCoverageOptions, 'preferredSegmentIds' | 'currentSegmentId'>> = {
  maxDistanceMeters: 25,
  maxAllowedAccuracyMeters: 25,
  minMatchedPoints: 3,
  requireForwardDirection: true,
  minCoverageRatio: 0.7,
  maxGapRatio: 0.3,
  startToleranceRatio: 0.15,
  endToleranceRatio: 0.15,
  pointBufferMeters: 12,
  currentMaxDistanceMeters: 25,
};

interface Match {
  progress: number;
  distance: number;
  timestamp: number;
}

function computeCoverage(progresses: number[], bufferRatio: number) {
  if (progresses.length === 0) return { coverageRatio: 0, maxInteriorGap: 0, minProgress: 0, maxProgress: 0 };
  const sorted = [...progresses].sort((a, b) => a - b);
  const intervals: Array<[number, number]> = sorted.map((p) => [
    Math.max(0, p - bufferRatio),
    Math.min(1, p + bufferRatio),
  ]);
  const merged: Array<[number, number]> = [];
  for (const it of intervals) {
    const last = merged[merged.length - 1];
    if (last && it[0] <= last[1]) last[1] = Math.max(last[1], it[1]);
    else merged.push([it[0], it[1]]);
  }
  let covered = 0;
  for (const [a, b] of merged) covered += b - a;
  let maxGap = 0;
  for (let i = 1; i < merged.length; i++) {
    const gap = merged[i][0] - merged[i - 1][1];
    if (gap > maxGap) maxGap = gap;
  }
  return {
    coverageRatio: Math.max(0, Math.min(1, covered)),
    maxInteriorGap: maxGap,
    minProgress: sorted[0],
    maxProgress: sorted[sorted.length - 1],
  };
}

/**
 * Heurística (regresión simple sobre índice temporal vs progress).
 * Recorrido inverso ⇒ pendiente <= 0.
 */
function isForwardDirection(matches: Match[]): boolean {
  if (matches.length < 2) return true;
  const sorted = [...matches].sort((a, b) => a.timestamp - b.timestamp);
  const n = sorted.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += sorted[i].progress;
    sumXY += i * sorted[i].progress;
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return true;
  const slope = (n * sumXY - sumX * sumY) / denom;
  return slope > 0;
}

export function buildTrimbleLiveCoverage(
  recordingPoints: ReadonlyArray<TrimbleGpsPoint>,
  segments: ReadonlyArray<Segment>,
  options: BuildLiveCoverageOptions = {},
): Map<string, TrimbleLiveCoverageItem> {
  const opts = { ...DEFAULTS, ...options };
  const result = new Map<string, TrimbleLiveCoverageItem>();
  if (recordingPoints.length === 0 && !opts.currentSegmentId) return result;

  // Pre-filtrar puntos por accuracy (regla dura, idéntica a gps-coverage).
  const validPoints: TrimbleGpsPoint[] = [];
  for (const p of recordingPoints) {
    if (p.accuracy != null && p.accuracy > opts.maxAllowedAccuracyMeters) continue;
    validPoints.push(p);
  }

  // BBox prefilter (metros→grados grosero, válido fuera de los polos).
  const M_PER_DEG_LAT = 111_320;
  const toleranceDeg = opts.maxDistanceMeters / M_PER_DEG_LAT;

  for (const seg of segments) {
    if (!seg.coordinates || seg.coordinates.length < 2) continue;

    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const c of seg.coordinates) {
      if (c.lat < minLat) minLat = c.lat;
      if (c.lat > maxLat) maxLat = c.lat;
      if (c.lng < minLng) minLng = c.lng;
      if (c.lng > maxLng) maxLng = c.lng;
    }
    const meanLat = (minLat + maxLat) / 2;
    const lngTolerance = toleranceDeg / Math.max(0.1, Math.cos(meanLat * Math.PI / 180));
    minLat -= toleranceDeg; maxLat += toleranceDeg;
    minLng -= lngTolerance; maxLng += lngTolerance;

    const matches: Match[] = [];
    let lastDistance: number | null = null;
    for (const p of validPoints) {
      if (p.lat < minLat || p.lat > maxLat || p.lng < minLng || p.lng > maxLng) continue;
      const proj = projectPointToPolyline({ lat: p.lat, lng: p.lng }, seg.coordinates);
      if (!proj) continue;
      if (proj.distanceMeters > opts.maxDistanceMeters) continue;
      matches.push({
        progress: proj.progress,
        distance: proj.distanceMeters,
        timestamp: Date.parse(p.timestamp),
      });
      lastDistance = proj.distanceMeters;
    }

    const isCurrentCandidate = opts.currentSegmentId === seg.id;
    // Confirmar isCurrent: el último match real debe estar dentro del umbral
    // de proximidad. Si no hay matches, no marcamos isCurrent (el GPS está
    // demasiado lejos del eje aunque el caller crea que es el tramo).
    const isCurrent = isCurrentCandidate &&
      lastDistance != null &&
      lastDistance <= opts.currentMaxDistanceMeters;

    if (matches.length === 0) {
      // Si el caller insiste con currentSegmentId pero no hay matches válidos,
      // emitimos un item not_started solo si la distancia real lo permite
      // (heurística: no podemos verificarla sin matches → omitir para evitar
      // colorear un tramo que el GPS no está tocando).
      continue;
    }

    // Longitud para bufferRatio (probe barato).
    const probe = projectPointToPolyline(
      { lat: seg.coordinates[0].lat, lng: seg.coordinates[0].lng },
      seg.coordinates,
    );
    const segLen = probe?.polylineLengthMeters ?? 0;
    const bufferRatio = segLen > 0 ? opts.pointBufferMeters / segLen : 0.05;

    const { coverageRatio, maxInteriorGap, minProgress, maxProgress } =
      computeCoverage(matches.map((m) => m.progress), bufferRatio);

    const enoughPoints = matches.length >= opts.minMatchedPoints;
    const startOk = minProgress <= opts.startToleranceRatio;
    const endOk = maxProgress >= 1 - opts.endToleranceRatio;
    const gapOk = maxInteriorGap <= opts.maxGapRatio;
    const coverageOk = coverageRatio >= opts.minCoverageRatio;
    const directionOk = !opts.requireForwardDirection || isForwardDirection(matches);

    const status: TrimbleLiveCoverageStatus =
      enoughPoints && startOk && endOk && gapOk && coverageOk && directionOk
        ? 'live_covered'
        : 'live_partial';

    result.set(seg.id, {
      segmentId: seg.id,
      coverageRatio,
      matchedPoints: matches.length,
      startProgress: minProgress,
      endProgress: maxProgress,
      distanceMeters: lastDistance,
      status,
      isCurrent: isCurrent || undefined,
    });
  }

  return result;
}

/**
 * Color provisional por estado live (color base del tramo durante la sesión).
 * El "tramo actual" NO ocupa color: se representa como overlay/badge mediante
 * `TrimbleLiveCoverageItem.isCurrent`.
 */
export const TRIMBLE_LIVE_STATUS_COLOR: Record<TrimbleLiveCoverageStatus, string> = {
  live_covered: '#10b981',     // verde vivo (provisional, distinto de procesado_ok #22c55e)
  live_partial: '#fb923c',     // naranja/ámbar
  live_not_started: '#6b7280',
};

/** Color de overlay para el "tramo actual" (badge / borde). */
export const TRIMBLE_LIVE_CURRENT_OVERLAY_COLOR = '#facc15';
