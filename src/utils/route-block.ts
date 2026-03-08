import type { LatLng, Segment } from '@/types/route';

export const ROUTE_BLOCK_SIZE = 4;

/** Haversine distance in meters */
function haversine(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function segStart(seg: Segment): LatLng {
  return seg.coordinates[0];
}

function segEnd(seg: Segment): LatLng {
  return seg.coordinates[seg.coordinates.length - 1];
}

/**
 * Compute a block of up to `blockSize` candidate segments using nearest-neighbor
 * heuristic from the current position.
 *
 * Candidates: pendiente or posible_repetir (needsRepeat), visible layers, recordable.
 */
export function computeRouteBlock(
  segments: Segment[],
  currentPos: LatLng | null,
  hiddenLayers: Set<string>,
  blockSize: number = ROUTE_BLOCK_SIZE,
): string[] {
  const candidates = segments.filter((s) => {
    if (s.nonRecordable) return false;
    if (s.layer && hiddenLayers.has(s.layer)) return false;
    if (s.status === 'pendiente') return true;
    if (s.status === 'posible_repetir' && s.needsRepeat) return true;
    return false;
  });

  if (candidates.length === 0) return [];
  if (candidates.length <= blockSize) {
    // Still sort by nearest-neighbor for optimal order
    return chainNearestNeighbor(candidates, currentPos).map((s) => s.id);
  }

  return chainNearestNeighbor(candidates, currentPos, blockSize).map((s) => s.id);
}

/** Nearest-neighbor chain starting from pos, returning up to `limit` segments */
function chainNearestNeighbor(
  segments: Segment[],
  startPos: LatLng | null,
  limit?: number,
): Segment[] {
  const pending = [...segments];
  const result: Segment[] = [];
  let pos = startPos || segStart(pending[0]);
  const max = limit ?? pending.length;

  while (pending.length > 0 && result.length < max) {
    let bestIdx = 0;
    let bestDist = Infinity;

    for (let i = 0; i < pending.length; i++) {
      const dStart = haversine(pos, segStart(pending[i]));
      const dEnd = haversine(pos, segEnd(pending[i]));
      const d = Math.min(dStart, dEnd);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    const chosen = pending.splice(bestIdx, 1)[0];
    result.push(chosen);

    // Move pos to the far end of chosen segment
    const dToStart = haversine(pos, segStart(chosen));
    const dToEnd = haversine(pos, segEnd(chosen));
    pos = dToStart <= dToEnd ? segEnd(chosen) : segStart(chosen);
  }

  return result;
}
