import type { LatLng, Segment } from '@/types/route';
import { detectCorridors, orderWithCorridors, type Corridor } from '@/utils/corridor-detection';

// ==================== Geometry Helpers ====================

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

/** Bearing from point A to point B */
function bearingFromTo(a: LatLng, b: LatLng): number {
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos((b.lat * Math.PI) / 180);
  const x =
    Math.cos((a.lat * Math.PI) / 180) * Math.sin((b.lat * Math.PI) / 180) -
    Math.sin((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Angular difference between two bearings, result in [0, 180] */
function bearingDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// ==================== Scoring System ====================

/**
 * Penalty weights in equivalent meters.
 * These represent the "cost" of operationally bad decisions,
 * normalized to meters so they can be summed with transition distance.
 *
 * Priority order (highest penalty = highest priority to avoid):
 * 1. Corridor re-entry (left and came back) — worst
 * 2. Corridor break (non-consecutive corridor segments)
 * 3. U-turn between consecutive segments
 * 4. Wrong approach direction
 */
const PENALTY = {
  /** Leaving a corridor and re-entering it later */
  CORRIDOR_REENTRY: 3000,
  /** Breaking corridor continuity (non-corridor segment between corridor segments) */
  CORRIDOR_BREAK: 2000,
  /** U-turn: bearing change > 150° between consecutive segments */
  U_TURN: 1500,
  /** Approaching a segment from a direction > 120° off its bearing */
  WRONG_APPROACH: 800,
};

/** Average speeds for time estimation (m/s) */
const SPEED = {
  SEGMENT: 14,     // ~50 km/h during recording
  TRANSITION: 11,  // ~40 km/h during transit
};

interface RouteScoring {
  transitionDistanceM: number;
  segmentDistanceM: number;
  totalDriveDistanceM: number;
  totalDriveTimeS: number;
  corridorIntegrityPenalty: number;
  wrongEntryPenalty: number;
  uTurnPenalty: number;
  maneuverPenalty: number;
  finalScore: number;
  /** Human-readable penalty breakdown */
  notes: string[];
}

function computeSegmentDistance(ordered: Segment[]): number {
  let total = 0;
  for (const seg of ordered) {
    for (let j = 0; j < seg.coordinates.length - 1; j++) {
      total += haversine(seg.coordinates[j], seg.coordinates[j + 1]);
    }
  }
  return total;
}

/**
 * Score a candidate route considering corridor integrity, maneuver quality,
 * and approach direction — not just raw distance.
 */
function scoreRoute(
  ordered: Segment[],
  startPos: LatLng,
  corridors: Corridor[],
): RouteScoring {
  const notes: string[] = [];

  if (ordered.length === 0) {
    return {
      transitionDistanceM: 0, segmentDistanceM: 0, totalDriveDistanceM: 0,
      totalDriveTimeS: 0, corridorIntegrityPenalty: 0, wrongEntryPenalty: 0,
      uTurnPenalty: 0, maneuverPenalty: 0, finalScore: 0, notes: [],
    };
  }

  // Build segment → corridor lookup
  const segCorridor = new Map<string, string>();
  for (const c of corridors) {
    for (const id of c.segmentIds) segCorridor.set(id, c.id);
  }

  // --- 1. Transition distance (dead km) ---
  let transitionDistanceM = haversine(startPos, segStart(ordered[0]));
  for (let i = 0; i < ordered.length - 1; i++) {
    transitionDistanceM += haversine(segEnd(ordered[i]), segStart(ordered[i + 1]));
  }

  // --- 2. Segment distance ---
  const segmentDistanceM = computeSegmentDistance(ordered);

  // --- 3. U-turn penalty ---
  let uTurnPenalty = 0;
  for (let i = 0; i < ordered.length - 1; i++) {
    const bearA = segmentBearing(ordered[i]);
    const bearB = segmentBearing(ordered[i + 1]);
    const diff = bearingDiff(bearA, bearB);
    if (diff > 150) {
      uTurnPenalty += PENALTY.U_TURN;
      notes.push(`U-turn: "${ordered[i].name}" → "${ordered[i + 1].name}" (${Math.round(diff)}°)`);
    }
  }

  // --- 4. Wrong approach penalty ---
  let wrongEntryPenalty = 0;
  let prevExit = startPos;
  for (let i = 0; i < ordered.length; i++) {
    const seg = ordered[i];
    const distToStart = haversine(prevExit, segStart(seg));
    // Only penalize if transition is long enough to matter
    if (distToStart > 200) {
      const approachBear = bearingFromTo(prevExit, segStart(seg));
      const segBear = segmentBearing(seg);
      const diff = bearingDiff(approachBear, segBear);
      if (diff > 120) {
        wrongEntryPenalty += PENALTY.WRONG_APPROACH;
        notes.push(`Aprox. incorrecta: "${seg.name}" (${Math.round(diff)}° desfase)`);
      }
    }
    prevExit = segEnd(seg);
  }

  // --- 5. Corridor integrity penalty ---
  let corridorIntegrityPenalty = 0;

  // 5a. Check for gaps in corridor segments (non-corridor segments between corridor segments)
  const corridorPositions = new Map<string, number[]>();
  for (let i = 0; i < ordered.length; i++) {
    const cId = segCorridor.get(ordered[i].id);
    if (cId) {
      if (!corridorPositions.has(cId)) corridorPositions.set(cId, []);
      corridorPositions.get(cId)!.push(i);
    }
  }

  for (const [cId, positions] of corridorPositions) {
    if (positions.length < 2) continue;
    for (let i = 1; i < positions.length; i++) {
      const gap = positions[i] - positions[i - 1];
      if (gap > 1) {
        const corridor = corridors.find((c) => c.id === cId);
        corridorIntegrityPenalty += PENALTY.CORRIDOR_BREAK;
        notes.push(`Corredor "${corridor?.roadName || cId}" roto (${gap - 1} tramos intercalados)`);
      }
    }
  }

  // 5b. Check for corridor re-entry (left a corridor and came back)
  const visitedCorridors = new Set<string>();
  let lastCorridor: string | null = null;
  for (const seg of ordered) {
    const cId = segCorridor.get(seg.id) || null;
    if (cId && cId !== lastCorridor) {
      if (visitedCorridors.has(cId)) {
        corridorIntegrityPenalty += PENALTY.CORRIDOR_REENTRY;
        const corridor = corridors.find((c) => c.id === cId);
        notes.push(`Re-entrada en corredor "${corridor?.roadName || cId}"`);
      }
      visitedCorridors.add(cId);
    }
    lastCorridor = cId;
  }

  // --- Totals ---
  const maneuverPenalty = uTurnPenalty + wrongEntryPenalty;
  const totalDriveDistanceM = segmentDistanceM + transitionDistanceM;
  const totalDriveTimeS = Math.round(
    segmentDistanceM / SPEED.SEGMENT + transitionDistanceM / SPEED.TRANSITION,
  );

  // Final score: transition distance + all operational penalties
  const finalScore = transitionDistanceM + corridorIntegrityPenalty + maneuverPenalty;

  return {
    transitionDistanceM,
    segmentDistanceM,
    totalDriveDistanceM,
    totalDriveTimeS,
    corridorIntegrityPenalty,
    wrongEntryPenalty,
    uTurnPenalty,
    maneuverPenalty,
    finalScore,
    notes,
  };
}

// ==================== Public Interfaces ====================

export interface CandidateRoute {
  id: string;
  label: string;
  description: string;
  segmentIds: string[];
  // Distance metrics
  totalDistanceM: number;
  transitionDistanceM: number;
  segmentDistanceM: number;
  // Operational scoring
  totalDriveTimeS: number;
  totalDriveDistanceM: number;
  maneuverPenalty: number;
  corridorIntegrityPenalty: number;
  wrongEntryPenalty: number;
  uTurnPenalty: number;
  finalScore: number;
  /** Debug notes explaining penalties */
  scoringNotes: string[];
}

export interface CandidateComparison {
  candidates: CandidateRoute[];
  chosenId: string;
  reason: string;
}

// ==================== Route Building (existing logic preserved) ====================

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
      ordered = [...[...segsB].reverse(), ...segsA];
    } else {
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
    const idx = units.findIndex(
      (u) =>
        u.type === 'corridor' &&
        u.segments.some((s) => corridors[startCorridorIdx].segmentIds.includes(s.id)),
    );
    if (idx > 0) {
      const [unit] = units.splice(idx, 1);
      units.unshift(unit);
    }
  }

  // Chain remaining units by nearest-neighbor (using segment endpoints, not midpoints)
  const result: Unit[] = [units[0]];
  const remaining = units.slice(1);
  let pos = segEnd(units[0].segments[units[0].segments.length - 1]);

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      // Check both entry points of the unit
      const entryStart = segStart(remaining[i].segments[0]);
      const entryEnd = segEnd(remaining[i].segments[remaining[i].segments.length - 1]);
      const d = Math.min(haversine(pos, entryStart), haversine(pos, entryEnd));
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

// ==================== Candidate Generation ====================

/**
 * Build a scored CandidateRoute from an ordered segment list.
 */
function buildCandidate(
  id: string,
  label: string,
  description: string,
  ordered: Segment[],
  startPos: LatLng,
  corridors: Corridor[],
): CandidateRoute {
  const scoring = scoreRoute(ordered, startPos, corridors);
  return {
    id,
    label,
    description,
    segmentIds: ordered.map((s) => s.id),
    totalDistanceM: scoring.totalDriveDistanceM,
    transitionDistanceM: scoring.transitionDistanceM,
    segmentDistanceM: scoring.segmentDistanceM,
    totalDriveTimeS: scoring.totalDriveTimeS,
    totalDriveDistanceM: scoring.totalDriveDistanceM,
    maneuverPenalty: scoring.maneuverPenalty,
    corridorIntegrityPenalty: scoring.corridorIntegrityPenalty,
    wrongEntryPenalty: scoring.wrongEntryPenalty,
    uTurnPenalty: scoring.uTurnPenalty,
    finalScore: scoring.finalScore,
    scoringNotes: scoring.notes,
  };
}

/**
 * Generate multiple candidate routes (up to 50 segments) and pick the best
 * using operational scoring (corridors > maneuver > dead km).
 *
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
        candidates:
          capped.length === 1
            ? [
                buildCandidate('single', 'Ruta única', 'Solo 1 tramo', capped, capped[0].coordinates[0], []),
              ]
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
  candidates.push(
    buildCandidate('nn', 'Ruta C (vecino cercano)', 'Nearest-neighbor sin corredores', nnRoute, base, corridors),
  );

  if (corridors.length > 0) {
    // Find the N closest corridors to start from (up to 3)
    const segMap = new Map(capped.map((s) => [s.id, s]));
    const corridorDistances = corridors.map((c, idx) => {
      let minDist = Infinity;
      for (const id of [...c.directionA, ...c.directionB]) {
        const seg = segMap.get(id);
        if (seg) {
          minDist = Math.min(minDist, haversine(base, segStart(seg)), haversine(base, segEnd(seg)));
        }
      }
      return { idx, dist: minDist };
    });
    corridorDistances.sort((a, b) => a.dist - b.dist);

    // --- Route A: Closest corridor, normal entry ---
    const closestIdx = corridorDistances[0].idx;
    const routeA = buildRouteFromCorridor(capped, corridors, closestIdx, base, false);
    candidates.push(
      buildCandidate(
        'corridor_closest',
        'Ruta A (corredor cercano)',
        `Entra por "${corridors[closestIdx].roadName}" extremo normal`,
        routeA,
        base,
        corridors,
      ),
    );

    // --- Route A-rev: Same corridor, reversed entry ---
    const routeARev = buildRouteFromCorridor(capped, corridors, closestIdx, base, true);
    candidates.push(
      buildCandidate(
        'corridor_closest_rev',
        'Ruta A-rev (reverso)',
        `Entra por "${corridors[closestIdx].roadName}" extremo opuesto`,
        routeARev,
        base,
        corridors,
      ),
    );

    // --- Route B: Second closest corridor ---
    if (corridorDistances.length >= 2) {
      const secondIdx = corridorDistances[1].idx;
      const routeB = buildRouteFromCorridor(capped, corridors, secondIdx, base, false);
      candidates.push(
        buildCandidate(
          'corridor_second',
          'Ruta B (2º corredor)',
          `Entra por "${corridors[secondIdx].roadName}"`,
          routeB,
          base,
          corridors,
        ),
      );
    }

    // --- Route D: Original corridor ordering ---
    const corridorOrder = orderWithCorridors(capped, corridors, base);
    candidates.push(
      buildCandidate(
        'corridor_original',
        'Ruta D (corredor original)',
        'Orden original por corredores',
        corridorOrder,
        base,
        corridors,
      ),
    );
  }

  // *** SORT BY FINAL SCORE (operational), NOT raw distance ***
  candidates.sort((a, b) => a.finalScore - b.finalScore);
  const best = candidates[0];

  // Build explanation
  const worst = candidates[candidates.length - 1];
  const saving = worst ? ((worst.finalScore - best.finalScore) / 1000).toFixed(1) : '0';
  const reason =
    candidates.length > 1
      ? `${best.label}: score ${(best.finalScore / 1000).toFixed(1)} km-eq ` +
        `(${(best.transitionDistanceM / 1000).toFixed(1)} km muertos` +
        `${best.corridorIntegrityPenalty > 0 ? ` + ${(best.corridorIntegrityPenalty / 1000).toFixed(1)} km pen.corredor` : ''}` +
        `${best.maneuverPenalty > 0 ? ` + ${(best.maneuverPenalty / 1000).toFixed(1)} km pen.maniobra` : ''}` +
        `) — ${saving} km-eq mejor que la peor`
      : 'Solo hay una ruta posible';

  return {
    order: best.segmentIds,
    comparison: {
      candidates,
      chosenId: best.id,
      reason,
    },
  };
}
