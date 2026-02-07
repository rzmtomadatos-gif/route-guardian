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

/** Nearest-neighbor heuristic for TSP, starting from current position or first segment */
export function optimizeRoute(
  segments: Segment[],
  currentPos?: LatLng | null
): string[] {
  if (segments.length <= 1) return segments.map((s) => s.id);

  const pending = [...segments];
  const order: string[] = [];
  let pos: LatLng = currentPos || segmentEndpoint(pending[0], 'start');

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
    order.push(chosen.id);

    const distToStart = haversineDistance(pos, segmentEndpoint(chosen, 'start'));
    const distToEnd = haversineDistance(pos, segmentEndpoint(chosen, 'end'));
    pos = distToStart <= distToEnd
      ? segmentEndpoint(chosen, 'end')
      : segmentEndpoint(chosen, 'start');
  }

  return order;
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
    // Add segment length
    for (let j = 0; j < curr.coordinates.length - 1; j++) {
      total += haversineDistance(curr.coordinates[j], curr.coordinates[j + 1]);
    }
  }
  // Add last segment length
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
