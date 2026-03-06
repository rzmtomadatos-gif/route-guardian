import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Segment, LatLng } from '@/types/route';

export type NavOperationalState =
  | 'idle'
  | 'approaching'     // en_aproximación — driving to segment start
  | 'ready'           // listo_para_iniciar — within proximity of start
  | 'recording'       // en_grabación — segment started
  | 'deviated'        // desviado — off the polyline during recording
  | 'interrupted'     // interrumpido
  | 'completed';      // completado

interface NavTrackerState {
  operationalState: NavOperationalState;
  /** Distance to segment start point in meters */
  distanceToStart: number | null;
  /** ETA to start in seconds (based on current speed) */
  etaToStart: number | null;
  /** Progress along polyline 0–100 */
  progressPercent: number;
  /** Distance remaining on the polyline in meters */
  distanceRemaining: number | null;
  /** Total polyline length in meters */
  totalDistance: number;
  /** Current speed in km/h */
  speedKmh: number;
  /** Perpendicular distance from polyline in meters */
  deviationMeters: number;
  /** Whether the approach confirmation prompt should show */
  showApproachPrompt: boolean;
  /** Index of closest point on polyline */
  closestPointIndex: number;
}

const APPROACH_RADIUS = 50; // meters — when to trigger "ready"
const DEVIATION_THRESHOLD = 80; // meters — when to flag deviation
const DEVIATION_RECOVERY = 40; // meters — back under this = recovered

/** Haversine distance in meters */
function haversine(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Distance from point to line segment (p1→p2) in meters */
function pointToSegmentDistance(p: LatLng, p1: LatLng, p2: LatLng): number {
  const d12 = haversine(p1, p2);
  if (d12 < 0.1) return haversine(p, p1);
  
  // Project onto segment using dot product approximation
  const dx = p2.lng - p1.lng;
  const dy = p2.lat - p1.lat;
  const t = Math.max(0, Math.min(1, ((p.lng - p1.lng) * dx + (p.lat - p1.lat) * dy) / (dx * dx + dy * dy)));
  const proj: LatLng = { lat: p1.lat + t * dy, lng: p1.lng + t * dx };
  return haversine(p, proj);
}

/** Find closest point on polyline, return index and distance */
function closestOnPolyline(pos: LatLng, coords: LatLng[]): { index: number; distance: number } {
  let minDist = Infinity;
  let minIdx = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const d = pointToSegmentDistance(pos, coords[i], coords[i + 1]);
    if (d < minDist) {
      minDist = d;
      minIdx = i;
    }
  }
  return { index: minIdx, distance: minDist };
}

/** Polyline length from index to end in meters */
function polylineLengthFrom(coords: LatLng[], fromIndex: number): number {
  let total = 0;
  for (let i = Math.max(0, fromIndex); i < coords.length - 1; i++) {
    total += haversine(coords[i], coords[i + 1]);
  }
  return total;
}

/** Total polyline length in meters */
function polylineLength(coords: LatLng[]): number {
  return polylineLengthFrom(coords, 0);
}

export function useNavigationTracker(
  activeSegment: Segment | null | undefined,
  currentPosition: LatLng | null | undefined,
  gpsSpeed: number | null, // m/s from geolocation
  isRecording: boolean, // segment status === 'en_progreso'
  navigationActive: boolean,
) {
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
  });

  const promptDismissedRef = useRef<string | null>(null);
  const prevDeviatedRef = useRef(false);

  const totalDist = useMemo(() => {
    if (!activeSegment || activeSegment.coordinates.length < 2) return 0;
    return polylineLength(activeSegment.coordinates);
  }, [activeSegment?.id, activeSegment?.coordinates.length]);

  // Main tracking loop
  useEffect(() => {
    if (!activeSegment || !currentPosition || !navigationActive) {
      setState((s) => ({ ...s, operationalState: 'idle', showApproachPrompt: false }));
      return;
    }

    const coords = activeSegment.coordinates;
    if (coords.length < 2) return;

    const startPoint = coords[0];
    const distToStart = haversine(currentPosition, startPoint);
    const speed = gpsSpeed != null && gpsSpeed >= 0 ? gpsSpeed : 0;
    const speedKmh = speed * 3.6;
    const eta = speed > 0.5 ? distToStart / speed : null;

    if (!isRecording) {
      // APPROACH PHASE
      const isNearStart = distToStart <= APPROACH_RADIUS;
      const shouldShowPrompt = isNearStart && promptDismissedRef.current !== activeSegment.id;

      setState({
        operationalState: isNearStart ? 'ready' : 'approaching',
        distanceToStart: distToStart,
        etaToStart: eta,
        progressPercent: 0,
        distanceRemaining: totalDist,
        totalDistance: totalDist,
        speedKmh,
        deviationMeters: 0,
        showApproachPrompt: shouldShowPrompt,
        closestPointIndex: 0,
      });
    } else {
      // RECORDING PHASE — track progress along polyline
      const { index, distance: deviation } = closestOnPolyline(currentPosition, coords);
      const remaining = polylineLengthFrom(coords, index);
      const progress = totalDist > 0 ? Math.min(100, ((totalDist - remaining) / totalDist) * 100) : 0;

      const isDeviated = deviation > DEVIATION_THRESHOLD;
      const wasDeviated = prevDeviatedRef.current;
      const recovered = wasDeviated && deviation <= DEVIATION_RECOVERY;

      let opState: NavOperationalState = 'recording';
      if (isDeviated) opState = 'deviated';
      if (recovered) opState = 'recording';

      prevDeviatedRef.current = isDeviated;

      setState({
        operationalState: opState,
        distanceToStart: distToStart,
        etaToStart: null,
        progressPercent: progress,
        distanceRemaining: remaining,
        totalDistance: totalDist,
        speedKmh,
        deviationMeters: deviation,
        showApproachPrompt: false,
        closestPointIndex: index,
      });
    }
  }, [activeSegment?.id, currentPosition?.lat, currentPosition?.lng, gpsSpeed, isRecording, navigationActive, totalDist]);

  const dismissApproachPrompt = useCallback(() => {
    if (activeSegment) {
      promptDismissedRef.current = activeSegment.id;
    }
    setState((s) => ({ ...s, showApproachPrompt: false }));
  }, [activeSegment]);

  return { ...state, dismissApproachPrompt };
}
