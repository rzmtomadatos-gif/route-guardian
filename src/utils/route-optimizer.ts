import type { LatLng, Segment } from '@/types/route';

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
  const outbound = sorted.slice(0, midIdx); // already close→far
  const returnLeg = sorted.slice(midIdx).reverse(); // far→close (reversed to come back)

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

  // Chain outbound from base, then chain return from where outbound ended
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

export function distanceToSegment(pos: LatLng, segment: Segment): number {
  let minDist = Infinity;
  for (const coord of segment.coordinates) {
    const d = haversineDistance(pos, coord);
    if (d < minDist) minDist = d;
  }
  return minDist;
}
