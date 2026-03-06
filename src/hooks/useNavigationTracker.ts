import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Segment, LatLng } from '@/types/route';

// ─── RST Operational States ──────────────────────────────────────────
export type NavOperationalState =
  | 'idle'
  | 'approaching'       // driving toward approach zone
  | 'ref_300m'           // 300m reference before start
  | 'ref_150m'           // 150m reference before start
  | 'ref_30m'            // 30m reference before start
  | 'ready_f5_start'     // ready for F5 start press
  | 'recording'          // segment active, on polyline
  | 'pre_alert'          // deviation building but not confirmed
  | 'deviated'           // confirmed off-polyline → INVALIDATED
  | 'wrong_direction'    // traveling against planned direction → INVALIDATED
  | 'end_ref_300m'       // 300m before segment end
  | 'end_ref_150m'       // 150m before segment end
  | 'end_ref_30m'        // 30m before segment end
  | 'ready_f5_end'       // ready for F5 end press
  | 'invalidated'        // segment lost validity, must restart
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
}

// ─── Contiguous segment detection ─────────────────────────────────────
export interface ContiguousInfo {
  isContiguous: boolean;
  nextSegmentId: string | null;
  nextSegmentName: string | null;
  distanceBetween: number;
}

// ─── Configurable thresholds ──────────────────────────────────────────
export interface NavThresholds {
  approachRadius: number;
  ref300m: number;
  ref150m: number;
  ref30m: number;
  preAlertThreshold: number;
  deviationThreshold: number;
  recoveryThreshold: number;
  deviationWindowSize: number;
  recoveryWindowSize: number;
  wrongDirectionWindowSize: number;
  accuracyFilter: number;
  minSpeedForDirection: number;
  /** Max distance between end of current and start of next to consider contiguous */
  contiguousThreshold: number;
  /** F5 ready zone radius around start/end point */
  f5ReadyRadius: number;
}

