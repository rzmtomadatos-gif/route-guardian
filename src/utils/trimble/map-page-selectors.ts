import type { Route } from '@/types/route';

/**
 * IDs elegibles para la cola operativa Trimble.
 *
 * Regla crítica: NO depende del viewport, renderizado, activeRouteBlock,
 * ROUTE_BLOCK_SIZE ni MAX_ARROW_SEGMENTS. Sólo capas activas sobre la ruta completa.
 */
export function getTrimbleEligibleSegmentIds(route: Route | null | undefined, hiddenLayers: Set<string>): Set<string> {
  if (!route) return new Set<string>();

  return new Set(
    route.segments
      .filter((seg) => {
        if (seg.layer && hiddenLayers.has(seg.layer)) return false;
        return true;
      })
      .map((seg) => seg.id),
  );
}

/**
 * Orden operativo Trimble completo.
 *
 * Usa route.optimizedOrder completo si existe, sin slice ni activeRouteBlock.
 * Si falta, cae al orden natural de route.segments.
 */
export function getTrimbleOrderIds(route: Route | null | undefined): string[] {
  if (!route) return [];

  const routeIds = route.segments.map((s) => s.id);
  const routeIdSet = new Set(routeIds);

  const optimizedValid = (route.optimizedOrder ?? []).filter((id) => routeIdSet.has(id));
  const seen = new Set(optimizedValid);
  const missing = routeIds.filter((id) => !seen.has(id));

  return [...optimizedValid, ...missing];
}