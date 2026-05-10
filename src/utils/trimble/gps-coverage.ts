/**
 * gps-coverage — motor de análisis de cobertura GPS sobre tramos para
 * generar capturas automáticas Trimble al cerrar una sesión de grabación.
 *
 * Reglas operativas duras (ver plan):
 *  - Punto válido: distancia al eje ≤ maxDistanceMeters y, si tiene
 *    accuracy declarada, accuracy ≤ maxAllowedAccuracyMeters.
 *  - Para auto-captura se exigen TODAS:
 *      matchedPoints ≥ minMatchedPoints (default 3)
 *      startProgress ≤ startToleranceRatio (default 0.15)
 *      endProgress   ≥ 1 - endToleranceRatio (default 0.85)
 *      coverageRatio ≥ minCoverageRatio (default 0.70)
 *      no debe existir hueco interior > maxGapRatio (default 0.30)
 *      dirección creciente (monótona en tiempo) — recorrido inverso queda
 *      como parcial con reason 'reverse_direction'.
 *  - Geometría insuficiente:
 *      coordinates.length < 2 o longitud < minSegmentLengthMeters → parcial
 *      con reason 'invalid_geometry'/'too_short'.
 */
import type { LatLng, Segment } from '@/types/route';
import type { TrimbleGpsPoint } from '@/types/trimble';
import { projectPointToPolyline } from '@/utils/trimble/gps-segment-matcher';

export interface AnalyzeOptions {
  maxDistanceMeters?: number;
  maxAllowedAccuracyMeters?: number;
  minCoverageRatio?: number;
  maxGapRatio?: number;
  startToleranceRatio?: number;
  endToleranceRatio?: number;
  minMatchedPoints?: number;
  minSegmentLengthMeters?: number;
  /** Buffer en metros para construir intervalos cubiertos a partir de cada match. */
  pointBufferMeters?: number;
}

export interface CoverageCaptured {
  segmentId: string;
  startedAt: string;
  endedAt: string;
  startPosition: LatLng;
  endPosition: LatLng;
  coverageRatio: number;
  startProgress: number;
  endProgress: number;
  matchedPoints: number;
}

export type PartialReason =
  | 'missing_start'
  | 'missing_end'
  | 'gap_too_large'
  | 'low_coverage'
  | 'too_few_points'
  | 'reverse_direction'
  | 'invalid_geometry'
  | 'too_short'
  | 'no_match';

export interface CoveragePartial {
  segmentId: string;
  coverageRatio: number;
  reason: PartialReason;
  matchedPoints: number;
}

export interface CoverageReport {
  captured: CoverageCaptured[];
  partial: CoveragePartial[];
  /** Puntos descartados por accuracy alta (no contaron en ningún tramo). */
  discardedByAccuracy: number;
}

interface MatchedPoint {
  point: TrimbleGpsPoint;
  progress: number;
  distance: number;
}

const DEFAULTS: Required<AnalyzeOptions> = {
  maxDistanceMeters: 25,
  maxAllowedAccuracyMeters: 25,
  minCoverageRatio: 0.7,
  maxGapRatio: 0.3,
  startToleranceRatio: 0.15,
  endToleranceRatio: 0.15,
  minMatchedPoints: 3,
  minSegmentLengthMeters: 20,
  pointBufferMeters: 12,
};

/**
 * Calcula la cobertura como fracción de longitud cubierta por intervalos
 * fusionados (no `max - min`, que daría falsos positivos con huecos).
 *
 * Devuelve también el mayor hueco interior encontrado (en ratio sobre la
 * longitud total) — útil para distinguir 'gap_too_large' vs 'low_coverage'.
 */
