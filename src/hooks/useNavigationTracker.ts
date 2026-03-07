import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Segment, LatLng } from '@/types/route';

// ─── RST Operational States ──────────────────────────────────────────
export type NavOperationalState =
  | 'idle'
  | 'approaching'
  | 'strategic_point'
  | 'ready_f9_pre'
  | 'ref_300m'
  | 'ref_150m'
  | 'ref_30m'
  | 'ready_f5_start'
  | 'recording'
  | 'pre_alert'
  | 'deviated'
  | 'wrong_direction'
  | 'gps_unstable'
  | 'past_end'
  | 'end_ref_30m'
  | 'end_ref_150m'
  | 'end_ref_300m'
  | 'ready_f5_end'
  | 'ready_f7'
  | 'ready_f9_post'
  | 'invalidated'
  | 'interrupted'
  | 'completed';

// ─── Transition log entry ─────────────────────────────────────────────
export interface NavTransition {
  from: NavOperationalState;
  to: NavOperationalState;
  timestamp: string;
  position: LatLng | null;
  segmentId: string;
  reason: string;
  deviationMeters?: number;
  progressPercent?: number;
  distanceToStart?: number;
  distanceToEnd?: number;
  headingDelta?: number;
  speedKmh?: number;
}

// ─── Contiguous segment detection ─────────────────────────────────────
export interface ContiguousInfo {
  isContiguous: boolean;
  nextSegmentId: string | null;
  nextSegmentName: string | null;
  distanceBetween: number;
}

// ─── Segment run statistics (for export) ──────────────────────────────
export interface NavSegmentStats {
  segmentId: string;
  companySegmentId: string;
  validDistanceM: number;
  invalidDistanceM: number;
  validCoveragePercent: number;
  deviationCount: number;
  geometricRecoveryCount: number;
  wrongDirectionDetected: boolean;
  operationallyInvalidated: boolean;
  requiresReview: boolean;
  contiguousTransition: boolean;
  attemptNumber: number;
  gpsUnstableCount: number;
  maxDeviationM: number;
  maxHeadingDeltaDeg: number;
  approachSequenceValid: boolean;
}

// ─── Configurable thresholds ──────────────────────────────────────────
export interface NavThresholds {
  approachRadius: number;
  ref300m: number;
  ref150m: number;
  ref30m: number;

  /** Deviation: on-track ≤ this */
  onTrackThreshold: number;
  /** Deviation: pre-alert if > this for preAlertDurationMs */
  preAlertThreshold: number;
  /** Deviation: confirmed if > this for deviationDurationMs */
  deviationThreshold: number;
  /** Duration in ms the deviation must persist for pre-alert */
  preAlertDurationMs: number;
  /** Duration in ms the deviation must persist for confirmed deviation */
  deviationDurationMs: number;
  /** Recovery: back to on-track if ≤ this for recoveryDurationMs */
  recoveryThreshold: number;
  recoveryDurationMs: number;

  /** Heading: correct ≤ this (degrees) */
  headingCorrectDeg: number;
  /** Heading: pre-alert if > this (degrees) */
  headingPreAlertDeg: number;
  /** Heading: wrong direction if > this (degrees) sustained */
  headingWrongDeg: number;
  headingWrongDurationMs: number;

  /** Min speed to evaluate heading (m/s) */
  minSpeedForDirection: number;
  /** GPS accuracy filter — ignore samples worse than this */
  accuracyFilter: number;
  /** GPS jump detection — max reasonable displacement per second (m/s) */
  maxGpsJumpSpeed: number;
  /** Min consecutive GPS unstable samples to flag */
  gpsUnstableDurationMs: number;

  /** Contiguous threshold */
  contiguousThreshold: number;
  /** F5 ready radius */
  f5ReadyRadius: number;

  /** Min valid coverage % for clean completion */
  minValidCoveragePercent: number;
}

