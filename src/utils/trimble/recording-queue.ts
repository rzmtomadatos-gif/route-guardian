/**
 * Cola operativa Trimble: deriva qué tramos toca capturar siguiendo el orden
 * operativo del mapa (`activeRouteBlock` o `optimizedOrder`) y excluyendo
 * tramos ya cerrados (capturados / OK / descartados / no capturables).
 *
 * Contrato:
 *  - Estado por tramo se deriva con `deriveTrimbleSegmentStatus` mirando solo
 *    la ÚLTIMA captura cerrada (más una abierta en el run activo).
 *  - La cola incluye: pendiente, en_captura, repetir.
 *  - La cola excluye: capturado_pendiente_proceso, procesado_ok,
 *    procesado_con_observaciones, descartado_por_calidad, no_capturable.
 *  - Filtra tramos sin geometría útil (`coordinates.length < 2`) y los cuenta
 *    como `skippedNoGeometry` para que el panel pueda mostrar un aviso.
 */
import type { AppState, LatLng, Segment } from '@/types/route';
import type { SegmentCapture, TrimbleSegmentStatus } from '@/types/trimble';
import { SEGMENTS_PER_BATCH, type BatchStop } from '@/utils/google-maps-batch';
import { getTrimbleCorridorKey, getTrimbleCorridorPart } from '@/utils/trimble/corridor';

const QUEUE_INCLUDE: ReadonlySet<TrimbleSegmentStatus> = new Set([
  'pendiente',
  'en_captura',
  'repetir',
]);

/**
 * Estado Trimble del tramo según sus capturas.
 *
 * Reglas estrictas (en este orden):
 *  1. Si hay captura abierta del segmento en el run activo → 'en_captura'.
 *  2. Si no, tomar la última captura cerrada (mayor `endedAt`).
 *     - Si tiene `qaStatus` no nulo → devolver `qaStatus`.
 *     - Si no, devolver su `fieldStatus`.
 *  3. Si no hay capturas → 'pendiente'.
 */
export function deriveTrimbleSegmentStatus(
  segmentId: string,
  captures: SegmentCapture[],
  activeRunId: string | null,
): TrimbleSegmentStatus {
  let openInRun: SegmentCapture | null = null;
  const closed: SegmentCapture[] = [];
  for (const c of captures) {
    if (c.segmentId !== segmentId) continue;
    // Capturas voided NO cuentan como estado activo (solo trazabilidad).
    if (c.voidedAt != null) continue;
    if (c.endedAt === null) {
      if (activeRunId && c.runId === activeRunId) openInRun = c;
      continue;
    }
    closed.push(c);
  }
  if (openInRun) return 'en_captura';
  if (closed.length === 0) return 'pendiente';
  // Última cerrada por endedAt (string ISO, comparación lexicográfica válida).
  let last = closed[0];
  for (let i = 1; i < closed.length; i++) {
    if ((closed[i].endedAt ?? '') > (last.endedAt ?? '')) last = closed[i];
  }
  if (last.qaStatus) return last.qaStatus;
  return last.fieldStatus;
}

export interface TrimbleQueueItem {
  segment: Segment;
  status: TrimbleSegmentStatus;
  start: LatLng;
  end: LatLng;
  positionInOrder: number;
}

export interface TrimbleQueueResult {
  items: TrimbleQueueItem[];
  /** Tramos descartados por geometría < 2 puntos (informativo, no rompe). */
  skippedNoGeometry: string[];
}

/**
 * Construye la cola operativa Trimble COMPLETA con regla de corredor.
 *
 * Recorre TODO `orderIds` y devuelve los tramos accionables
 * (pendiente / en_captura / repetir) cuyas capas estén activas, agrupados
 * por corredor: una vez iniciado un corredor compuesto (p.ej. "AVDA ESPAÑA
 * 1/8"), TODAS sus partes accionables se consumen antes de saltar a otro
 * corredor, aunque en optimizedOrder estuviesen intercaladas.
 *
 * Reglas:
 *  - Una incidencia (no_capturable / procesado_*) en una parte saca esa
 *    parte concreta de la cola, pero NO rompe el corredor.
 *  - El estado `repetir` mantiene la parte en la cola del corredor.
 *  - El límite del lote del conductor (SEGMENTS_PER_BATCH = 4) NO se aplica
 *    aquí; se aplica al construir `driverBatch` en TrimbleNavigationPanel.
 *  - El viewport del mapa NO debe usarse como filtro: pásese el conjunto
 *    de tramos elegibles por capas activas (`trimbleEligibleSegmentIds`).
 *
 * @param state              AppState (lee `route.segments`, capturas, activeRunId).
 * @param eligibleSegmentIds IDs de tramos elegibles (capas activas, NO viewport).
 * @param orderIds           Orden operativo (`route.optimizedOrder` o `segments`).
 * @param limit              Máx. tramos. Por defecto sin límite (Infinity).
 */