function computeCoverageFromProgresses(
  progresses: number[],
  bufferRatio: number,
): { coverageRatio: number; maxInteriorGap: number; minProgress: number; maxProgress: number } {
  if (progresses.length === 0) {
    return { coverageRatio: 0, maxInteriorGap: 0, minProgress: 0, maxProgress: 0 };
  }
  const sorted = [...progresses].sort((a, b) => a - b);
  const intervals: Array<[number, number]> = sorted.map((p) => [
    Math.max(0, p - bufferRatio),
    Math.min(1, p + bufferRatio),
  ]);
  // Fusionar.
  const merged: Array<[number, number]> = [];
  for (const itv of intervals) {
    const last = merged[merged.length - 1];
    if (last && itv[0] <= last[1]) {
      last[1] = Math.max(last[1], itv[1]);
    } else {
      merged.push([itv[0], itv[1]]);
    }
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
 * Heurística de dirección: si la regresión simple sobre (índice, progress)
 * tiene pendiente <= 0, consideramos recorrido inverso/no monótono.
 *
 * Se evalúa con los puntos ORDENADOS por timestamp para reflejar el orden
 * temporal real, no espacial.
 */
function isForwardDirection(matched: MatchedPoint[]): boolean {
  if (matched.length < 2) return true;
  const sorted = [...matched].sort(
    (a, b) => Date.parse(a.point.timestamp) - Date.parse(b.point.timestamp),
  );
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  const n = sorted.length;
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

function polylineLengthMeters(coords: ReadonlyArray<LatLng>): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const A = coords[i - 1];
    const B = coords[i];
    const R = 6371000;
    const dLat = ((B.lat - A.lat) * Math.PI) / 180;
    const dLng = ((B.lng - A.lng) * Math.PI) / 180;
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h =
      sinLat * sinLat +
      Math.cos((A.lat * Math.PI) / 180) * Math.cos((B.lat * Math.PI) / 180) * sinLng * sinLng;
    total += R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }
  return total;
}

export function analyzeTrimbleGpsCoverage(
  recordingPoints: ReadonlyArray<TrimbleGpsPoint>,
  candidateSegments: ReadonlyArray<Segment>,
  options: AnalyzeOptions = {},
): CoverageReport {
  const opts = { ...DEFAULTS, ...options };
  const captured: CoverageCaptured[] = [];
  const partial: CoveragePartial[] = [];

  // Filtrar puntos por accuracy ANTES de proyectar.
  const validPoints: TrimbleGpsPoint[] = [];
  let discardedByAccuracy = 0;
  for (const p of recordingPoints) {
    if (p.accuracy != null && p.accuracy > opts.maxAllowedAccuracyMeters) {
      discardedByAccuracy += 1;
      continue;
    }
    validPoints.push(p);
  }

  for (const seg of candidateSegments) {
    if (!seg.coordinates || seg.coordinates.length < 2) {
      partial.push({ segmentId: seg.id, coverageRatio: 0, reason: 'invalid_geometry', matchedPoints: 0 });
      continue;
    }
    const segLen = polylineLengthMeters(seg.coordinates);
    if (segLen < opts.minSegmentLengthMeters) {
      partial.push({ segmentId: seg.id, coverageRatio: 0, reason: 'too_short', matchedPoints: 0 });
      continue;
    }

    const matches: MatchedPoint[] = [];
    for (const p of validPoints) {
      const proj = projectPointToPolyline({ lat: p.lat, lng: p.lng }, seg.coordinates);
      if (!proj) continue;
      if (proj.distanceMeters > opts.maxDistanceMeters) continue;
      matches.push({ point: p, progress: proj.progress, distance: proj.distanceMeters });
    }

    if (matches.length === 0) {
      partial.push({ segmentId: seg.id, coverageRatio: 0, reason: 'no_match', matchedPoints: 0 });
      continue;
    }
    if (matches.length < opts.minMatchedPoints) {
      partial.push({ segmentId: seg.id, coverageRatio: 0, reason: 'too_few_points', matchedPoints: matches.length });
      continue;
    }

    const bufferRatio = opts.pointBufferMeters / segLen;
    const { coverageRatio, maxInteriorGap, minProgress, maxProgress } =
      computeCoverageFromProgresses(matches.map((m) => m.progress), bufferRatio);

    if (!isForwardDirection(matches)) {
      partial.push({ segmentId: seg.id, coverageRatio, reason: 'reverse_direction', matchedPoints: matches.length });
      continue;
    }
    if (minProgress > opts.startToleranceRatio) {
      partial.push({ segmentId: seg.id, coverageRatio, reason: 'missing_start', matchedPoints: matches.length });
      continue;
    }
    if (maxProgress < 1 - opts.endToleranceRatio) {
      partial.push({ segmentId: seg.id, coverageRatio, reason: 'missing_end', matchedPoints: matches.length });
      continue;
    }
    if (maxInteriorGap > opts.maxGapRatio) {
      partial.push({ segmentId: seg.id, coverageRatio, reason: 'gap_too_large', matchedPoints: matches.length });
      continue;
    }
    if (coverageRatio < opts.minCoverageRatio) {
      partial.push({ segmentId: seg.id, coverageRatio, reason: 'low_coverage', matchedPoints: matches.length });
      continue;
    }

    // Aceptado. startedAt/endedAt = primer/último match temporal.
    const sortedByTime = [...matches].sort(
      (a, b) => Date.parse(a.point.timestamp) - Date.parse(b.point.timestamp),
    );
    const first = sortedByTime[0];
    const last = sortedByTime[sortedByTime.length - 1];
    captured.push({
      segmentId: seg.id,
      startedAt: first.point.timestamp,
      endedAt: last.point.timestamp,
      startPosition: { lat: first.point.lat, lng: first.point.lng },
      endPosition: { lat: last.point.lat, lng: last.point.lng },
      coverageRatio,
      startProgress: minProgress,
      endProgress: maxProgress,
      matchedPoints: matches.length,
    });
  }

  return { captured, partial, discardedByAccuracy };
}
