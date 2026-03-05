import type { LatLng } from '@/types/route';

/** Default number of segments per batch (each segment = 2 stops: start + end) */
export const SEGMENTS_PER_BATCH = 4;

export interface BatchStop {
  lat: number;
  lng: number;
}

/**
 * Build a Google Maps multi-stop directions URL from a flat list of stops.
 * - origin = "My+Location" (driver's current position)
 * - destination = last stop
 * - waypoints = all stops except the last, separated by |
 */
export function buildGoogleMapsBatchUrl(stops: BatchStop[]): string {
  if (stops.length === 0) return '';

  const coords = stops.map(s => `${s.lat},${s.lng}`);
  const destination = coords[coords.length - 1];
  const waypoints = coords.slice(0, -1);

  let url = `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=My+Location&destination=${destination}`;
  if (waypoints.length > 0) {
    url += `&waypoints=${waypoints.join('|')}`;
  }
  return url;
}

/**
 * Convert segments into a flat list of stops (start, end per segment).
 */
export function segmentsToStops(segments: { coordinates: LatLng[] }[]): BatchStop[] {
  const stops: BatchStop[] = [];
  for (const seg of segments) {
    if (seg.coordinates.length < 2) continue;
    const start = seg.coordinates[0];
    const end = seg.coordinates[seg.coordinates.length - 1];
    stops.push({ lat: start.lat, lng: start.lng });
    stops.push({ lat: end.lat, lng: end.lng });
  }
  return stops;
}
