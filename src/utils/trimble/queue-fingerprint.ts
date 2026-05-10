/**
 * Fingerprint estable de una cola operativa Trimble.
 *
 * Se usa para detectar cuándo la cola enviada al conductor (modo Copiloto)
 * ha quedado obsoleta tras cerrar/reabrir capturas o tras cambiar el orden,
 * los estados o la geometría inicial/final del tramo.
 *
 * Forma:
 *   "<idx>:<segId>:<status>:<startLat,startLng>:<endLat,endLng>|…"
 *
 * Coordenadas redondeadas a 6 decimales (~0.11 m a 40º lat) — suficiente
 * para detectar cualquier edición de geometría operativa.
 */
import type { TrimbleQueueItem } from '@/utils/trimble/recording-queue';

const r6 = (n: number): string => n.toFixed(6);

export function trimbleQueueFingerprint(
  queue: ReadonlyArray<Pick<TrimbleQueueItem, 'segment' | 'status' | 'start' | 'end'>>,
): string {
  return queue
    .map((q, i) =>
      `${i}:${q.segment.id}:${q.status}:${r6(q.start.lat)},${r6(q.start.lng)}:${r6(q.end.lat)},${r6(q.end.lng)}`,
    )
    .join('|');
}

/**
 * Clave de sessionStorage scopeada a la combinación operativa actual.
 * Si cambia campaña/ruta, misión o pasada → se obtiene una clave nueva
 * y por tanto el fingerprint guardado se considera ausente (cola desactualizada).
 */
export function trimbleFingerprintStorageKey(
  routeId: string | null | undefined,
  missionId: string | null | undefined,
  runId: string | null | undefined,
): string {
  return `vialroute.trimble.lastQueueFp.${routeId ?? '_'}.${missionId ?? '_'}.${runId ?? '_'}`;
}
