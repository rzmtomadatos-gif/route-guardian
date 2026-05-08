/**
 * TrimbleGpsLogger — wrapper sin UI para montar useTrimbleGpsLog dentro
 * del RouteStateProvider.
 *
 * - Solo registra en modo TRIMBLE_LIDAR (early-return en el hook).
 * - Convive con TrackGpsLogger sin solapamiento: useTrackGpsLog ignora
 *   modo Trimble y useTrimbleGpsLog ignora RST/Garmin.
 */
import { useTrimbleGpsLog } from '@/hooks/useTrimbleGpsLog';
import type { LatLng } from '@/types/route';

interface Props {
  geo: {
    position: LatLng | null;
    accuracy: number | null;
    speed: number | null;
    heading: number | null;
  };
}

export function TrimbleGpsLogger({ geo }: Props) {
  useTrimbleGpsLog(geo);
  return null;
}
