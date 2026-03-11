import type { LatLng, Segment } from '@/types/route';
import { detectCorridors, orderWithCorridors, type Corridor } from '@/utils/corridor-detection';

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

/** Compute total route cost: segment lengths + transition distances */
function computeRouteCost(ordered: Segment[], startPos: LatLng): number {
  if (ordered.length === 0) return 0;
  let total = 0;

  // Distance from start to first segment
  total += haversine(startPos, segStart(ordered[0]));

  for (let i = 0; i < ordered.length; i++) {
    const seg = ordered[i];
    // Segment length
    for (let j = 0; j < seg.coordinates.length - 1; j++) {
      total += haversine(seg.coordinates[j], seg.coordinates[j + 1]);
    }
    // Transition to next
    if (i < ordered.length - 1) {
      total += haversine(segEnd(seg), segStart(ordered[i + 1]));
    }
  }

  return total;
}

export interface CandidateRoute {
  id: string;
  label: string;
  description: string;
  segmentIds: string[];
  totalDistanceM: number;
  transitionDistanceM: number;
  segmentDistanceM: number;
}

export interface CandidateComparison {
  candidates: CandidateRoute[];
  chosenId: string;
  reason: string;
}

/**
 * Build a corridor-aware nearest-neighbor route starting from a specific corridor.
 * Completes that corridor first, then chains to the nearest remaining unit.
 */
function buildRouteFromCorridor(
  segments: Segment[],
  corridors: Corridor[],
  startCorridorIdx: number,
  startPos: LatLng,
  reverseEntry: boolean,
): Segment[] {
  const segMap = new Map(segments.map((s) => [s.id, s]));
  const corridorSegIds = new Set(corridors.flatMap((c) => c.segmentIds));

  interface Unit {
    type: 'corridor' | 'standalone';
    segments: Segment[];
  }

  const units: Unit[] = [];

  // Build corridor units
  for (let ci = 0; ci < corridors.length; ci++) {
    const c = corridors[ci];
    const segsA = c.directionA.map((id) => segMap.get(id)).filter(Boolean) as Segment[];
    const segsB = c.directionB.map((id) => segMap.get(id)).filter(Boolean) as Segment[];
    if (segsA.length === 0 && segsB.length === 0) continue;

    let ordered: Segment[];
    if (ci === startCorridorIdx && reverseEntry) {
      // Enter from end: B reversed then A
      ordered = [...[...segsB].reverse(), ...segsA];
    } else {
      // Normal: A then B reversed
      ordered = [...segsA, ...[...segsB].reverse()];
    }

    units.push({ type: 'corridor', segments: ordered });
  }

  // Standalone segments
  for (const seg of segments) {
    if (!corridorSegIds.has(seg.id)) {
      units.push({ type: 'standalone', segments: [seg] });
    }
  }

  // Move the start corridor to the front
  if (startCorridorIdx >= 0 && startCorridorIdx < corridors.length) {
    const startCorridorId = corridors[startCorridorIdx].id;
    const idx = units.findIndex(
      (u) => u.type === 'corridor' && u.segments.some((s) =>
        corridors[startCorridorIdx].segmentIds.includes(s.id)
      )
    );
    if (idx > 0) {
      const [unit] = units.splice(idx, 1);
      units.unshift(unit);
    }
  }

  // Chain remaining units by nearest-neighbor
  const result: Unit[] = [units[0]];
  const remaining = units.slice(1);
  let pos = segEnd(units[0].segments[units[0].segments.length - 1]);

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const entry = remaining[i].segments[0].coordinates[0];
      const d = haversine(pos, entry);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const chosen = remaining.splice(bestIdx, 1)[0];

    // Re-evaluate corridor direction based on current pos
    if (chosen.type === 'corridor' && chosen.segments.length > 1) {
      const firstStart = segStart(chosen.segments[0]);
      const lastEnd = segEnd(chosen.segments[chosen.segments.length - 1]);
      if (haversine(pos, lastEnd) < haversine(pos, firstStart)) {
        chosen.segments.reverse();
      }
    }

    result.push(chosen);
    const lastSeg = chosen.segments[chosen.segments.length - 1];
    pos = segEnd(lastSeg);
  }

  return result.flatMap((u) => u.segments);
}

