import type { LatLng } from '@/types/route';

const STORAGE_KEY = 'vialroute_gmaps_key';

export function getGoogleMapsApiKey(): string {
  return localStorage.getItem(STORAGE_KEY) || '';
}

export function setGoogleMapsApiKey(key: string): void {
  localStorage.setItem(STORAGE_KEY, key);
}

let scriptLoaded = false;
let scriptPromise: Promise<void> | null = null;

function loadGoogleMapsScript(apiKey: string): Promise<void> {
  if (scriptLoaded && (window as any).google?.maps) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existing) {
      existing.remove();
      scriptLoaded = false;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=routes`;
    script.async = true;
    script.onload = () => {
      scriptLoaded = true;
      scriptPromise = null;
      resolve();
    };
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error('Error cargando Google Maps API'));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export interface DirectionsResult {
  order: number[];
  totalDistance: number; // meters
  legs: { distance: number; duration: number }[];
}

/**
 * Uses Google Maps Directions API to compute optimal driving route
 * between an array of waypoints (segment start/end points).
 */
export async function computeDirectionsRoute(
  waypoints: LatLng[],
  apiKey?: string
): Promise<DirectionsResult | null> {
  const key = apiKey || getGoogleMapsApiKey();
  if (!key || waypoints.length < 2) return null;

  try {
    await loadGoogleMapsScript(key);
  } catch {
    return null;
  }

  const gmaps = (window as any).google?.maps;
  if (!gmaps) return null;

  const directionsService = new gmaps.DirectionsService();

  const origin = new gmaps.LatLng(waypoints[0].lat, waypoints[0].lng);
  const destination = new gmaps.LatLng(
    waypoints[waypoints.length - 1].lat,
    waypoints[waypoints.length - 1].lng
  );

  const intermediateWaypoints = waypoints.slice(1, -1).map((wp) => ({
    location: new gmaps.LatLng(wp.lat, wp.lng),
    stopover: true,
  }));

  return new Promise((resolve) => {
    directionsService.route(
      {
        origin,
        destination,
        waypoints: intermediateWaypoints,
        optimizeWaypoints: true,
        travelMode: gmaps.TravelMode.DRIVING,
      },
      (result: any, status: string) => {
        if (status !== 'OK' || !result) {
          console.warn('Directions API error:', status);
          resolve(null);
          return;
        }

        const route = result.routes[0];
        const waypointOrder = route.waypoint_order || [];
        const legs = route.legs.map((leg: any) => ({
          distance: leg.distance.value,
          duration: leg.duration.value,
        }));
        const totalDistance = legs.reduce((sum: number, l: any) => sum + l.distance, 0);

        resolve({ order: waypointOrder, totalDistance, legs });
      }
    );
  });
}

/**
 * Optimize segment order using Google Maps Directions API.
 * Returns segment IDs in optimized order, or null if API fails.
 */
export async function optimizeWithDirections(
  segmentEndpoints: { id: string; start: LatLng; end: LatLng }[]
): Promise<string[] | null> {
  if (segmentEndpoints.length <= 1) {
    return segmentEndpoints.map((s) => s.id);
  }

  // Use segment midpoints as waypoints for optimization
  const waypoints = segmentEndpoints.map((s) => ({
    lat: (s.start.lat + s.end.lat) / 2,
    lng: (s.start.lng + s.end.lng) / 2,
  }));

  const result = await computeDirectionsRoute(waypoints);
  if (!result) return null;

  // Reconstruct the full order: origin (index 0) + reordered waypoints + destination (last)
  const fullOrder = [0, ...result.order.map((i) => i + 1), segmentEndpoints.length - 1];
  // Remove duplicates (origin/destination may already be in waypoint_order)
  const unique = [...new Set(fullOrder)];

  return unique.map((i) => segmentEndpoints[i].id);
}
