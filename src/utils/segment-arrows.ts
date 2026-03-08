import type { LatLng } from '@/types/route';

/** Haversine distance in meters */
function haversine(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Bearing from a to b in degrees */
function bearing(a: LatLng, b: LatLng): number {
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Total polyline length in meters */
function polylineLength(coords: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversine(coords[i - 1], coords[i]);
  }
  return total;
}

/** Interpolate position and angle at a fraction (0-1) along a polyline */
function interpolateAt(coords: LatLng[], fraction: number): { pos: LatLng; angle: number } | null {
  if (coords.length < 2) return null;
  const totalLen = polylineLength(coords);
  const targetDist = fraction * totalLen;
  let accumulated = 0;

  for (let i = 1; i < coords.length; i++) {
    const segLen = haversine(coords[i - 1], coords[i]);
    if (accumulated + segLen >= targetDist || i === coords.length - 1) {
      const ratio = segLen > 0 ? Math.min((targetDist - accumulated) / segLen, 1) : 0;
      return {
        pos: {
          lat: coords[i - 1].lat + (coords[i].lat - coords[i - 1].lat) * ratio,
          lng: coords[i - 1].lng + (coords[i].lng - coords[i - 1].lng) * ratio,
        },
        angle: bearing(coords[i - 1], coords[i]),
      };
    }
    accumulated += segLen;
  }
  return null;
}

export interface ArrowPosition {
  pos: LatLng;
  angle: number;
}

/**
 * Compute arrow positions for a segment based on its length.
 * Rules:
 * - < 150m  → 1 arrow at start
 * - 150-500m → 2 arrows (start, 50%)
 * - 500-1200m → 3 arrows (start, 33%, 66%)
 * - > 1200m → 4 arrows (start, 25%, 50%, 75%)
 * - Never more than 4 arrows per segment
 */
export function computeSegmentArrows(coords: LatLng[]): ArrowPosition[] {
  if (coords.length < 2) return [];

  const totalLen = polylineLength(coords);
  let fractions: number[];

  if (totalLen < 150) {
    fractions = [0.05]; // near start
  } else if (totalLen < 500) {
    fractions = [0.05, 0.5];
  } else if (totalLen < 1200) {
    fractions = [0.05, 0.33, 0.66];
  } else {
    fractions = [0.05, 0.25, 0.5, 0.75];
  }

  const arrows: ArrowPosition[] = [];
  for (const f of fractions) {
    const result = interpolateAt(coords, f);
    if (result) arrows.push(result);
  }
  return arrows;
}

/** Cache key for memoization */
const arrowCache = new Map<string, ArrowPosition[]>();

/** Memoized version — uses segment id as cache key, clears on new segment set */
export function getSegmentArrows(segId: string, coords: LatLng[]): ArrowPosition[] {
  const cached = arrowCache.get(segId);
  if (cached) return cached;
  const arrows = computeSegmentArrows(coords);
  arrowCache.set(segId, arrows);
  return arrows;
}

/** Clear the arrow cache (call when segments change) */
export function clearArrowCache(): void {
  arrowCache.clear();
}
