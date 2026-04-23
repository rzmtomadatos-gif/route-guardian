/**
 * TrackGpsLogger — wrapper sin UI para montar useTrackGpsLog dentro del
 * RouteStateProvider. El hook necesita useRouteStateContext, así que no
 * puede invocarse en el mismo componente que crea el provider.
 *
 * Solo registra GPS — no renderiza nada.
 */
import { useTrackGpsLog } from '@/hooks/useTrackGpsLog';
import type { LatLng } from '@/types/route';

interface Props {
  geo: {
    position: LatLng | null;
    accuracy: number | null;
    speed: number | null;
    heading: number | null;
  };
}

export function TrackGpsLogger({ geo }: Props) {
  useTrackGpsLog(geo);
  return null;
}