const DEFAULT_THRESHOLDS: NavThresholds = {
  approachRadius: 350,
  ref300m: 300,
  ref150m: 150,
  ref30m: 30,
  preAlertThreshold: 40,
  deviationThreshold: 80,
  recoveryThreshold: 35,
  deviationWindowSize: 4,
  recoveryWindowSize: 3,
  wrongDirectionWindowSize: 5,
  accuracyFilter: 50,
  minSpeedForDirection: 1.5,
  contiguousThreshold: 50,
  f5ReadyRadius: 15,
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
  showApproachPrompt: boolean;
  closestPointIndex: number;
  transitions: NavTransition[];
  thresholds: NavThresholds;
  /** Whether segment validity was lost (deviation/wrong direction mid-segment) */
  isInvalidated: boolean;
  /** Info about contiguous next segment */
  contiguousInfo: ContiguousInfo;
  /** Current approach reference being triggered */
  activeReference: 'ref_300m' | 'ref_150m' | 'ref_30m' | 'end_ref_300m' | 'end_ref_150m' | 'end_ref_30m' | null;
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

// ─── Sliding window helper ───────────────────────────────────────────

class SlidingWindow {
  private buffer: boolean[];
  private size: number;
  constructor(size: number) {
    this.size = size;
    this.buffer = [];
  }
  push(value: boolean) {
    this.buffer.push(value);
    if (this.buffer.length > this.size) this.buffer.shift();
  }
  allTrue(): boolean {
    return this.buffer.length >= this.size && this.buffer.every(Boolean);
  }
  reset() {
    this.buffer = [];
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────

export function useNavigationTracker(
  activeSegment: Segment | null | undefined,
  currentPosition: LatLng | null | undefined,
  gpsSpeed: number | null,
  isRecording: boolean,
  navigationActive: boolean,
  customThresholds?: Partial<NavThresholds>,
  /** Next segment in itinerary — for contiguous detection */
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
    showApproachPrompt: false,
    closestPointIndex: 0,
    transitions: [],
    thresholds,
    isInvalidated: false,
    contiguousInfo: { isContiguous: false, nextSegmentId: null, nextSegmentName: null, distanceBetween: Infinity },
    activeReference: null,
  });

  const deviationWindowRef = useRef(new SlidingWindow(thresholds.deviationWindowSize));
  const recoveryWindowRef = useRef(new SlidingWindow(thresholds.recoveryWindowSize));
  const wrongDirWindowRef = useRef(new SlidingWindow(thresholds.wrongDirectionWindowSize));
  const prevIndexRef = useRef<number | null>(null);
  const prevTRef = useRef<number>(0);
  const promptDismissedRef = useRef<string | null>(null);
  const transitionsRef = useRef<NavTransition[]>([]);
  const currentStateRef = useRef<NavOperationalState>('idle');
  const invalidatedRef = useRef(false);
  /** Track which approach refs have been triggered to avoid re-triggering */
  const triggeredRefsRef = useRef<Set<string>>(new Set());

  const segIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeSegment?.id !== segIdRef.current) {
      segIdRef.current = activeSegment?.id ?? null;
      deviationWindowRef.current = new SlidingWindow(thresholds.deviationWindowSize);
      recoveryWindowRef.current = new SlidingWindow(thresholds.recoveryWindowSize);
      wrongDirWindowRef.current = new SlidingWindow(thresholds.wrongDirectionWindowSize);
      prevIndexRef.current = null;
      prevTRef.current = 0;
      transitionsRef.current = [];
      currentStateRef.current = 'idle';
      invalidatedRef.current = false;
      triggeredRefsRef.current = new Set();
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

  const logTransition = useCallback((from: NavOperationalState, to: NavOperationalState, reason: string, pos: LatLng | null, extra?: Partial<NavTransition>) => {
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
      }));
      return;
    }

    const coords = activeSegment.coordinates;
    if (coords.length < 2) return;

    const startPoint = coords[0];
    const endPoint = coords[coords.length - 1];
    const distToStart = haversine(currentPosition, startPoint);
    const distToEnd = haversine(currentPosition, endPoint);
    const speed = gpsSpeed != null && gpsSpeed >= 0 ? gpsSpeed : 0;
    const speedKmh = speed * 3.6;
    const eta = speed > 0.5 ? distToStart / speed : null;
    const prev = currentStateRef.current;

    if (!isRecording) {
      // ── APPROACH PHASE — RST reference markers ──────────────────
      let newState: NavOperationalState = prev;
      let reason = '';
      let activeRef: NavTrackerState['activeReference'] = null;

      if (distToStart <= thresholds.f5ReadyRadius) {
        newState = 'ready_f5_start';
        reason = `within_${thresholds.f5ReadyRadius}m_F5_ready`;
        activeRef = null;
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
        showApproachPrompt: shouldShowPrompt,
        closestPointIndex: 0,
        transitions: transitionsRef.current,
        thresholds,
        isInvalidated: invalidatedRef.current,
        contiguousInfo,
        activeReference: activeRef,
      });
    } else {
      // ── RECORDING PHASE ─────────────────────────────────────────

      // If segment was invalidated, don't allow continuing
      if (invalidatedRef.current) {
        setState((s) => ({
          ...s,
          operationalState: 'invalidated',
          distanceToStart: distToStart,
          distanceToEnd: distToEnd,
          speedKmh,
          isInvalidated: true,
          transitions: transitionsRef.current,
          thresholds,
          contiguousInfo,
          activeReference: null,
        }));
        return;
      }

      const { index, t, distance: deviation } = closestOnPolyline(currentPosition, coords);
      const progressM = progressAlongPolyline(cumLens, index, t);
      const remaining = Math.max(0, totalDist - progressM);
      const progress = totalDist > 0 ? Math.min(100, (progressM / totalDist) * 100) : 0;

      // Direction analysis
      const combinedIndex = index + t;
      const prevCombined = prevIndexRef.current !== null ? prevIndexRef.current + prevTRef.current : null;
      const isMovingBackward = prevCombined !== null && speed >= thresholds.minSpeedForDirection && combinedIndex < prevCombined - 0.3;
      wrongDirWindowRef.current.push(isMovingBackward);
      const confirmedWrongDir = wrongDirWindowRef.current.allTrue();

      prevIndexRef.current = index;
      prevTRef.current = t;

      // Deviation analysis with hysteresis
      const isAboveDeviation = deviation > thresholds.deviationThreshold;
      const isAbovePreAlert = deviation > thresholds.preAlertThreshold;
      const isBelowRecovery = deviation <= thresholds.recoveryThreshold;

      deviationWindowRef.current.push(isAboveDeviation);
      recoveryWindowRef.current.push(isBelowRecovery);

      const confirmedDeviation = deviationWindowRef.current.allTrue();

      // End-of-segment references
      let activeRef: NavTrackerState['activeReference'] = null;
      const distToEndFromProgress = remaining;

      // State machine
      let newState: NavOperationalState = prev;
      let reason = '';

      // Check for invalidation conditions first
      if (prev === 'recording' || prev === 'pre_alert' || prev === 'end_ref_300m' || prev === 'end_ref_150m' || prev === 'end_ref_30m') {
        if (confirmedWrongDir) {
          newState = 'wrong_direction';
          reason = `wrong_direction_confirmed_${thresholds.wrongDirectionWindowSize}_samples`;
          invalidatedRef.current = true;
          wrongDirWindowRef.current.reset();
        } else if (confirmedDeviation) {
          newState = 'deviated';
          reason = `deviation=${Math.round(deviation)}m_confirmed_INVALIDATED`;
          invalidatedRef.current = true;
          deviationWindowRef.current.reset();
        } else if (isAbovePreAlert && (prev === 'recording' || prev === 'end_ref_300m' || prev === 'end_ref_150m' || prev === 'end_ref_30m')) {
          newState = 'pre_alert';
          reason = `deviation=${Math.round(deviation)}m_pre_alert`;
        } else if (!isAbovePreAlert && prev === 'pre_alert') {
          newState = 'recording';
          reason = `deviation=${Math.round(deviation)}m_recovered_pre_alert`;
          deviationWindowRef.current.reset();
        }

        // End references (only in valid recording states)
        if (!invalidatedRef.current && (newState === 'recording' || prev === 'end_ref_300m' || prev === 'end_ref_150m' || prev === 'end_ref_30m')) {
          if (distToEndFromProgress <= thresholds.f5ReadyRadius) {
            newState = 'ready_f5_end';
            reason = `within_${thresholds.f5ReadyRadius}m_of_end_F5_ready`;
          } else if (distToEndFromProgress <= thresholds.ref30m) {
            if (prev !== 'end_ref_30m') {
              newState = 'end_ref_30m';
              reason = `end_ref_30m_remaining=${Math.round(distToEndFromProgress)}m`;
            } else {
              newState = 'end_ref_30m';
            }
            activeRef = 'end_ref_30m';
          } else if (distToEndFromProgress <= thresholds.ref150m) {
            if (prev !== 'end_ref_150m' && prev !== 'end_ref_30m') {
              newState = 'end_ref_150m';
              reason = `end_ref_150m_remaining=${Math.round(distToEndFromProgress)}m`;
            } else if (prev !== 'end_ref_30m') {
              newState = 'end_ref_150m';
            }
            activeRef = 'end_ref_150m';
          } else if (distToEndFromProgress <= thresholds.ref300m) {
            if (prev !== 'end_ref_300m' && prev !== 'end_ref_150m' && prev !== 'end_ref_30m') {
              newState = 'end_ref_300m';
              reason = `end_ref_300m_remaining=${Math.round(distToEndFromProgress)}m`;
            } else if (prev !== 'end_ref_150m' && prev !== 'end_ref_30m') {
              newState = 'end_ref_300m';
            }
            activeRef = 'end_ref_300m';
          }
        }
      } else if (prev === 'ready_f5_end') {
        // Stay in ready_f5_end until operator acts
        newState = 'ready_f5_end';
      } else if (prev === 'deviated' || prev === 'wrong_direction' || prev === 'invalidated') {
        // Once invalidated, no recovery allowed mid-segment
        newState = 'invalidated';
        if (prev !== 'invalidated') {
          reason = 'segment_invalidated_no_mid_recovery';
          invalidatedRef.current = true;
        }
      } else {
        // First sample after recording starts
        newState = 'recording';
        reason = 'recording_started';
      }

      if (prev !== newState && reason) {
        logTransition(prev, newState, reason, currentPosition, {
          deviationMeters: deviation,
          progressPercent: progress,
          distanceToEnd: distToEndFromProgress,
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
        showApproachPrompt: false,
        closestPointIndex: index,
        transitions: transitionsRef.current,
        thresholds,
        isInvalidated: invalidatedRef.current,
        contiguousInfo,
        activeReference: activeRef,
      });
    }
  }, [activeSegment?.id, currentPosition?.lat, currentPosition?.lng, gpsSpeed, isRecording, navigationActive, totalDist, thresholds, cumLens, logTransition, contiguousInfo]);

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

  /** Mark segment as invalidated manually */
  const invalidateSegment = useCallback(() => {
    invalidatedRef.current = true;
    const prev = currentStateRef.current;
    logTransition(prev, 'invalidated', 'manual_invalidation', null);
    setState((s) => ({ ...s, operationalState: 'invalidated', isInvalidated: true }));
  }, [logTransition]);

  /** Reset invalidation flag (for segment restart) */
  const resetInvalidation = useCallback(() => {
    invalidatedRef.current = false;
    triggeredRefsRef.current = new Set();
    setState((s) => ({ ...s, isInvalidated: false }));
  }, []);

  return { ...state, dismissApproachPrompt, clearTransitions, invalidateSegment, resetInvalidation };
}
