import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Segment, LatLng } from '@/types/route';

// ─── Operational states ───────────────────────────────────────────────
export type NavOperationalState =
  | 'idle'
  | 'approaching'       // driving to segment start
  | 'ready'             // within proximity of start
  | 'recording'         // segment started, on polyline
  | 'pre_alert'         // deviation building but not confirmed
  | 'deviated'          // confirmed off-polyline
  | 'wrong_direction'   // traveling against planned direction
  | 'interrupted'
  | 'completed';

// ─── Transition log entry ─────────────────────────────────────────────
export interface NavTransition {
  from: NavOperationalState;
  to: NavOperationalState;
  timestamp: string;      // ISO
  position: LatLng | null;
  segmentId: string;
  reason: string;
  deviationMeters?: number;
  progressPercent?: number;
}

// ─── Configurable thresholds ──────────────────────────────────────────
export interface NavThresholds {
  /** Radius in meters to trigger "ready" state */
  approachRadius: number;
  /** Deviation distance to enter pre_alert (meters) */
  preAlertThreshold: number;
  /** Deviation distance to confirm deviation (meters) */
  deviationThreshold: number;
  /** Deviation distance to confirm recovery (meters) — hysteresis */
  recoveryThreshold: number;
  /** Number of consecutive samples above threshold to confirm deviation */
  deviationWindowSize: number;
  /** Number of consecutive samples below recovery to confirm recovery */
  recoveryWindowSize: number;
  /** Number of consecutive samples with regressing index to flag wrong direction */
  wrongDirectionWindowSize: number;
  /** GPS accuracy threshold — ignore samples worse than this (meters) */
  accuracyFilter: number;
  /** Minimum speed to evaluate direction (m/s) — below this, direction is unreliable */
  minSpeedForDirection: number;
}

const DEFAULT_THRESHOLDS: NavThresholds = {
  approachRadius: 50,
  preAlertThreshold: 40,
  deviationThreshold: 80,
  recoveryThreshold: 35,
  deviationWindowSize: 4,
  recoveryWindowSize: 3,
  wrongDirectionWindowSize: 5,
  accuracyFilter: 50,
  minSpeedForDirection: 1.5, // ~5 km/h
};

