import type { LatLng, Segment } from '@/types/route';
import { detectCorridors } from '@/utils/corridor-detection';

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

/** Threshold in meters — a segment is "on the way" if its start or body is within this distance of the travel path */
const ON_THE_WAY_THRESHOLD = 150;

/** Number of sample points along the path to check for nearby segments */
const PATH_SAMPLE_COUNT = 10;

/**
 * Sample points along the straight line from A to B.
 */
function samplePath(a: LatLng, b: LatLng, count: number): LatLng[] {
  const points: LatLng[] = [];
  for (let i = 1; i < count; i++) {
    const t = i / count;
    points.push({
      lat: a.lat + (b.lat - a.lat) * t,
      lng: a.lng + (b.lng - a.lng) * t,
    });
  }
  return points;
}

/**
 * Minimum distance from a segment's start point (or any coordinate) to a sampled path.
 */
function minDistToPath(seg: Segment, pathPoints: LatLng[]): number {
  let minDist = Infinity;

  // Check segment start against path
  const start = segStart(seg);
  for (const p of pathPoints) {
    const d = haversine(start, p);
    if (d < minDist) minDist = d;
    if (minDist < 30) return minDist; // early exit
  }

  // Also check segment body (sample every few coords) against path
  const step = Math.max(1, Math.floor(seg.coordinates.length / 5));
  for (let ci = 0; ci < seg.coordinates.length; ci += step) {
    for (const p of pathPoints) {
      const d = haversine(seg.coordinates[ci], p);
      if (d < minDist) minDist = d;
      if (minDist < 30) return minDist;
    }
  }

  return minDist;
}

/**
 * Find segments that are "on the way" from pos to target among the remaining candidates.
 * Returns them sorted by distance along the path (closest to pos first).
 */
function findOnTheWaySegments(
  pos: LatLng,
  target: LatLng,
  candidates: Segment[],
  threshold: number = ON_THE_WAY_THRESHOLD,
): Segment[] {
  const pathDist = haversine(pos, target);
  // Only check for on-the-way if the target is far enough
  if (pathDist < 200) return [];

  const pathPoints = samplePath(pos, target, PATH_SAMPLE_COUNT);

  const onTheWay: { seg: Segment; distFromPos: number }[] = [];

  for (const seg of candidates) {
    const startDist = haversine(pos, segStart(seg));
    // Skip if the segment is farther from pos than the target (not really "on the way")
    if (startDist > pathDist * 1.2) continue;

    const distToPath = minDistToPath(seg, pathPoints);
    if (distToPath < threshold) {
      onTheWay.push({ seg, distFromPos: startDist });
    }
  }

  // Sort by distance from current position (closest first)
  onTheWay.sort((a, b) => a.distFromPos - b.distFromPos);
  return onTheWay.map((o) => o.seg);
}

/**
 * Compute a block of up to `blockSize` candidate segments using nearest-neighbor
 * heuristic from the current position, enhanced with "on the way" detection.
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

  // Detect corridors among candidates to avoid direction alternation
  const corridors = detectCorridors(candidates);

  if (corridors.length > 0 && currentPos) {
    // If the nearest candidate belongs to a corridor, pull the full corridor direction first
    const result = chainWithCorridorAwareness(candidates, corridors, currentPos, blockSize);
    if (result.length > 0) return result.map((s) => s.id);
  }

  if (candidates.length <= blockSize) {
    return chainWithOnTheWay(candidates, currentPos, candidates.length).map((s) => s.id);
  }

  return chainWithOnTheWay(candidates, currentPos, blockSize).map((s) => s.id);
}

/**
 * Corridor-aware block building: when selecting the next segment,
 * if it belongs to a corridor, pull remaining corridor segments in the same direction first.
 */
function chainWithCorridorAwareness(
  candidates: Segment[],
  corridors: ReturnType<typeof detectCorridors>,
  startPos: LatLng,
  limit: number,
): Segment[] {
  // Build lookup: segId → corridor + which direction
  const segCorridor = new Map<string, { corridor: typeof corridors[0]; dirGroup: 'A' | 'B' }>();
  for (const c of corridors) {
    for (const id of c.directionA) segCorridor.set(id, { corridor: c, dirGroup: 'A' });
    for (const id of c.directionB) segCorridor.set(id, { corridor: c, dirGroup: 'B' });
  }

  const pending = new Set(candidates.map((s) => s.id));
  const segMap = new Map(candidates.map((s) => [s.id, s]));
  const result: Segment[] = [];
  let pos = startPos;

  while (pending.size > 0 && result.length < limit) {
    // Find nearest pending segment
    let bestId = '';
    let bestDist = Infinity;
    for (const id of pending) {
      const seg = segMap.get(id)!;
      const d = haversine(pos, segStart(seg));
      if (d < bestDist) {
        bestDist = d;
        bestId = id;
      }
    }

    if (!bestId) break;

    const info = segCorridor.get(bestId);
    if (info) {
      // Pull all pending segments from the same corridor direction
      const sameDir = info.dirGroup === 'A' ? info.corridor.directionA : info.corridor.directionB;
      const oppositeDir = info.dirGroup === 'A' ? info.corridor.directionB : info.corridor.directionA;

      // Add same-direction segments in corridor order
      for (const id of sameDir) {
        if (!pending.has(id) || result.length >= limit) continue;
        const seg = segMap.get(id)!;
        result.push(seg);
        pending.delete(id);
        pos = segEnd(seg);
      }

      // Then add opposite-direction segments (reversed order for return trip)
      const oppReversed = [...oppositeDir].reverse();
      for (const id of oppReversed) {
        if (!pending.has(id) || result.length >= limit) continue;
        const seg = segMap.get(id)!;
        result.push(seg);
        pending.delete(id);
        pos = segEnd(seg);
      }
    } else {
      // Standalone segment
      const seg = segMap.get(bestId)!;
      result.push(seg);
      pending.delete(bestId);
      pos = segEnd(seg);
    }
  }

  return result;
}

/**
 * Enhanced nearest-neighbor chain that inserts "on the way" segments.
 * For each next candidate chosen by proximity, checks if other pending segments
 * lie on the path from current position to that candidate's start.
 */
function chainWithOnTheWay(
  segments: Segment[],
  startPos: LatLng | null,
  limit: number,
): Segment[] {
  const pending = [...segments];
  const result: Segment[] = [];
  let pos = startPos || segStart(pending[0]);

  while (pending.length > 0 && result.length < limit) {
    // Find nearest by start point
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < pending.length; i++) {
      const d = haversine(pos, segStart(pending[i]));
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    const nearest = pending[bestIdx];

    // Check if there are "on the way" segments between pos and the nearest candidate
    const othersExcludingNearest = pending.filter((_, i) => i !== bestIdx);
    const onTheWay = findOnTheWaySegments(pos, segStart(nearest), othersExcludingNearest);

    if (onTheWay.length > 0) {
      // Insert the first on-the-way segment instead
      const intercepted = onTheWay[0];
      const interceptIdx = pending.findIndex((s) => s.id === intercepted.id);
      if (interceptIdx !== -1) {
        pending.splice(interceptIdx, 1);
        result.push(intercepted);
        pos = segEnd(intercepted);
        continue;
      }
    }

    // No intercept — take the nearest as planned
    pending.splice(bestIdx, 1);
    result.push(nearest);
    pos = segEnd(nearest);
  }

  return result;
}
