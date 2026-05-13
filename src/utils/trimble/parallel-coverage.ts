/**
 * Helper para detectar si un tramo seleccionado tiene cobertura paralela
 * cercana (otro tramo `live_covered` / `live_partial` con geometría a
 * menos de ~30 m promedio). Útil en el overlay operativo para advertir
 * al operador de un posible falso positivo de cobertura cruzada.
 */
import { haversineMeters } from '@/utils/geo-distance';
import type { Segment as RouteSegment } from '@/types/route';

export interface LiveCoverageItemLike {
  segmentId: string;
  state: 'live_covered' | 'live_partial' | string;
}

const DEFAULT_THRESHOLD_M = 30;
const SAMPLE_STEP = 4; // muestreamos cada N puntos para evitar O(n²) total

function avgMinDistance(a: RouteSegment, b: RouteSegment): number {
  const ca = a.coordinates ?? [];
  const cb = b.coordinates ?? [];
  if (ca.length < 2 || cb.length < 2) return Infinity;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < ca.length; i += SAMPLE_STEP) {
    const pa = ca[i];
    let min = Infinity;
    for (let j = 0; j < cb.length; j += SAMPLE_STEP) {
      const pb = cb[j];
      const d = haversineMeters(pa, pb);
      if (d < min) min = d;
    }
    if (Number.isFinite(min)) {
      sum += min;
      count++;
    }
  }
  return count > 0 ? sum / count : Infinity;
}

export function hasNearbyParallelCoverage(
  targetSegmentId: string,
  segments: ReadonlyArray<RouteSegment>,
  liveItems: ReadonlyArray<LiveCoverageItemLike>,
  thresholdMeters: number = DEFAULT_THRESHOLD_M,
): boolean {
  const target = segments.find((s) => s.id === targetSegmentId);
  if (!target) return false;
  const coveredIds = new Set(
    liveItems
      .filter((l) => l.segmentId !== targetSegmentId && (l.state === 'live_covered' || l.state === 'live_partial'))
      .map((l) => l.segmentId),
  );
  if (coveredIds.size === 0) return false;
  for (const seg of segments) {
    if (!coveredIds.has(seg.id)) continue;
    const d = avgMinDistance(target, seg);
    if (d <= thresholdMeters) return true;
  }
  return false;
}
