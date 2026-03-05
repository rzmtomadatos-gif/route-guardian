import type { QueueItem } from '@/hooks/useCopilotSession';

export const BATCH_SIZE = 5;

/**
 * Build a Google Maps multi-stop directions URL.
 * - origin = "My+Location" (driver's current position)
 * - destination = last stop
 * - waypoints = all stops except the last, separated by |
 */
export function buildGoogleMapsBatchUrl(stops: QueueItem[]): string {
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
