import type { LatLng, Segment } from '@/types/route';
import { detectCorridors, orderWithCorridors } from '@/utils/corridor-detection';

function haversineDistance(a: LatLng, b: LatLng): number {
  const R = 6371e3;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;

  const h =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function segmentEndpoint(segment: Segment, end: 'start' | 'end'): LatLng {
  return end === 'start'
    ? segment.coordinates[0]
    : segment.coordinates[segment.coordinates.length - 1];
}

function segmentMidpoint(segment: Segment): LatLng {
  const mid = Math.floor(segment.coordinates.length / 2);
  return segment.coordinates[mid];
}

/**
 * Round-trip optimization: start near current position, fan out away from base,
 * then loop back so the last segments are close to base.
 *
 * Algorithm:
 * 1. Sort all segments by distance from base.
 * 2. Split into two halves: "outbound" (closer→farther) and "return" (farther→closer).
 * 3. Within each half, use nearest-neighbor chaining for smooth driving order.
 */
export function optimizeRoute(
  segments: Segment[],
  currentPos?: LatLng | null
): string[] {
  if (segments.length <= 1) return segments.map((s) => s.id);

  const base: LatLng = currentPos || segmentEndpoint(segments[0], 'start');

  // 1) Detect road corridors to avoid direction alternation
  const corridors = detectCorridors(segments);

  // 2) If corridors are found, use corridor-aware ordering
  if (corridors.length > 0) {
    const ordered = orderWithCorridors(segments, corridors, base);
    return ordered.map((s) => s.id);
  }

  // 3) Fallback: original round-trip optimization for non-corridor cases

  // Sort by distance from base (closest first)
  const sorted = [...segments].sort((a, b) => {
    const distA = Math.min(
      haversineDistance(base, segmentEndpoint(a, 'start')),
      haversineDistance(base, segmentEndpoint(a, 'end'))
    );
    const distB = Math.min(
      haversineDistance(base, segmentEndpoint(b, 'start')),
      haversineDistance(base, segmentEndpoint(b, 'end'))
    );
    return distA - distB;
  });

  // Split: first half outbound (close→far), second half return (far→close)
  const midIdx = Math.ceil(sorted.length / 2);
  const outbound = sorted.slice(0, midIdx);
  const returnLeg = sorted.slice(midIdx).reverse();

  // Chain each leg with nearest-neighbor for smooth transitions
  const chainNearestNeighbor = (segs: Segment[], startPos: LatLng): Segment[] => {
    if (segs.length <= 1) return segs;
    const pending = [...segs];
    const result: Segment[] = [];
    let pos = startPos;

    while (pending.length > 0) {
      let bestIdx = 0;
      let bestDist = Infinity;

      for (let i = 0; i < pending.length; i++) {
        const startDist = haversineDistance(pos, segmentEndpoint(pending[i], 'start'));
        const endDist = haversineDistance(pos, segmentEndpoint(pending[i], 'end'));
        const d = Math.min(startDist, endDist);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }

      const chosen = pending.splice(bestIdx, 1)[0];
      result.push(chosen);

      const distToStart = haversineDistance(pos, segmentEndpoint(chosen, 'start'));
      const distToEnd = haversineDistance(pos, segmentEndpoint(chosen, 'end'));
      pos = distToStart <= distToEnd
        ? segmentEndpoint(chosen, 'end')
        : segmentEndpoint(chosen, 'start');
    }

    return result;
  };

  const chainedOutbound = chainNearestNeighbor(outbound, base);
  const lastOutbound = chainedOutbound[chainedOutbound.length - 1];
  const returnStart = lastOutbound
    ? segmentEndpoint(lastOutbound, 'end')
    : base;
  const chainedReturn = chainNearestNeighbor(returnLeg, returnStart);

  return [...chainedOutbound, ...chainedReturn].map((s) => s.id);
}

export function getTotalDistance(segments: Segment[], order: string[]): number {
  let total = 0;
  const map = new Map(segments.map((s) => [s.id, s]));

  for (let i = 0; i < order.length - 1; i++) {
    const curr = map.get(order[i])!;
    const next = map.get(order[i + 1])!;
    total += haversineDistance(
      segmentEndpoint(curr, 'end'),
      segmentEndpoint(next, 'start')
    );
    for (let j = 0; j < curr.coordinates.length - 1; j++) {
      total += haversineDistance(curr.coordinates[j], curr.coordinates[j + 1]);
    }
  }
  if (order.length > 0) {
    const last = map.get(order[order.length - 1])!;
    for (let j = 0; j < last.coordinates.length - 1; j++) {
      total += haversineDistance(last.coordinates[j], last.coordinates[j + 1]);
    }
  }

  return total;
}

export function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

/**
 * Distance from a point to a line segment (between two coords).
 * Returns the minimum perpendicular or endpoint distance in meters.
 */
function pointToLineSegmentDistance(p: LatLng, a: LatLng, b: LatLng): number {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  if (dx === 0 && dy === 0) return haversineDistance(p, a);

  // Project p onto line a→b, clamped to [0,1]
  const t = Math.max(0, Math.min(1,
    ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / (dx * dx + dy * dy)
  ));
  const proj: LatLng = {
    lat: a.lat + t * dy,
    lng: a.lng + t * dx,
  };
  return haversineDistance(p, proj);
}

export function distanceToSegment(pos: LatLng, segment: Segment): number {
  if (segment.coordinates.length === 0) return Infinity;
  if (segment.coordinates.length === 1) return haversineDistance(pos, segment.coordinates[0]);

  let minDist = Infinity;
  for (let i = 0; i < segment.coordinates.length - 1; i++) {
    const d = pointToLineSegmentDistance(pos, segment.coordinates[i], segment.coordinates[i + 1]);
    if (d < 5) return d; // early exit: close enough
    if (d < minDist) minDist = d;
  }
  return minDist;
}