const DEFAULT_THRESHOLDS: NavThresholds = {
  approachRadius: 350,
  ref300m: 300,
  ref150m: 150,
  ref30m: 30,

  onTrackThreshold: 15,
  preAlertThreshold: 20,
  deviationThreshold: 30,
  preAlertDurationMs: 3000,
  deviationDurationMs: 5000,
  recoveryThreshold: 15,
  recoveryDurationMs: 3000,

  headingCorrectDeg: 45,
  headingPreAlertDeg: 45,
  headingWrongDeg: 90,
  headingWrongDurationMs: 3000,

  minSpeedForDirection: 1.5,
  accuracyFilter: 50,
  maxGpsJumpSpeed: 50, // ~180 km/h
  gpsUnstableDurationMs: 3000,

  contiguousThreshold: 200,
  f5ReadyRadius: 15,

  minValidCoveragePercent: 85,
};

// ─── Public state ─────────────────────────────────────────────────────
export interface NavTrackerState {
  operationalState: NavOperationalState;
  distanceToStart: number | null;
  distanceToEnd: number | null;
  etaToStart: number | null;
  progressPercent: number;
  distanceRemaining: number | null;
  totalDistance: number;
  speedKmh: number;
  deviationMeters: number;
  headingDelta: number;
  showApproachPrompt: boolean;
  closestPointIndex: number;
  transitions: NavTransition[];
  thresholds: NavThresholds;
  isInvalidated: boolean;
  contiguousInfo: ContiguousInfo;
  activeReference: 'ref_300m' | 'ref_150m' | 'ref_30m' | 'end_ref_300m' | 'end_ref_150m' | 'end_ref_30m' | null;
  stats: NavSegmentStats;
  /** Whether the approach sequence (300→150→30) was properly traversed */
  approachSequenceValid: boolean;
  /** Geometric recovery happened but operational validity not restored */
  geometricRecoveryOnly: boolean;
}

// ─── Geometry helpers ─────────────────────────────────────────────────

function haversine(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function projectOnSegment(p: LatLng, p1: LatLng, p2: LatLng): { proj: LatLng; t: number; dist: number } {
  const d12 = haversine(p1, p2);
  if (d12 < 0.1) return { proj: p1, t: 0, dist: haversine(p, p1) };
  const dx = p2.lng - p1.lng;
  const dy = p2.lat - p1.lat;
  const t = Math.max(0, Math.min(1, ((p.lng - p1.lng) * dx + (p.lat - p1.lat) * dy) / (dx * dx + dy * dy)));
  const proj: LatLng = { lat: p1.lat + t * dy, lng: p1.lng + t * dx };
  return { proj, t, dist: haversine(p, proj) };
}

function closestOnPolyline(pos: LatLng, coords: LatLng[]): { index: number; t: number; distance: number } {
  let minDist = Infinity;
  let minIdx = 0;
  let minT = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const { t, dist } = projectOnSegment(pos, coords[i], coords[i + 1]);
    if (dist < minDist) {
      minDist = dist;
      minIdx = i;
      minT = t;
    }
  }
  return { index: minIdx, t: minT, distance: minDist };
}

function cumulativeLengths(coords: LatLng[]): number[] {
  const lens = [0];
  for (let i = 1; i < coords.length; i++) {
    lens.push(lens[i - 1] + haversine(coords[i - 1], coords[i]));
  }
  return lens;
}

function progressAlongPolyline(cumLens: number[], index: number, t: number): number {
  if (index >= cumLens.length - 1) return cumLens[cumLens.length - 1];
  const segLen = cumLens[index + 1] - cumLens[index];
  return cumLens[index] + segLen * t;
}

