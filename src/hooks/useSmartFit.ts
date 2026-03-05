import { useRef, useCallback } from 'react';

interface BoundsLike {
  north: number;
  south: number;
  east: number;
  west: number;
}

const DEBOUNCE_MS = 400;
const COOLDOWN_MS = 1000;
const VISIBILITY_THRESHOLD = 0.80;
const ZOOM_MIN = 13;
const ZOOM_MAX = 18;

function toBoundsObj(b: google.maps.LatLngBounds): BoundsLike {
  const ne = b.getNorthEast();
  const sw = b.getSouthWest();
  return { north: ne.lat(), south: sw.lat(), east: ne.lng(), west: sw.lng() };
}

function boundsArea(b: BoundsLike): number {
  return Math.abs((b.north - b.south) * (b.east - b.west));
}

function intersectionArea(a: BoundsLike, b: BoundsLike): number {
  const north = Math.min(a.north, b.north);
  const south = Math.max(a.south, b.south);
  const east = Math.min(a.east, b.east);
  const west = Math.max(a.west, b.west);
  if (north <= south || east <= west) return 0;
  return (north - south) * (east - west);
}

/** Returns true if `target` is mostly visible within `viewport` */
function isBoundsMostlyVisible(target: BoundsLike, viewport: BoundsLike, threshold = VISIBILITY_THRESHOLD): boolean {
  const targetArea = boundsArea(target);
  if (targetArea === 0) return true; // point or zero-area
  const overlap = intersectionArea(target, viewport);
  return overlap / targetArea >= threshold;
}

function boundsAreSimilar(a: BoundsLike, b: BoundsLike, tolerance = 0.0005): boolean {
  return (
    Math.abs(a.north - b.north) < tolerance &&
    Math.abs(a.south - b.south) < tolerance &&
    Math.abs(a.east - b.east) < tolerance &&
    Math.abs(a.west - b.west) < tolerance
  );
}

export type FitReason = 'activeChanged' | 'selectionChanged' | 'segmentsLoaded' | 'manual';

export function useSmartFitGoogle() {
  const lastFitAt = useRef(0);
  const lastFitBounds = useRef<BoundsLike | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestFitBounds = useCallback((
    map: google.maps.Map,
    bounds: google.maps.LatLngBounds,
    reason: FitReason,
    padding = { top: 60, bottom: 160, left: 60, right: 60 },
  ) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    const execute = () => {
      const now = Date.now();
      const targetBounds = toBoundsObj(bounds);

      // Skip if same bounds were just applied
      if (lastFitBounds.current && boundsAreSimilar(lastFitBounds.current, targetBounds)) return;

      // Cooldown: skip if recently fitted (unless manual)
      if (reason !== 'manual' && now - lastFitAt.current < COOLDOWN_MS) return;

      // Hysteresis: skip if already mostly visible (unless manual or selection)
      if (reason === 'activeChanged') {
        try {
          const viewportBounds = map.getBounds();
          if (viewportBounds) {
            const viewport = toBoundsObj(viewportBounds);
            if (isBoundsMostlyVisible(targetBounds, viewport)) return;
          }
        } catch {}
      }

      // Execute fit
      try {
        map.fitBounds(bounds, padding);
        // Clamp zoom after fit settles
        const listener = google.maps.event.addListenerOnce(map, 'idle', () => {
          const z = map.getZoom();
          if (z !== undefined) {
            if (z > ZOOM_MAX) map.setZoom(ZOOM_MAX);
            else if (z < ZOOM_MIN) map.setZoom(ZOOM_MIN);
          }
        });
        // Safety cleanup
        setTimeout(() => google.maps.event.removeListener(listener), 3000);
      } catch (e) {
        console.warn('fitBounds failed:', e);
      }

      lastFitAt.current = now;
      lastFitBounds.current = targetBounds;
    };

    if (reason === 'manual') {
      // Manual: execute immediately, bypass debounce/cooldown
      lastFitAt.current = 0;
      lastFitBounds.current = null;
      execute();
    } else {
      debounceTimer.current = setTimeout(execute, DEBOUNCE_MS);
    }
  }, []);

  const resetFitState = useCallback(() => {
    lastFitAt.current = 0;
    lastFitBounds.current = null;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
  }, []);

  return { requestFitBounds, resetFitState };
}

/** Leaflet version of smart fit */
export function useSmartFitLeaflet() {
  const lastFitAt = useRef(0);
  const lastFitBounds = useRef<BoundsLike | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestFitBounds = useCallback((
    map: L.Map,
    bounds: L.LatLngBounds,
    reason: FitReason,
  ) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    const execute = () => {
      const now = Date.now();
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      const targetBounds: BoundsLike = {
        north: ne.lat, south: sw.lat, east: ne.lng, west: sw.lng,
      };

      if (lastFitBounds.current && boundsAreSimilar(lastFitBounds.current, targetBounds)) return;
      if (reason !== 'manual' && now - lastFitAt.current < COOLDOWN_MS) return;

      if (reason === 'activeChanged') {
        try {
          const vb = map.getBounds();
          const viewport: BoundsLike = {
            north: vb.getNorthEast().lat,
            south: vb.getSouthWest().lat,
            east: vb.getNorthEast().lng,
            west: vb.getSouthWest().lng,
          };
          if (isBoundsMostlyVisible(targetBounds, viewport)) return;
        } catch {}
      }

      try {
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: ZOOM_MAX });
        const z = map.getZoom();
        if (z < ZOOM_MIN) map.setZoom(ZOOM_MIN);
      } catch (e) {
        console.warn('fitBounds failed:', e);
      }

      lastFitAt.current = now;
      lastFitBounds.current = targetBounds;
    };

    if (reason === 'manual') {
      lastFitAt.current = 0;
      lastFitBounds.current = null;
      execute();
    } else {
      debounceTimer.current = setTimeout(execute, DEBOUNCE_MS);
    }
  }, []);

  const resetFitState = useCallback(() => {
    lastFitAt.current = 0;
    lastFitBounds.current = null;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
  }, []);

  return { requestFitBounds, resetFitState };
}
