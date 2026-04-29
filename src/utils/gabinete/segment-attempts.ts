/**
 * Derivación del HISTORIAL DE INTENTOS por tramo, calculado sobre el
 * event-log persistente (append-only) + incidencias + estado actual.
 *
 * Un "intento" representa cada vez que el tramo se ha trabajado (o se ha
 * intentado trabajar) en una jornada concreta:
 *   - Día 1: grabado → 1 intento "completado".
 *   - Día 1 grabado, reactivado en Día 18 y grabado en Día 18 → 2 intentos.
 *   - Día 1 grabado, reactivado en Día 18 SIN grabar todavía →
 *     2 intentos: Día 1 completado + Día 18 pendiente (source='gabinete').
 *
 * Reglas (alineadas con el plan aprobado y su ajuste obligatorio):
 *
 *  - SEGMENT_STARTED        → abre intento `en_progreso` con datos del payload.
 *  - SEGMENT_COMPLETED      → cierra el último intento abierto del segmento
 *                             como `completado`, rellenando endedAt y segs.
 *  - SEGMENT_CANCELLED      → cierra el último abierto como `cancelado`.
 *  - SEGMENT_SKIPPED        → cierra el último abierto como `cancelado`
 *                             (`reason='skipped'`).
 *  - INCIDENT_RECORDED con impact 'critica_no_grabable' → cierra como
 *                             `no_grabable`.
 *  - INCIDENT_RECORDED con impact 'critica_invalida_bloque' → cierra como
 *                             `invalidado`.
 *  - SEGMENT_REACTIVATED_FOR_FIELD → guarda un MARCADOR pendiente para
 *                             (segmentId, targetWorkDay).
 *      · Si después aparece SEGMENT_STARTED con el mismo segmentId+workDay,
 *        se fusiona: el intento real hereda `source='gabinete'` y `reason`.
 *      · Si al terminar el log el marcador no se ha consumido, se materializa
 *        como intento sintético `pendiente` con `source='gabinete'`.
 *
 *  - Si un tramo en estado `completado` no tiene NINGÚN intento derivado
 *    (caso datos antiguos previos al enriquecimiento de eventos), se sintetiza
 *    un intento "fallback" desde el segmento actual (`source='system'`).
 *
 * Las incidencias se asocian al último intento abierto (o, si todas están
 * cerradas, al último cerrado del mismo `(segmentId, workDay, trackNumber)`).
 */
import type { Incident, Segment } from '@/types/route';
import type { PersistentEvent } from '@/utils/persistence/types';

export type SegmentAttemptStatus =
  | 'pendiente'
  | 'en_progreso'
  | 'completado'
  | 'no_grabable'
  | 'cancelado'
  | 'invalidado'
  | 'posible_repetir';

export interface SegmentAttempt {
  /** ID sintético: `${segmentId}#${index}` con `index` 1-based. */
  id: string;
  segmentId: string;
  companySegmentId?: string;
  segmentName?: string;
  workDay: number | null;
  trackNumber: number | null;
  segmentOrder?: number | null;
  status: SegmentAttemptStatus;
  startedAt?: string | null;
  endedAt?: string | null;
  segmentStartSeconds?: number | null;
  segmentEndSeconds?: number | null;
  acquisitionMode?: string | null;
  incidentIds: string[];
  source: 'field' | 'gabinete' | 'system';
  reason?: string;
}

interface MutableAttempt extends SegmentAttempt {
  open: boolean;
}

interface ReactivationMarker {
  segmentId: string;
  targetWorkDay: number;
  reason?: string;
  timestamp: string;
}

function readNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function readStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function deriveSegmentAttempts(
  eventLog: PersistentEvent[] | undefined | null,
  incidents: Incident[] | undefined | null,
  segments: Segment[] | undefined | null,
): SegmentAttempt[] {
  const segmentsById = new Map<string, Segment>();
  (segments ?? []).forEach((s) => segmentsById.set(s.id, s));

  // Atajos de salida: por segmento, lista ordenada de intentos (cerrados+abiertos).
  const attemptsBySegment = new Map<string, MutableAttempt[]>();
  // Marcadores de reactivación pendientes de fusionar, agrupados por
  // segmentId|workDay para fusión exacta y por segmentId para fallback.
  const markers = new Map<string, ReactivationMarker>(); // key: `${segId}|${workDay}`

  const incList = (incidents ?? []).slice();

  function pushAttempt(segId: string, attempt: MutableAttempt) {
    const arr = attemptsBySegment.get(segId);
    if (arr) arr.push(attempt); else attemptsBySegment.set(segId, [attempt]);
  }

  function lastOpen(segId: string): MutableAttempt | undefined {
    const arr = attemptsBySegment.get(segId);
    if (!arr) return undefined;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].open) return arr[i];
    }
    return undefined;
  }

  function closeAttempt(
    a: MutableAttempt,
    status: SegmentAttemptStatus,
    endedAt?: string | null,
    extra?: Partial<MutableAttempt>,
  ) {
    a.status = status;
    if (endedAt !== undefined) a.endedAt = endedAt;
    if (extra) Object.assign(a, extra);
    a.open = false;
  }

  // 1. Ordenar eventos por timestamp ascendente (estable por orden de entrada).
  const events = (eventLog ?? [])
    .slice()
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  for (const evt of events) {
    const segId = evt.segmentId;
    if (!segId) continue;
    const payload = (evt.payload ?? {}) as Record<string, unknown>;

    switch (evt.eventType) {
      case 'SEGMENT_STARTED': {
        const workDay =
          readNum(payload.workDay) ?? (typeof evt.workDay === 'number' ? evt.workDay : null);
        const trackNumber =
          readNum(payload.trackNumber) ?? (typeof evt.trackNumber === 'number' ? evt.trackNumber : null);

        // Marcador de reactivación previo para este segmentId+workDay → fusionar.
        const markerKey = `${segId}|${workDay ?? 'X'}`;
        const marker = markers.get(markerKey);
        const seg = segmentsById.get(segId);
        const arr = attemptsBySegment.get(segId);
        const idx = (arr?.length ?? 0) + 1;

        const attempt: MutableAttempt = {
          id: `${segId}#${idx}`,
          segmentId: segId,
          companySegmentId: seg?.companySegmentId,
          segmentName: seg?.name,
          workDay,
          trackNumber,
          segmentOrder: readNum(payload.segmentOrder) ?? null,
          status: 'en_progreso',
          startedAt: readStr(payload.startedAt) ?? evt.timestamp,
          endedAt: null,
          segmentStartSeconds: readNum(payload.segmentStartSeconds),
          segmentEndSeconds: null,
          acquisitionMode: readStr(payload.acquisitionMode),
          incidentIds: [],
          source: marker ? 'gabinete' : 'field',
          reason: marker?.reason,
          open: true,
        };
        pushAttempt(segId, attempt);
        if (marker) markers.delete(markerKey);
        break;
      }

      case 'SEGMENT_COMPLETED': {
        const open = lastOpen(segId);
        if (open) {
          closeAttempt(open, 'completado', readStr(payload.endedAt) ?? evt.timestamp, {
            trackNumber: readNum(payload.trackNumber) ?? open.trackNumber,
            segmentOrder: readNum(payload.segmentOrder) ?? open.segmentOrder,
            segmentEndSeconds: readNum(payload.segmentEndSeconds),
            segmentStartSeconds:
              readNum(payload.segmentStartSeconds) ?? open.segmentStartSeconds,
            acquisitionMode: readStr(payload.acquisitionMode) ?? open.acquisitionMode,
          });
        }
        break;
      }

      case 'SEGMENT_CANCELLED': {
        const open = lastOpen(segId);
        if (open) {
          closeAttempt(open, 'cancelado', evt.timestamp, {
            reason: readStr(payload.reason) ?? open.reason,
          });
        }
        break;
      }

      case 'SEGMENT_SKIPPED': {
        const open = lastOpen(segId);
        if (open) {
          closeAttempt(open, 'cancelado', evt.timestamp, { reason: 'skipped' });
        }
        break;
      }

      case 'INCIDENT_RECORDED': {
        const impact = readStr(payload.impact);
        const open = lastOpen(segId);
        if (open) {
          if (impact === 'critica_no_grabable') {
            closeAttempt(open, 'no_grabable', evt.timestamp, {
              reason: open.reason ?? 'incidencia critica_no_grabable',
            });
          } else if (impact === 'critica_invalida_bloque') {
            closeAttempt(open, 'invalidado', evt.timestamp, {
              reason: open.reason ?? 'incidencia critica_invalida_bloque',
            });
          }
        }
        break;
      }

      case 'SEGMENT_REACTIVATED_FOR_FIELD': {
        const targetWorkDay =
          readNum(payload.targetWorkDay) ??
          readNum(payload.workDay) ??
          (typeof evt.workDay === 'number' ? evt.workDay : null);
        if (targetWorkDay === null) break;
        // Si quedaba un intento abierto del mismo segmento, ciérralo como
        // posible_repetir (no se completó antes de la reactivación).
        const open = lastOpen(segId);
        if (open) closeAttempt(open, 'posible_repetir', evt.timestamp);
        const key = `${segId}|${targetWorkDay}`;
        markers.set(key, {
          segmentId: segId,
          targetWorkDay,
          reason: readStr(payload.reason),
          timestamp: evt.timestamp,
        });
        break;
      }

      default:
        break;
    }
  }

  // 2. Materializar marcadores no consumidos como intentos pendientes sintéticos.
  for (const marker of markers.values()) {
    const seg = segmentsById.get(marker.segmentId);
    const arr = attemptsBySegment.get(marker.segmentId);
    const idx = (arr?.length ?? 0) + 1;
    pushAttempt(marker.segmentId, {
      id: `${marker.segmentId}#${idx}`,
      segmentId: marker.segmentId,
      companySegmentId: seg?.companySegmentId,
      segmentName: seg?.name,
      workDay: marker.targetWorkDay,
      trackNumber: null,
      segmentOrder: null,
      status: 'pendiente',
      startedAt: null,
      endedAt: null,
      incidentIds: [],
      source: 'gabinete',
      reason: marker.reason,
      open: false,
    });
  }

  // 3. Asociar incidencias al intento más adecuado.
  for (const inc of incList) {
    const arr = attemptsBySegment.get(inc.segmentId);
    if (!arr || arr.length === 0) continue;
    // Preferimos un intento con (workDay, track) coincidente con la incidencia.
    const wd = inc.workDayAtIncident ?? null;
    const tk = inc.trackAtIncident ?? null;
    let target = arr.find(
      (a) =>
        (wd === null || a.workDay === wd) &&
        (tk === null || a.trackNumber === tk),
    );
    if (!target) target = arr[arr.length - 1];
    target.incidentIds.push(inc.id);
  }

  // 4. Fallback: tramos completados sin ningún intento derivado del log.
  for (const seg of segments ?? []) {
    if (attemptsBySegment.has(seg.id)) continue;
    if (seg.status !== 'completado') continue;
    pushAttempt(seg.id, {
      id: `${seg.id}#1`,
      segmentId: seg.id,
      companySegmentId: seg.companySegmentId,
      segmentName: seg.name,
      workDay: seg.workDay ?? null,
      trackNumber: seg.trackNumber,
      segmentOrder: seg.segmentOrder ?? null,
      status: 'completado',
      startedAt: seg.startedAt ?? seg.timestampInicio ?? null,
      endedAt: seg.endedAt ?? seg.timestampFin ?? null,
      segmentStartSeconds: seg.segmentStartSeconds ?? null,
      segmentEndSeconds: seg.segmentEndSeconds ?? null,
      incidentIds: [],
      source: 'system',
      open: false,
    });
  }

  // 5. Aplanar y ordenar: por workDay → trackNumber → startedAt → id.
  const out: SegmentAttempt[] = [];
  for (const arr of attemptsBySegment.values()) {
    for (const a of arr) {
      // Quitar `open` antes de exponer.
      const { open: _open, ...rest } = a;
      out.push(rest);
    }
  }
  out.sort((a, b) => {
    const wa = a.workDay ?? Number.POSITIVE_INFINITY;
    const wb = b.workDay ?? Number.POSITIVE_INFINITY;
    if (wa !== wb) return wa - wb;
    const ta = a.trackNumber ?? Number.POSITIVE_INFINITY;
    const tb = b.trackNumber ?? Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    const sa = a.startedAt ?? '';
    const sb = b.startedAt ?? '';
    if (sa !== sb) return sa.localeCompare(sb);
    return a.id.localeCompare(b.id);
  });
  return out;
}
