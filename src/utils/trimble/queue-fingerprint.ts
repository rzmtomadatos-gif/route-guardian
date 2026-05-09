/**
 * Fingerprint estable de una cola operativa Trimble.
 *
 * Se usa para detectar cuándo la cola enviada al conductor (modo Copiloto)
 * ha quedado obsoleta tras cerrar/reabrir capturas. El panel del mapa
 * compara el fingerprint actual con el último enviado y, si cambia, marca
 * "Ruta del conductor desactualizada" y permite reenviar.
 *
 * Forma:
 *   "<segId1>:<status1>|<segId2>:<status2>|…"
 *
 * No incluye coordenadas porque, dentro de la misma campaña, un cambio de
 * coordenadas implica un cambio de segmentId distinto. Si en el futuro el
 * mismo segmentId puede tener geometría editada, añadir un hash corto.
 */
import type { TrimbleQueueItem } from '@/utils/trimble/recording-queue';

export function trimbleQueueFingerprint(
  queue: ReadonlyArray<Pick<TrimbleQueueItem, 'segment' | 'status'>>,
): string {
  return queue.map((q) => `${q.segment.id}:${q.status}`).join('|');
}