export function buildTrimbleRecordingQueue(
  state: AppState,
  eligibleSegmentIds: Set<string>,
  orderIds: string[],
  limit: number = Number.POSITIVE_INFINITY,
): TrimbleQueueResult {
  const route = state.route;
  if (!route) return { items: [], skippedNoGeometry: [] };
  const captures = state.trimbleSegmentCaptures ?? [];
  const activeRunId = state.activeRunId;
  const segById = new Map<string, Segment>();
  for (const s of route.segments) segById.set(s.id, s);

  // 1) Construir lista plana de candidatos accionables, en orden de optimizedOrder.
  const candidates: TrimbleQueueItem[] = [];
  const skippedNoGeometry: string[] = [];

  for (let i = 0; i < orderIds.length; i++) {
    const id = orderIds[i];
    if (!eligibleSegmentIds.has(id)) continue;
    const segment = segById.get(id);
    if (!segment) continue;
    const status = deriveTrimbleSegmentStatus(id, captures, activeRunId);
    if (!QUEUE_INCLUDE.has(status)) continue;
    if (segment.coordinates.length < 2) {
      skippedNoGeometry.push(id);
      continue;
    }
    const start = segment.coordinates[0];
    const end = segment.coordinates[segment.coordinates.length - 1];
    candidates.push({ segment, status, start, end, positionInOrder: i });
  }

  // 2) Agrupar por corredor preservando el orden de primera aparición
  //    en optimizedOrder. Esto garantiza que, una vez iniciado un corredor
  //    compuesto (p.ej. "AVDA ESPAÑA"), todas sus partes accionables se
  //    consumen antes de saltar a otro corredor — incluso si en
  //    optimizedOrder estaban intercaladas con otras calles.
  const groupOrder: string[] = [];
  const groups = new Map<string, TrimbleQueueItem[]>();
  for (const c of candidates) {
    const key = getTrimbleCorridorKey(c.segment);
    let g = groups.get(key);
    if (!g) {
      g = [];
      groups.set(key, g);
      groupOrder.push(key);
    }
    g.push(c);
  }

  // 3) Dentro de cada corredor: ordenar por número de parte si se conoce,
  //    si no, conservar el orden original de optimizedOrder.
  for (const key of groupOrder) {
    const arr = groups.get(key)!;
    arr.sort((a, b) => {
      const pa = getTrimbleCorridorPart(a.segment);
      const pb = getTrimbleCorridorPart(b.segment);
      if (pa !== null && pb !== null && pa !== pb) return pa - pb;
      if (pa !== null && pb === null) return -1;
      if (pa === null && pb !== null) return 1;
      return a.positionInOrder - b.positionInOrder;
    });
  }

  // 4) Aplanar respetando el orden de corredores y aplicar `limit`.
  const items: TrimbleQueueItem[] = [];
  for (const key of groupOrder) {
    for (const it of groups.get(key)!) {
      if (items.length >= limit) break;
      items.push(it);
    }
    if (items.length >= limit) break;
  }
  return { items, skippedNoGeometry };
}

/**
 * Wrapper sobre `segmentsToStops` para una cola Trimble.
 * Cada item produce 2 paradas (INICIO, FIN).
 */
export function trimbleQueueToStops(
  queue: Array<{ start: LatLng; end: LatLng }>,
): BatchStop[] {
  const stops: BatchStop[] = [];
  for (const q of queue) {
    stops.push({ lat: q.start.lat, lng: q.start.lng });
    stops.push({ lat: q.end.lat, lng: q.end.lng });
  }
  return stops;
}
