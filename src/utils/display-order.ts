/**
 * Single source of truth for segment display order.
 * Maps segment ID → 1-based position in the current optimized route.
 */
export function buildDisplayOrderMap(optimizedOrder: string[]): Map<string, number> {
  const map = new Map<string, number>();
  optimizedOrder.forEach((id, idx) => {
    map.set(id, idx + 1);
  });
  return map;
}
