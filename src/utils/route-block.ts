import type { Segment } from '@/types/route';

export const ROUTE_BLOCK_SIZE = 4;

/**
 * Extract the next block of pending segments from the operative route order.
 *
 * IMPORTANT: This is a WINDOW into optimizedOrder, NOT an independent optimizer.
 * All routing decisions (corridors, scoring, maneuver) are handled by
 * route-candidates.ts / route-optimizer.ts. This function only selects
 * the first N actionable segments from the already-decided order.
 *
 * This ensures a single source of truth for navigation.
 */
export function computeRouteBlock(
  segments: Segment[],
  optimizedOrder: string[],
  hiddenLayers: Set<string>,
  blockSize: number = ROUTE_BLOCK_SIZE,
): string[] {
  const segMap = new Map(segments.map((s) => [s.id, s]));
  const result: string[] = [];

  for (const id of optimizedOrder) {
    if (result.length >= blockSize) break;
    const seg = segMap.get(id);
    if (!seg) continue;
    if (seg.nonRecordable) continue;
    if (seg.layer && hiddenLayers.has(seg.layer)) continue;
    if (seg.status === 'pendiente') {
      result.push(id);
    } else if (seg.status === 'posible_repetir' && seg.needsRepeat) {
      result.push(id);
    }
  }

  return result;
}
