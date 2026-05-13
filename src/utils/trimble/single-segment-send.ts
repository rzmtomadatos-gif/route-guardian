/**
 * Helper para enviar UN solo tramo Trimble al copiloto desde el overlay.
 *
 * - Calcula INICIO/FIN efectivos respetando `trimbleSegmentDirectionOverrides`
 *   (`reversed` invierte solo la dirección operativa: NO modifica `coordinates`
 *   ni la geometría KML).
 * - Devuelve `items` (paradas para queue) y `batchUrl` (Google Maps batch).
 * - El envío real (RPC) y el log de eventos viven en quien lo invoca.
 */
import type { LatLng, Segment } from '@/types/route';
import type { QueueItem } from '@/hooks/useCopilotSession';
import { buildGoogleMapsBatchUrl } from '@/utils/google-maps-batch';

export interface SingleSegmentSendPayload {
  items: QueueItem[];
  batchUrl: string;
  effectiveStart: LatLng;
  effectiveEnd: LatLng;
  reversed: boolean;
}

export function buildSingleSegmentSendPayload(
  segment: Segment,
  directionOverride: 'normal' | 'reversed' | undefined,
): SingleSegmentSendPayload | null {
  if (!segment.coordinates || segment.coordinates.length < 2) return null;
  const first = segment.coordinates[0];
  const last = segment.coordinates[segment.coordinates.length - 1];
  const reversed = directionOverride === 'reversed';
  const effectiveStart = reversed ? last : first;
  const effectiveEnd = reversed ? first : last;
  const items: QueueItem[] = [
    { segmentId: segment.id, name: `INICIO · ${segment.name}`, lat: effectiveStart.lat, lng: effectiveStart.lng },
    { segmentId: segment.id, name: `FIN · ${segment.name}`,    lat: effectiveEnd.lat,   lng: effectiveEnd.lng   },
  ];
  const batchUrl = buildGoogleMapsBatchUrl([
    { lat: effectiveStart.lat, lng: effectiveStart.lng },
    { lat: effectiveEnd.lat,   lng: effectiveEnd.lng   },
  ]);
  return { items, batchUrl, effectiveStart, effectiveEnd, reversed };
}