// ─── Public state ─────────────────────────────────────────────────────
export interface NavTrackerState {
  operationalState: NavOperationalState;
  distanceToStart: number | null;
  etaToStart: number | null;
  progressPercent: number;
  distanceRemaining: number | null;
  totalDistance: number;
  speedKmh: number;
  deviationMeters: number;
  showApproachPrompt: boolean;
  closestPointIndex: number;
  /** Transition log for traceability */
  transitions: NavTransition[];
  /** Active thresholds (for debug display) */
  thresholds: NavThresholds;
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

/** Project point onto segment p1→p2, return projected point and fractional t */
function projectOnSegment(p: LatLng, p1: LatLng, p2: LatLng): { proj: LatLng; t: number; dist: number } {
  const d12 = haversine(p1, p2);
  if (d12 < 0.1) return { proj: p1, t: 0, dist: haversine(p, p1) };
  const dx = p2.lng - p1.lng;
  const dy = p2.lat - p1.lat;
  const t = Math.max(0, Math.min(1, ((p.lng - p1.lng) * dx + (p.lat - p1.lat) * dy) / (dx * dx + dy * dy)));
  const proj: LatLng = { lat: p1.lat + t * dy, lng: p1.lng + t * dx };
  return { proj, t, dist: haversine(p, proj) };
}

/** Find closest point on polyline — returns segment index, fractional position, and distance */
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

/** Cumulative length array for the polyline (meters) */
function cumulativeLengths(coords: LatLng[]): number[] {
  const lens = [0];
  for (let i = 1; i < coords.length; i++) {
    lens.push(lens[i - 1] + haversine(coords[i - 1], coords[i]));
  }
  return lens;
}

/** Progress in meters along polyline given segment index + fractional t */
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
  /** All samples in window are true */
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
) {
  const thresholds = useMemo<NavThresholds>(
    () => ({ ...DEFAULT_THRESHOLDS, ...customThresholds }),
    [customThresholds],
  );

  const [state, setState] = useState<NavTrackerState>({
    operationalState: 'idle',
    distanceToStart: null,
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
  });

  // Refs for windowed analysis
  const deviationWindowRef = useRef(new SlidingWindow(thresholds.deviationWindowSize));
  const recoveryWindowRef = useRef(new SlidingWindow(thresholds.recoveryWindowSize));
  const wrongDirWindowRef = useRef(new SlidingWindow(thresholds.wrongDirectionWindowSize));
  const prevIndexRef = useRef<number | null>(null);
  const prevTRef = useRef<number>(0);
  const promptDismissedRef = useRef<string | null>(null);
  const transitionsRef = useRef<NavTransition[]>([]);
  const currentStateRef = useRef<NavOperationalState>('idle');

  // Reset windows when segment changes
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
    }
  }, [activeSegment?.id, thresholds]);

  // Precompute cumulative lengths
  const cumLens = useMemo(() => {
    if (!activeSegment || activeSegment.coordinates.length < 2) return [0];
    return cumulativeLengths(activeSegment.coordinates);
  }, [activeSegment?.id, activeSegment?.coordinates.length]);

  const totalDist = cumLens[cumLens.length - 1];

  // Transition logger
  const logTransition = useCallback((from: NavOperationalState, to: NavOperationalState, reason: string, pos: LatLng | null, extra?: { deviationMeters?: number; progressPercent?: number }) => {
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
      }));
      return;
    }

    const coords = activeSegment.coordinates;
    if (coords.length < 2) return;

    const startPoint = coords[0];
    const distToStart = haversine(currentPosition, startPoint);
    const speed = gpsSpeed != null && gpsSpeed >= 0 ? gpsSpeed : 0;
    const speedKmh = speed * 3.6;
    const eta = speed > 0.5 ? distToStart / speed : null;
    const prev = currentStateRef.current;

    if (!isRecording) {
      // ── APPROACH PHASE ──────────────────────────────────────────────
      const isNearStart = distToStart <= thresholds.approachRadius;
      const newState: NavOperationalState = isNearStart ? 'ready' : 'approaching';
      const shouldShowPrompt = isNearStart && promptDismissedRef.current !== activeSegment.id;

      if (prev !== newState) {
        logTransition(prev, newState, isNearStart ? `within_${thresholds.approachRadius}m_of_start` : `dist_to_start=${Math.round(distToStart)}m`, currentPosition);
      }

      setState({
        operationalState: newState,
        distanceToStart: distToStart,
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
      });
    } else {
      // ── RECORDING PHASE ─────────────────────────────────────────────
      const { index, t, distance: deviation } = closestOnPolyline(currentPosition, coords);
      const progressM = progressAlongPolyline(cumLens, index, t);
      const remaining = Math.max(0, totalDist - progressM);
      const progress = totalDist > 0 ? Math.min(100, (progressM / totalDist) * 100) : 0;

      // ── Direction analysis (index regression = wrong direction) ────
      const combinedIndex = index + t; // fractional index for smooth comparison
      const prevCombined = prevIndexRef.current !== null ? prevIndexRef.current + prevTRef.current : null;
      const isMovingBackward = prevCombined !== null && speed >= thresholds.minSpeedForDirection && combinedIndex < prevCombined - 0.3;
      wrongDirWindowRef.current.push(isMovingBackward);
      const confirmedWrongDir = wrongDirWindowRef.current.allTrue();

      prevIndexRef.current = index;
      prevTRef.current = t;

      // ── Deviation analysis with hysteresis ─────────────────────────
      const isAboveDeviation = deviation > thresholds.deviationThreshold;
      const isAbovePreAlert = deviation > thresholds.preAlertThreshold;
      const isBelowRecovery = deviation <= thresholds.recoveryThreshold;

      deviationWindowRef.current.push(isAboveDeviation);
      recoveryWindowRef.current.push(isBelowRecovery);

      const confirmedDeviation = deviationWindowRef.current.allTrue();
      const confirmedRecovery = recoveryWindowRef.current.allTrue();

      // ── State machine transitions ──────────────────────────────────
      let newState: NavOperationalState = prev;
      let reason = '';

      if (prev === 'recording' || prev === 'pre_alert') {
        if (confirmedWrongDir && !confirmedDeviation) {
          newState = 'wrong_direction';
          reason = `index_regression_confirmed_over_${thresholds.wrongDirectionWindowSize}_samples`;
          wrongDirWindowRef.current.reset();
        } else if (confirmedDeviation) {
          newState = 'deviated';
          reason = `deviation=${Math.round(deviation)}m_confirmed_over_${thresholds.deviationWindowSize}_samples`;
          deviationWindowRef.current.reset();
        } else if (isAbovePreAlert && prev === 'recording') {
          newState = 'pre_alert';
          reason = `deviation=${Math.round(deviation)}m_above_pre_alert_${thresholds.preAlertThreshold}m`;
        } else if (!isAbovePreAlert && prev === 'pre_alert') {
          newState = 'recording';
          reason = `deviation=${Math.round(deviation)}m_dropped_below_pre_alert`;
          deviationWindowRef.current.reset();
        }
      } else if (prev === 'deviated' || prev === 'wrong_direction') {
        if (confirmedRecovery) {
          newState = 'recording';
          reason = `recovery_confirmed_deviation=${Math.round(deviation)}m_below_${thresholds.recoveryThreshold}m_over_${thresholds.recoveryWindowSize}_samples`;
          recoveryWindowRef.current.reset();
          wrongDirWindowRef.current.reset();
          deviationWindowRef.current.reset();
        }
      } else {
        // First sample after recording starts — default to recording
        newState = 'recording';
        reason = 'recording_started';
      }

      if (prev !== newState) {
        logTransition(prev, newState, reason, currentPosition, {
          deviationMeters: deviation,
          progressPercent: progress,
        });
      }

      setState({
        operationalState: newState,
        distanceToStart: distToStart,
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
      });
    }
  }, [activeSegment?.id, currentPosition?.lat, currentPosition?.lng, gpsSpeed, isRecording, navigationActive, totalDist, thresholds, cumLens, logTransition]);

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

  return { ...state, dismissApproachPrompt, clearTransitions };
}