/**
 * Build a pure nearest-neighbor route (no corridor awareness).
 */
function buildNearestNeighborRoute(segments: Segment[], startPos: LatLng): Segment[] {
  const pending = [...segments];
  const result: Segment[] = [];
  let pos = startPos;

  while (pending.length > 0) {
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
    const distToStart = haversine(pos, segStart(chosen));
    const distToEnd = haversine(pos, segEnd(chosen));
    pos = distToStart <= distToEnd ? segEnd(chosen) : segStart(chosen);
  }

  return result;
}

/**
 * Compute transition-only distance (dead km between segments).
 */
function computeTransitionDistance(ordered: Segment[], startPos: LatLng): number {
  if (ordered.length === 0) return 0;
  let total = haversine(startPos, segStart(ordered[0]));
  for (let i = 0; i < ordered.length - 1; i++) {
    total += haversine(segEnd(ordered[i]), segStart(ordered[i + 1]));
  }
  return total;
}

function computeSegmentOnlyDistance(ordered: Segment[]): number {
  let total = 0;
  for (const seg of ordered) {
    for (let j = 0; j < seg.coordinates.length - 1; j++) {
      total += haversine(seg.coordinates[j], seg.coordinates[j + 1]);
    }
  }
  return total;
}

/**
 * Generate multiple candidate routes (up to 50 segments) and pick the best.
 * Returns ordered segment IDs and comparison data for debug.
 */
