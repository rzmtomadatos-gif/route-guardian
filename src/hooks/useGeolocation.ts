import { useState, useEffect, useCallback, useRef } from 'react';
import type { LatLng } from '@/types/route';

interface GeolocationState {
  position: LatLng | null;
  heading: number | null;
  speed: number | null;
  accuracy: number | null;
  error: string | null;
}

export function useGeolocation(enabled: boolean = false) {
  const [state, setState] = useState<GeolocationState>({
    position: null,
    heading: null,
    speed: null,
    accuracy: null,
    error: null,
  });
  const watchIdRef = useRef<number | null>(null);

  const start = useCallback(() => {
    if (!navigator.geolocation) {
      setState((s) => ({ ...s, error: 'Geolocalización no disponible' }));
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setState({
          position: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          heading: pos.coords.heading,
          speed: pos.coords.speed,
          accuracy: pos.coords.accuracy,
          error: null,
        });
      },
      (err) => {
        setState((s) => ({ ...s, error: err.message }));
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
  }, []);

  const stop = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (enabled) start();
    else stop();
    return stop;
  }, [enabled, start, stop]);

  return { ...state, start, stop };
}
