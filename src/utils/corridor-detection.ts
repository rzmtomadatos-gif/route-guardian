import type { LatLng, Segment } from '@/types/route';

/**
 * Corridor detection — groups consecutive segments on the same road
 * so the optimizer can plan "full pass in one direction, then return".
 */

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

/** Max distance (m) between end of one segment and start of another to be "consecutive" */
const CONTINUITY_THRESHOLD = 400;

/** Bearing of a segment in degrees [0, 360) */
function segmentBearing(seg: Segment): number {
  const s = seg.coordinates[0];
  const e = seg.coordinates[seg.coordinates.length - 1];
  const dLng = ((e.lng - s.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos((e.lat * Math.PI) / 180);
  const x =
    Math.cos((s.lat * Math.PI) / 180) * Math.sin((e.lat * Math.PI) / 180) -
    Math.sin((s.lat * Math.PI) / 180) * Math.cos((e.lat * Math.PI) / 180) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Normalize a road name for grouping.
 * Strips direction suffixes, whitespace, case, common prefixes.
 */
function normalizeRoadName(seg: Segment): string {
  // Prefer kmlMeta.carretera, fall back to name
  let raw = seg.kmlMeta?.carretera || seg.name || '';
  raw = raw.trim().toLowerCase();
  // Remove common direction suffixes like "(sentido creciente)", "- ida", "- vuelta"
  raw = raw.replace(/\s*\(sentido\s+\w+\)\s*/g, '');
  raw = raw.replace(/\s*-\s*(ida|vuelta|creciente|decreciente)\s*/gi, '');
  // Remove trailing whitespace and normalize
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * Two segments share the same "axis" if they have the same normalized road name
 * OR if they are geometrically parallel/antiparallel and very close.
 */
function areOnSameAxis(a: Segment, b: Segment): boolean {
  const nameA = normalizeRoadName(a);
  const nameB = normalizeRoadName(b);

  // If both have meaningful names and they match → same axis
  if (nameA && nameB && nameA.length > 2 && nameA === nameB) return true;

  // Geometric check: segments are parallel/antiparallel and close
  const bearA = segmentBearing(a);
  const bearB = segmentBearing(b);
  const angleDiff = Math.abs(bearA - bearB) % 360;
  const isParallel = angleDiff < 25 || angleDiff > 335 || (angleDiff > 155 && angleDiff < 205);

  if (!isParallel) return false;

  // Check if midpoints are close (same road, different lanes)
  const midA = a.coordinates[Math.floor(a.coordinates.length / 2)];
  const midB = b.coordinates[Math.floor(b.coordinates.length / 2)];
  const midDist = haversine(midA, midB);

  return midDist < 300; // within 300m midpoint distance and parallel
}

/**
 * Check if two segments are geometrically consecutive
 * (end of one is near start/end of another).
 */
function areConsecutive(a: Segment, b: Segment): boolean {
  const aStart = a.coordinates[0];
  const aEnd = a.coordinates[a.coordinates.length - 1];
  const bStart = b.coordinates[0];
  const bEnd = b.coordinates[b.coordinates.length - 1];

  return (
    haversine(aEnd, bStart) < CONTINUITY_THRESHOLD ||
    haversine(aStart, bEnd) < CONTINUITY_THRESHOLD ||
    haversine(aEnd, bEnd) < CONTINUITY_THRESHOLD ||
    haversine(aStart, bStart) < CONTINUITY_THRESHOLD
  );
}

/** Are two segments going in roughly the same direction? */
function areSameDirection(a: Segment, b: Segment): boolean {
  const bearA = segmentBearing(a);
  const bearB = segmentBearing(b);
  const diff = Math.abs(bearA - bearB) % 360;
  return diff < 40 || diff > 320;
}

/** Are two segments going in opposite directions? */
function areOppositeDirection(a: Segment, b: Segment): boolean {
  const bearA = segmentBearing(a);
  const bearB = segmentBearing(b);
  const diff = Math.abs(bearA - bearB) % 360;
  return diff > 140 && diff < 220;
}

export interface Corridor {
  /** Unique corridor identifier */
  id: string;
  /** All segment IDs in this corridor */
  segmentIds: string[];
  /** Segments going in direction A (first detected direction) */
  directionA: string[];
  /** Segments going in direction B (opposite) */
  directionB: string[];
  /** Representative road name */
  roadName: string;
}

/**
 * Detect road corridors from a list of segments.
 * Returns corridors (groups of ≥2 segments on same road axis).
 * Segments not belonging to any corridor are excluded.
 */
export function detectCorridors(segments: Segment[]): Corridor[] {
  if (segments.length < 2) return [];

  // Build adjacency: which segments are on the same axis and consecutive
  const used = new Set<string>();
  const corridors: Corridor[] = [];
  let corridorIdx = 0;

  // Group by normalized road name first (fast path)
  const nameGroups = new Map<string, Segment[]>();
  for (const seg of segments) {
    const name = normalizeRoadName(seg);
    if (!name || name.length <= 2) continue;
    if (!nameGroups.has(name)) nameGroups.set(name, []);
    nameGroups.get(name)!.push(seg);
  }

  // For each name group, find connected components via geometric continuity
  for (const [roadName, group] of nameGroups) {
    if (group.length < 2) continue;

    // Build connectivity within the group
    const visited = new Set<number>();

    for (let i = 0; i < group.length; i++) {
      if (visited.has(i) || used.has(group[i].id)) continue;

      // BFS to find connected cluster
      const cluster: Segment[] = [group[i]];
      visited.add(i);
      const queue = [i];

      while (queue.length > 0) {
        const curr = queue.shift()!;
        for (let j = 0; j < group.length; j++) {
          if (visited.has(j) || used.has(group[j].id)) continue;
          if (areConsecutive(group[curr], group[j])) {
            visited.add(j);
            cluster.push(group[j]);
            queue.push(j);
          }
        }
      }

      if (cluster.length >= 2) {
        const corridor = buildCorridor(cluster, roadName, corridorIdx++);
        if (corridor) {
          corridor.segmentIds.forEach((id) => used.add(id));
          corridors.push(corridor);
        }
      }
    }
  }

  // Second pass: geometric-only detection for segments without clear names
  const unnamed = segments.filter((s) => !used.has(s.id));
  if (unnamed.length >= 2) {
    const visited2 = new Set<number>();
    for (let i = 0; i < unnamed.length; i++) {
      if (visited2.has(i)) continue;

      const cluster: Segment[] = [unnamed[i]];
      visited2.add(i);
      const queue = [i];

      while (queue.length > 0) {
        const curr = queue.shift()!;
        for (let j = 0; j < unnamed.length; j++) {
          if (visited2.has(j)) continue;
          if (areOnSameAxis(unnamed[curr], unnamed[j]) && areConsecutive(unnamed[curr], unnamed[j])) {
            visited2.add(j);
            cluster.push(unnamed[j]);
            queue.push(j);
          }
        }
      }

      if (cluster.length >= 2) {
        const name = normalizeRoadName(cluster[0]) || `corridor_${corridorIdx}`;
        const corridor = buildCorridor(cluster, name, corridorIdx++);
        if (corridor) {
          corridors.push(corridor);
        }
      }
    }
  }

  return corridors;
}

/**
 * Build a Corridor object, splitting segments into directionA/B.
 */
function buildCorridor(
  cluster: Segment[],
  roadName: string,
  idx: number
): Corridor | null {
  if (cluster.length < 2) return null;

  // Pick the first segment as reference direction
  const ref = cluster[0];
  const dirA: Segment[] = [];
  const dirB: Segment[] = [];

  for (const seg of cluster) {
    if (areSameDirection(ref, seg)) {
      dirA.push(seg);
    } else if (areOppositeDirection(ref, seg)) {
      dirB.push(seg);
    } else {
      // Ambiguous — assign to closest direction group
      dirA.push(seg);
    }
  }

  // Only form corridor if there are segments in both directions (the actual problem case)
  // OR if there are ≥3 consecutive same-direction segments worth chaining
  if (dirA.length === 0 && dirB.length === 0) return null;
  if (dirA.length + dirB.length < 2) return null;

  // Sort each direction by geographic continuity (chain them start→end)
  const chainByGeography = (segs: Segment[]): Segment[] => {
    if (segs.length <= 1) return segs;
    const result: Segment[] = [];
    const pending = [...segs];

    // Start with the segment whose start is closest to the corridor "beginning"
    // Use the segment with the smallest lat+lng as starting reference
    pending.sort((a, b) => {
      const aVal = a.coordinates[0].lat + a.coordinates[0].lng;
      const bVal = b.coordinates[0].lat + b.coordinates[0].lng;
      return aVal - bVal;
    });

    result.push(pending.shift()!);

    while (pending.length > 0) {
      const last = result[result.length - 1];
      const lastEnd = last.coordinates[last.coordinates.length - 1];
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < pending.length; i++) {
        const d = haversine(lastEnd, pending[i].coordinates[0]);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      result.push(pending.splice(bestIdx, 1)[0]);
    }

    return result;
  };

  const sortedA = chainByGeography(dirA);
  const sortedB = chainByGeography(dirB);

  return {
    id: `corridor_${idx}`,
    segmentIds: [...sortedA, ...sortedB].map((s) => s.id),
    directionA: sortedA.map((s) => s.id),
    directionB: sortedB.map((s) => s.id),
    roadName,
  };
}

/**
 * Given segments and detected corridors, produce an optimized order
 * that respects corridor continuity: complete one direction, then return.
 *
 * @param segments All segments to order
 * @param corridors Detected corridors
 * @param currentPos Current vehicle position
 * @returns Ordered segment IDs
 */
export function orderWithCorridors(
  segments: Segment[],
  corridors: Corridor[],
  currentPos: LatLng | null
): Segment[] {
  const corridorSegIds = new Set<string>();
  for (const c of corridors) {
    for (const id of c.segmentIds) corridorSegIds.add(id);
  }

  const segMap = new Map(segments.map((s) => [s.id, s]));

  // Build "units" — either a corridor (treated as atomic block) or a standalone segment
  interface Unit {
    type: 'corridor' | 'standalone';
    segments: Segment[]; // ordered segments within unit
    entryPoint: LatLng;
  }

  const units: Unit[] = [];

  // Add corridors as units
  for (const c of corridors) {
    const cSegs = c.directionA
      .map((id) => segMap.get(id))
      .filter(Boolean) as Segment[];
    const cSegsB = c.directionB
      .map((id) => segMap.get(id))
      .filter(Boolean) as Segment[];

    if (cSegs.length === 0 && cSegsB.length === 0) continue;

    // Determine entry point: start of directionA or end of directionB (whichever is closer to pos)
    const pos = currentPos || (cSegs[0]?.coordinates[0] ?? cSegsB[0]?.coordinates[0]);
    const entryA = cSegs[0]?.coordinates[0];
    const entryBEnd = cSegsB.length > 0
      ? cSegsB[cSegsB.length - 1].coordinates[cSegsB[cSegsB.length - 1].coordinates.length - 1]
      : null;

    let ordered: Segment[];
    if (entryA && entryBEnd && pos) {
      const distA = haversine(pos, entryA);
      const distB = haversine(pos, entryBEnd);
      if (distA <= distB) {
        // Enter from direction A start → do A then B reversed
        ordered = [...cSegs, ...cSegsB.reverse()];
      } else {
        // Enter from direction B end → do B reversed then A
        ordered = [...cSegsB.reverse(), ...cSegs];
      }
    } else {
      ordered = [...cSegs, ...cSegsB.reverse()];
    }

    units.push({
      type: 'corridor',
      segments: ordered,
      entryPoint: ordered[0].coordinates[0],
    });
  }

  // Add standalone segments
  for (const seg of segments) {
    if (!corridorSegIds.has(seg.id)) {
      units.push({
        type: 'standalone',
        segments: [seg],
        entryPoint: seg.coordinates[0],
      });
    }
  }

  // Order units by nearest-neighbor from current position
  const orderedUnits: Unit[] = [];
  const pendingUnits = [...units];
  let pos = currentPos || (pendingUnits[0]?.entryPoint ?? { lat: 0, lng: 0 });

  while (pendingUnits.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < pendingUnits.length; i++) {
      const d = haversine(pos, pendingUnits[i].entryPoint);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const chosen = pendingUnits.splice(bestIdx, 1)[0];

    // For corridors, re-evaluate entry direction based on current pos
    if (chosen.type === 'corridor' && chosen.segments.length > 1) {
      const firstStart = chosen.segments[0].coordinates[0];
      const lastEnd = chosen.segments[chosen.segments.length - 1].coordinates[
        chosen.segments[chosen.segments.length - 1].coordinates.length - 1
      ];
      // If we're closer to the last segment's end, reverse the entire corridor order
      if (haversine(pos, lastEnd) < haversine(pos, firstStart)) {
        chosen.segments.reverse();
      }
    }

    orderedUnits.push(chosen);
    const lastSeg = chosen.segments[chosen.segments.length - 1];
    pos = lastSeg.coordinates[lastSeg.coordinates.length - 1];
  }

  // Flatten
  return orderedUnits.flatMap((u) => u.segments);
}