export function generateCandidateRoutes(
  segments: Segment[],
  currentPos: LatLng | null,
  maxSegments: number = 50,
): { order: string[]; comparison: CandidateComparison } {
  // Limit input
  const capped = segments.slice(0, maxSegments);
  if (capped.length <= 1) {
    return {
      order: capped.map((s) => s.id),
      comparison: {
        candidates: capped.length === 1
          ? [{
              id: 'single',
              label: 'Ruta única',
              description: 'Solo 1 tramo',
              segmentIds: capped.map((s) => s.id),
              totalDistanceM: 0,
              transitionDistanceM: 0,
              segmentDistanceM: 0,
            }]
          : [],
        chosenId: 'single',
        reason: 'Solo hay 1 tramo',
      },
    };
  }

  const base = currentPos || segStart(capped[0]);
  const corridors = detectCorridors(capped);
  const candidates: CandidateRoute[] = [];

  // --- Route C: Pure nearest-neighbor (baseline) ---
  const nnRoute = buildNearestNeighborRoute(capped, base);
  const nnSegDist = computeSegmentOnlyDistance(nnRoute);
  const nnTransDist = computeTransitionDistance(nnRoute, base);
  candidates.push({
    id: 'nn',
    label: 'Ruta C (vecino cercano)',
    description: 'Heurística nearest-neighbor pura sin corredores',
    segmentIds: nnRoute.map((s) => s.id),
    totalDistanceM: nnSegDist + nnTransDist,
    transitionDistanceM: nnTransDist,
    segmentDistanceM: nnSegDist,
  });

  if (corridors.length > 0) {
    // Find the N closest corridors to start from (up to 3)
    const corridorDistances = corridors.map((c, idx) => {
      const segMap = new Map(capped.map((s) => [s.id, s]));
      const firstA = c.directionA[0] ? segMap.get(c.directionA[0]) : null;
      const firstB = c.directionB[0] ? segMap.get(c.directionB[0]) : null;
      let minDist = Infinity;
      if (firstA) minDist = Math.min(minDist, haversine(base, segStart(firstA)));
      if (firstB) minDist = Math.min(minDist, haversine(base, segStart(firstB)));
      // Also check ends
      const lastA = c.directionA[c.directionA.length - 1] ? segMap.get(c.directionA[c.directionA.length - 1]) : null;
      const lastB = c.directionB[c.directionB.length - 1] ? segMap.get(c.directionB[c.directionB.length - 1]) : null;
      if (lastA) minDist = Math.min(minDist, haversine(base, segEnd(lastA)));
      if (lastB) minDist = Math.min(minDist, haversine(base, segEnd(lastB)));
      return { idx, dist: minDist };
    });
    corridorDistances.sort((a, b) => a.dist - b.dist);

    // --- Route A: Start from closest corridor, normal entry ---
    const closestIdx = corridorDistances[0].idx;
    const routeA = buildRouteFromCorridor(capped, corridors, closestIdx, base, false);
    const routeASegDist = computeSegmentOnlyDistance(routeA);
    const routeATransDist = computeTransitionDistance(routeA, base);
    candidates.push({
      id: 'corridor_closest',
      label: 'Ruta A (corredor cercano)',
      description: `Entra por corredor "${corridors[closestIdx].roadName}" extremo normal`,
      segmentIds: routeA.map((s) => s.id),
      totalDistanceM: routeASegDist + routeATransDist,
      transitionDistanceM: routeATransDist,
      segmentDistanceM: routeASegDist,
    });

    // --- Route A-rev: Same corridor, reversed entry ---
    const routeARev = buildRouteFromCorridor(capped, corridors, closestIdx, base, true);
    const routeARevSegDist = computeSegmentOnlyDistance(routeARev);
    const routeARevTransDist = computeTransitionDistance(routeARev, base);
    candidates.push({
      id: 'corridor_closest_rev',
      label: 'Ruta A-rev (corredor cercano, reverso)',
      description: `Entra por corredor "${corridors[closestIdx].roadName}" extremo opuesto`,
      segmentIds: routeARev.map((s) => s.id),
      totalDistanceM: routeARevSegDist + routeARevTransDist,
      transitionDistanceM: routeARevTransDist,
      segmentDistanceM: routeARevSegDist,
    });

    // --- Route B: Second closest corridor (if exists) ---
    if (corridorDistances.length >= 2) {
      const secondIdx = corridorDistances[1].idx;
      const routeB = buildRouteFromCorridor(capped, corridors, secondIdx, base, false);
      const routeBSegDist = computeSegmentOnlyDistance(routeB);
      const routeBTransDist = computeTransitionDistance(routeB, base);
      candidates.push({
        id: 'corridor_second',
        label: 'Ruta B (2º corredor)',
        description: `Entra por corredor "${corridors[secondIdx].roadName}"`,
        segmentIds: routeB.map((s) => s.id),
        totalDistanceM: routeBSegDist + routeBTransDist,
        transitionDistanceM: routeBTransDist,
        segmentDistanceM: routeBSegDist,
      });
    }

    // --- Route D: Original corridor ordering (orderWithCorridors) ---
    const corridorOrder = orderWithCorridors(capped, corridors, base);
    const corridorSegDist = computeSegmentOnlyDistance(corridorOrder);
    const corridorTransDist = computeTransitionDistance(corridorOrder, base);
    candidates.push({
      id: 'corridor_original',
      label: 'Ruta D (corredor original)',
      description: 'Orden original por corredores (orderWithCorridors)',
      segmentIds: corridorOrder.map((s) => s.id),
      totalDistanceM: corridorSegDist + corridorTransDist,
      transitionDistanceM: corridorTransDist,
      segmentDistanceM: corridorSegDist,
    });
  }

  // Pick best by total distance
  candidates.sort((a, b) => a.totalDistanceM - b.totalDistanceM);
  const best = candidates[0];

  return {
    order: best.segmentIds,
    comparison: {
      candidates,
      chosenId: best.id,
      reason: candidates.length > 1
        ? `${best.label}: ${(best.totalDistanceM / 1000).toFixed(1)} km (${(best.transitionDistanceM / 1000).toFixed(1)} km transición) — ${((candidates[candidates.length - 1].totalDistanceM - best.totalDistanceM) / 1000).toFixed(1)} km menos que la peor`
        : 'Solo hay una ruta posible',
    },
  };
}