/** Compute tangent bearing (degrees) at a given index+t on polyline */
function tangentBearing(coords: LatLng[], index: number): number {
  if (index >= coords.length - 1) index = coords.length - 2;
  if (index < 0) index = 0;
  const a = coords[index];
  const b = coords[index + 1];
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Angular difference in degrees [0, 180] */
function angleDiff(a: number, b: number): number {
  let d = Math.abs(((a - b + 180) % 360) - 180);
  if (d < 0) d += 360;
  return Math.min(d, 360 - d);
}

// ─── Time-based window helper ────────────────────────────────────────

class TimeWindow {
  private samples: { value: boolean; ts: number }[] = [];
  private durationMs: number;
  constructor(durationMs: number) {
    this.durationMs = durationMs;
  }
  push(value: boolean) {
    const now = Date.now();
    this.samples.push({ value, ts: now });
    // Prune old samples (keep 2x duration for safety)
    const cutoff = now - this.durationMs * 2;
    this.samples = this.samples.filter((s) => s.ts > cutoff);
  }
  /** All samples within the duration window are true */
  sustained(): boolean {
    if (this.samples.length < 2) return false;
    const now = Date.now();
    const windowStart = now - this.durationMs;
    const inWindow = this.samples.filter((s) => s.ts >= windowStart);
    if (inWindow.length < 2) return false;
    const spanMs = inWindow[inWindow.length - 1].ts - inWindow[0].ts;
    // Need at least 80% of duration covered
    return spanMs >= this.durationMs * 0.8 && inWindow.every((s) => s.value);
  }
  reset() {
    this.samples = [];
  }
}

// ─── Default stats ───────────────────────────────────────────────────

function defaultStats(seg?: Segment | null): NavSegmentStats {
  return {
    segmentId: seg?.id || '',
    companySegmentId: seg?.companySegmentId || '',
    validDistanceM: 0,
    invalidDistanceM: 0,
    validCoveragePercent: 0,
    deviationCount: 0,
    geometricRecoveryCount: 0,
    wrongDirectionDetected: false,
    operationallyInvalidated: false,
    requiresReview: false,
    contiguousTransition: false,
    attemptNumber: seg?.repeatNumber || 0,
    gpsUnstableCount: 0,
    maxDeviationM: 0,
    maxHeadingDeltaDeg: 0,
    approachSequenceValid: false,
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────

export function useNavigationTracker(
  activeSegment: Segment | null | undefined,
  currentPosition: LatLng | null | undefined,
  gpsSpeed: number | null,
  gpsHeading: number | null,
  gpsAccuracy: number | null,
  isRecording: boolean,
  navigationActive: boolean,
  customThresholds?: Partial<NavThresholds>,
  nextSegment?: Segment | null,
) {
  const thresholds = useMemo<NavThresholds>(
    () => ({ ...DEFAULT_THRESHOLDS, ...customThresholds }),
    [customThresholds],
  );

  const [state, setState] = useState<NavTrackerState>({
    operationalState: 'idle',
    distanceToStart: null,
    distanceToEnd: null,
    etaToStart: null,
    progressPercent: 0,
    distanceRemaining: null,
    totalDistance: 0,
    speedKmh: 0,
    deviationMeters: 0,
    headingDelta: 0,
    showApproachPrompt: false,
    closestPointIndex: 0,
    transitions: [],
    thresholds,
    isInvalidated: false,
    contiguousInfo: { isContiguous: false, nextSegmentId: null, nextSegmentName: null, distanceBetween: Infinity },
    activeReference: null,
    stats: defaultStats(),
    approachSequenceValid: false,
    geometricRecoveryOnly: false,
  });

  // Time-based windows
  const preAlertWindowRef = useRef(new TimeWindow(thresholds.preAlertDurationMs));
  const deviationWindowRef = useRef(new TimeWindow(thresholds.deviationDurationMs));
  const recoveryWindowRef = useRef(new TimeWindow(thresholds.recoveryDurationMs));
  const wrongDirWindowRef = useRef(new TimeWindow(thresholds.headingWrongDurationMs));
  const gpsUnstableWindowRef = useRef(new TimeWindow(thresholds.gpsUnstableDurationMs));

  const prevIndexRef = useRef<number | null>(null);
  const prevTRef = useRef<number>(0);
  const prevPositionRef = useRef<LatLng | null>(null);
  const prevTimestampRef = useRef<number>(0);
  const promptDismissedRef = useRef<string | null>(null);
  const transitionsRef = useRef<NavTransition[]>([]);
  const currentStateRef = useRef<NavOperationalState>('idle');
  const invalidatedRef = useRef(false);
  const statsRef = useRef<NavSegmentStats>(defaultStats());
  const prevProgressRef = useRef<number>(0);
  const geometricRecoveryOnlyRef = useRef(false);

  // Approach sequence tracking
  const approachSeqRef = useRef({
    passed300: false,
    passed150: false,
    passed30: false,
    sequenceValid: false,
  });

  const segIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeSegment?.id !== segIdRef.current) {
      segIdRef.current = activeSegment?.id ?? null;
      preAlertWindowRef.current = new TimeWindow(thresholds.preAlertDurationMs);
      deviationWindowRef.current = new TimeWindow(thresholds.deviationDurationMs);
      recoveryWindowRef.current = new TimeWindow(thresholds.recoveryDurationMs);
      wrongDirWindowRef.current = new TimeWindow(thresholds.headingWrongDurationMs);
      gpsUnstableWindowRef.current = new TimeWindow(thresholds.gpsUnstableDurationMs);
      prevIndexRef.current = null;
      prevTRef.current = 0;
      prevPositionRef.current = null;
      prevTimestampRef.current = 0;
      transitionsRef.current = [];
      currentStateRef.current = 'idle';
      invalidatedRef.current = false;
      geometricRecoveryOnlyRef.current = false;
      statsRef.current = defaultStats(activeSegment);
      prevProgressRef.current = 0;
      approachSeqRef.current = { passed300: false, passed150: false, passed30: false, sequenceValid: false };
    }
  }, [activeSegment?.id, thresholds]);

  const cumLens = useMemo(() => {
    if (!activeSegment || activeSegment.coordinates.length < 2) return [0];
    return cumulativeLengths(activeSegment.coordinates);
  }, [activeSegment?.id, activeSegment?.coordinates.length]);

  const totalDist = cumLens[cumLens.length - 1];

  // Contiguous segment detection
  const contiguousInfo = useMemo<ContiguousInfo>(() => {
    if (!activeSegment || !nextSegment) {
      return { isContiguous: false, nextSegmentId: null, nextSegmentName: null, distanceBetween: Infinity };
    }
    const endOfCurrent = activeSegment.coordinates[activeSegment.coordinates.length - 1];
    const startOfNext = nextSegment.coordinates[0];
    const dist = haversine(endOfCurrent, startOfNext);
    return {
      isContiguous: dist <= thresholds.contiguousThreshold,
      nextSegmentId: nextSegment.id,
      nextSegmentName: nextSegment.name,
      distanceBetween: dist,
    };
  }, [activeSegment?.id, nextSegment?.id, thresholds.contiguousThreshold]);

  const logTransition = useCallback((
    from: NavOperationalState,
    to: NavOperationalState,
    reason: string,
    pos: LatLng | null,
    extra?: Partial<NavTransition>,
  ) => {
    if (from === to) return;
    const entry: NavTransition = {
      from,
      to,
      timestamp: new Date().toISOString(),
      position: pos ? { lat: pos.lat, lng: pos.lng } : null,
      segmentId: activeSegment?.companySegmentId || activeSegment?.id || '',
      reason,
      ...extra,
    };
    transitionsRef.current = [...transitionsRef.current, entry];
    currentStateRef.current = to;
  }, [activeSegment?.id, activeSegment?.companySegmentId]);

  // ─── Main tracking loop ─────────────────────────────────────────────
  useEffect(() => {
    if (!activeSegment || !currentPosition || !navigationActive) {
      if (currentStateRef.current !== 'idle') {
        logTransition(currentStateRef.current, 'idle', 'navigation_deactivated', currentPosition ?? null);
      }
      setState((s) => ({
        ...s,
        operationalState: 'idle',
        showApproachPrompt: false,
        transitions: transitionsRef.current,
        thresholds,
        isInvalidated: false,
        contiguousInfo,
        activeReference: null,
        stats: statsRef.current,
        approachSequenceValid: approachSeqRef.current.sequenceValid,
        geometricRecoveryOnly: false,
      }));
      return;
    }

    const coords = activeSegment.coordinates;
    if (coords.length < 2) return;

    const now = Date.now();
    const startPoint = coords[0];
    const endPoint = coords[coords.length - 1];
    const distToStart = haversine(currentPosition, startPoint);
    const distToEnd = haversine(currentPosition, endPoint);
    const speed = gpsSpeed != null && gpsSpeed >= 0 ? gpsSpeed : 0;
    const speedKmh = speed * 3.6;
    const eta = speed > 0.5 ? distToStart / speed : null;
    const prev = currentStateRef.current;
    const accuracy = gpsAccuracy ?? 999;

    // ── GPS jump detection ──────────────────────────────────────────
    let gpsJumpDetected = false;
    if (prevPositionRef.current && prevTimestampRef.current > 0) {
      const dt = (now - prevTimestampRef.current) / 1000;
      if (dt > 0.1) {
        const displacement = haversine(prevPositionRef.current, currentPosition);
        const impliedSpeed = displacement / dt;
        if (impliedSpeed > thresholds.maxGpsJumpSpeed) {
          gpsJumpDetected = true;
        }
      }
    }

    const isGpsUnreliable = accuracy > thresholds.accuracyFilter || gpsJumpDetected;
    gpsUnstableWindowRef.current.push(isGpsUnreliable);
    const gpsUnstableSustained = gpsUnstableWindowRef.current.sustained();

    prevPositionRef.current = currentPosition;
    prevTimestampRef.current = now;

    if (!isRecording) {
      // ── APPROACH PHASE ──────────────────────────────────────────

      // Track approach sequence
      if (distToStart <= thresholds.ref300m && !approachSeqRef.current.passed300) {
        approachSeqRef.current.passed300 = true;
      }
      if (distToStart <= thresholds.ref150m && approachSeqRef.current.passed300 && !approachSeqRef.current.passed150) {
        approachSeqRef.current.passed150 = true;
      }
      if (distToStart <= thresholds.ref30m && approachSeqRef.current.passed150 && !approachSeqRef.current.passed30) {
        approachSeqRef.current.passed30 = true;
        approachSeqRef.current.sequenceValid = true;
      }

      let newState: NavOperationalState = prev;
      let reason = '';
      let activeRef: NavTrackerState['activeReference'] = null;

      if (gpsUnstableSustained) {
        newState = 'gps_unstable';
        reason = `gps_unstable_accuracy=${Math.round(accuracy)}m${gpsJumpDetected ? '_jump' : ''}`;
      } else if (distToStart <= thresholds.f5ReadyRadius) {
        newState = 'ready_f5_start';
        reason = `within_${thresholds.f5ReadyRadius}m_F5_ready_seq=${approachSeqRef.current.sequenceValid ? 'valid' : 'INVALID'}`;
      } else if (distToStart <= thresholds.ref30m) {
        newState = 'ref_30m';
        reason = `ref_30m_dist=${Math.round(distToStart)}m`;
        activeRef = 'ref_30m';
      } else if (distToStart <= thresholds.ref150m) {
        newState = 'ref_150m';
        reason = `ref_150m_dist=${Math.round(distToStart)}m`;
        activeRef = 'ref_150m';
      } else if (distToStart <= thresholds.ref300m) {
        newState = 'ref_300m';
        reason = `ref_300m_dist=${Math.round(distToStart)}m`;
        activeRef = 'ref_300m';
      } else {
        newState = 'approaching';
        reason = `dist_to_start=${Math.round(distToStart)}m`;
      }

      const shouldShowPrompt = newState === 'ready_f5_start' && promptDismissedRef.current !== activeSegment.id;

      if (prev !== newState) {
        logTransition(prev, newState, reason, currentPosition, { distanceToStart: distToStart });
      }

      setState({
        operationalState: newState,
        distanceToStart: distToStart,
        distanceToEnd: distToEnd,
        etaToStart: eta,
        progressPercent: 0,
        distanceRemaining: totalDist,
        totalDistance: totalDist,
        speedKmh,
        deviationMeters: 0,
        headingDelta: 0,
        showApproachPrompt: shouldShowPrompt,
        closestPointIndex: 0,
        transitions: transitionsRef.current,
        thresholds,
        isInvalidated: invalidatedRef.current,
        contiguousInfo,
        activeReference: activeRef,
        stats: statsRef.current,
        approachSequenceValid: approachSeqRef.current.sequenceValid,
        geometricRecoveryOnly: false,
      });
    } else {
      // ── RECORDING PHASE ─────────────────────────────────────────

      // If segment was invalidated, no mid-segment recovery
      if (invalidatedRef.current) {
        // Check if vehicle returned to polyline geometrically
        const { distance: geoDeviation } = closestOnPolyline(currentPosition, coords);
        const geoRecovered = geoDeviation <= thresholds.onTrackThreshold;
        if (geoRecovered && !geometricRecoveryOnlyRef.current) {
          geometricRecoveryOnlyRef.current = true;
          statsRef.current.geometricRecoveryCount++;
          logTransition(prev, 'invalidated', 'geometric_recovery_only_operational_still_invalid', currentPosition, {
            deviationMeters: geoDeviation,
          });
        }

        setState((s) => ({
          ...s,
          operationalState: 'invalidated',
          distanceToStart: distToStart,
          distanceToEnd: distToEnd,
          speedKmh,
          deviationMeters: geoDeviation,
          isInvalidated: true,
          transitions: transitionsRef.current,
          thresholds,
          contiguousInfo,
          activeReference: null,
          stats: statsRef.current,
          approachSequenceValid: approachSeqRef.current.sequenceValid,
          geometricRecoveryOnly: geometricRecoveryOnlyRef.current,
        }));
        return;
      }

      // Skip unreliable GPS samples
      if (isGpsUnreliable && !gpsUnstableSustained) {
        // Single bad sample — don't update state, just log
        return;
      }

      if (gpsUnstableSustained) {
        const newState: NavOperationalState = 'gps_unstable';
        if (prev !== 'gps_unstable') {
          statsRef.current.gpsUnstableCount++;
          logTransition(prev, newState, `gps_unstable_during_recording_accuracy=${Math.round(accuracy)}m`, currentPosition);
        }
        setState((s) => ({
          ...s,
          operationalState: newState,
          speedKmh,
          transitions: transitionsRef.current,
          thresholds,
          stats: statsRef.current,
          contiguousInfo,
        }));
        return;
      }

      const { index, t, distance: deviation } = closestOnPolyline(currentPosition, coords);
      const progressM = progressAlongPolyline(cumLens, index, t);
      const remaining = Math.max(0, totalDist - progressM);
      const progress = totalDist > 0 ? Math.min(100, (progressM / totalDist) * 100) : 0;

      // ── Heading analysis ──────────────────────────────────────────
      const polylineBearing = tangentBearing(coords, index);
      const vehicleHeading = gpsHeading ?? 0;
      const headingDelta = speed >= thresholds.minSpeedForDirection && gpsHeading != null
        ? angleDiff(vehicleHeading, polylineBearing)
        : 0;

      const isWrongDirection = headingDelta > thresholds.headingWrongDeg && speed >= thresholds.minSpeedForDirection;
      wrongDirWindowRef.current.push(isWrongDirection);
      const confirmedWrongDir = wrongDirWindowRef.current.sustained();

      // Update max heading delta
      if (headingDelta > statsRef.current.maxHeadingDeltaDeg) {
        statsRef.current.maxHeadingDeltaDeg = headingDelta;
      }

      prevIndexRef.current = index;
      prevTRef.current = t;

      // ── Deviation analysis (time-based) ───────────────────────────
      const isAboveDeviation = deviation > thresholds.deviationThreshold;
      const isAbovePreAlert = deviation > thresholds.preAlertThreshold;
      const isBelowOnTrack = deviation <= thresholds.onTrackThreshold;

      deviationWindowRef.current.push(isAboveDeviation);
      preAlertWindowRef.current.push(isAbovePreAlert);
      recoveryWindowRef.current.push(isBelowOnTrack);

      const confirmedDeviation = deviationWindowRef.current.sustained();
      const confirmedPreAlert = preAlertWindowRef.current.sustained();

      // Update max deviation
      if (deviation > statsRef.current.maxDeviationM) {
        statsRef.current.maxDeviationM = deviation;
      }

      // ── Valid/invalid distance tracking ────────────────────────────
      const advanceM = Math.max(0, progressM - prevProgressRef.current);
      if (advanceM > 0 && advanceM < 200) { // Ignore impossibly large jumps
        if (deviation <= thresholds.onTrackThreshold && headingDelta <= thresholds.headingCorrectDeg) {
          statsRef.current.validDistanceM += advanceM;
        } else {
          statsRef.current.invalidDistanceM += advanceM;
        }
      }
      prevProgressRef.current = progressM;

      // Update coverage
      statsRef.current.validCoveragePercent = totalDist > 0
        ? Math.min(100, (statsRef.current.validDistanceM / totalDist) * 100)
        : 0;

      // ── End-of-segment references ──────────────────────────────────
      let activeRef: NavTrackerState['activeReference'] = null;

      // ── State machine ──────────────────────────────────────────────
      let newState: NavOperationalState = prev;
      let reason = '';

      const isInRecordingState = prev === 'recording' || prev === 'pre_alert' || prev === 'gps_unstable'
        || prev === 'end_ref_300m' || prev === 'end_ref_150m' || prev === 'end_ref_30m';

      if (isInRecordingState) {
        // Check invalidation conditions first
        if (confirmedWrongDir) {
          newState = 'wrong_direction';
          reason = `wrong_direction_heading=${Math.round(headingDelta)}deg_sustained_${thresholds.headingWrongDurationMs}ms`;
          invalidatedRef.current = true;
          statsRef.current.wrongDirectionDetected = true;
          statsRef.current.operationallyInvalidated = true;
          wrongDirWindowRef.current.reset();
        } else if (confirmedDeviation) {
          newState = 'deviated';
          reason = `deviation=${Math.round(deviation)}m_sustained_${thresholds.deviationDurationMs}ms_INVALIDATED`;
          invalidatedRef.current = true;
          statsRef.current.deviationCount++;
          statsRef.current.operationallyInvalidated = true;
          deviationWindowRef.current.reset();
        } else if (confirmedPreAlert && prev !== 'pre_alert') {
          newState = 'pre_alert';
          reason = `deviation=${Math.round(deviation)}m_pre_alert_sustained_${thresholds.preAlertDurationMs}ms`;
        } else if (!isAbovePreAlert && prev === 'pre_alert') {
          newState = 'recording';
          reason = `deviation=${Math.round(deviation)}m_recovered_from_pre_alert`;
          preAlertWindowRef.current.reset();
          deviationWindowRef.current.reset();
        }

        // End references (only in valid recording states)
        if (!invalidatedRef.current && (newState === 'recording' || newState === prev)) {
          if (remaining <= thresholds.f5ReadyRadius) {
            newState = 'ready_f5_end';
            reason = `within_${thresholds.f5ReadyRadius}m_of_end_F5_ready`;
          } else if (remaining <= thresholds.ref30m) {
            if (prev !== 'end_ref_30m') {
              newState = 'end_ref_30m';
              reason = `end_ref_30m_remaining=${Math.round(remaining)}m`;
            } else {
              newState = 'end_ref_30m';
            }
            activeRef = 'end_ref_30m';
          } else if (remaining <= thresholds.ref150m) {
            if (prev !== 'end_ref_150m' && prev !== 'end_ref_30m') {
              newState = 'end_ref_150m';
              reason = `end_ref_150m_remaining=${Math.round(remaining)}m`;
            } else if (prev !== 'end_ref_30m') {
              newState = 'end_ref_150m';
            }
            activeRef = 'end_ref_150m';
          } else if (remaining <= thresholds.ref300m) {
            if (prev !== 'end_ref_300m' && prev !== 'end_ref_150m' && prev !== 'end_ref_30m') {
              newState = 'end_ref_300m';
              reason = `end_ref_300m_remaining=${Math.round(remaining)}m`;
            } else if (prev !== 'end_ref_150m' && prev !== 'end_ref_30m') {
              newState = 'end_ref_300m';
            }
            activeRef = 'end_ref_300m';
          }
        }
      } else if (prev === 'ready_f5_end') {
        newState = 'ready_f5_end';
      } else if (prev === 'deviated' || prev === 'wrong_direction' || prev === 'invalidated') {
        newState = 'invalidated';
        if (prev !== 'invalidated') {
          reason = 'segment_invalidated_no_mid_recovery_allowed';
          invalidatedRef.current = true;
        }
      } else {
        // First sample — verify approach was valid
        newState = 'recording';
        reason = `recording_started_approach_seq=${approachSeqRef.current.sequenceValid ? 'valid' : 'INVALID'}`;
        statsRef.current.approachSequenceValid = approachSeqRef.current.sequenceValid;
        if (!approachSeqRef.current.sequenceValid) {
          statsRef.current.requiresReview = true;
        }
      }

      if (prev !== newState && reason) {
        logTransition(prev, newState, reason, currentPosition, {
          deviationMeters: deviation,
          progressPercent: progress,
          distanceToEnd: remaining,
          headingDelta,
          speedKmh,
        });
      }

      setState({
        operationalState: newState,
        distanceToStart: distToStart,
        distanceToEnd: distToEnd,
        etaToStart: null,
        progressPercent: progress,
        distanceRemaining: remaining,
        totalDistance: totalDist,
        speedKmh,
        deviationMeters: deviation,
        headingDelta,
        showApproachPrompt: false,
        closestPointIndex: index,
        transitions: transitionsRef.current,
        thresholds,
        isInvalidated: invalidatedRef.current,
        contiguousInfo,
        activeReference: activeRef,
        stats: statsRef.current,
        approachSequenceValid: approachSeqRef.current.sequenceValid,
        geometricRecoveryOnly: geometricRecoveryOnlyRef.current,
      });
    }
  }, [activeSegment?.id, currentPosition?.lat, currentPosition?.lng, gpsSpeed, gpsHeading, gpsAccuracy, isRecording, navigationActive, totalDist, thresholds, cumLens, logTransition, contiguousInfo]);

  const dismissApproachPrompt = useCallback(() => {
    if (activeSegment) {
      promptDismissedRef.current = activeSegment.id;
    }
    setState((s) => ({ ...s, showApproachPrompt: false }));
  }, [activeSegment]);

  const clearTransitions = useCallback(() => {
    transitionsRef.current = [];
    setState((s) => ({ ...s, transitions: [] }));
  }, []);

  const invalidateSegment = useCallback(() => {
    invalidatedRef.current = true;
    statsRef.current.operationallyInvalidated = true;
    const prev = currentStateRef.current;
    logTransition(prev, 'invalidated', 'manual_invalidation', null);
    setState((s) => ({ ...s, operationalState: 'invalidated', isInvalidated: true, stats: statsRef.current }));
  }, [logTransition]);

  const resetInvalidation = useCallback(() => {
    invalidatedRef.current = false;
    geometricRecoveryOnlyRef.current = false;
    statsRef.current = defaultStats(activeSegment);
    prevProgressRef.current = 0;
    approachSeqRef.current = { passed300: false, passed150: false, passed30: false, sequenceValid: false };
    preAlertWindowRef.current.reset();
    deviationWindowRef.current.reset();
    recoveryWindowRef.current.reset();
    wrongDirWindowRef.current.reset();
    gpsUnstableWindowRef.current.reset();
    setState((s) => ({ ...s, isInvalidated: false, geometricRecoveryOnly: false, stats: statsRef.current }));
  }, [activeSegment]);

  /** Validate completion: checks coverage, invalidation, approach sequence */
  const validateCompletion = useCallback((): { valid: boolean; reasons: string[] } => {
    const reasons: string[] = [];
    const s = statsRef.current;

    if (s.operationallyInvalidated) {
      reasons.push('Tramo invalidado operativamente');
    }
    if (!s.approachSequenceValid) {
      reasons.push('Secuencia de aproximación incompleta (300→150→30)');
    }
    if (s.validCoveragePercent < thresholds.minValidCoveragePercent) {
      reasons.push(`Cobertura válida insuficiente: ${s.validCoveragePercent.toFixed(1)}% (mín. ${thresholds.minValidCoveragePercent}%)`);
    }
    if (s.wrongDirectionDetected) {
      reasons.push('Sentido incorrecto detectado durante el recorrido');
    }
    if (s.deviationCount > 0) {
      reasons.push(`${s.deviationCount} desvío(s) confirmado(s)`);
    }

    return { valid: reasons.length === 0, reasons };
  }, [thresholds.minValidCoveragePercent]);

  return {
    ...state,
    dismissApproachPrompt,
    clearTransitions,
    invalidateSegment,
    resetInvalidation,
    validateCompletion,
  };
}
