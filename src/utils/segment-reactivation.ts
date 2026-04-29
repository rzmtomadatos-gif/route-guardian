/**
 * Reactivación operativa de tramos para campo.
 *
 * Esta operación NO es una corrección reversible de gabinete.
 * Modifica el estado operativo base de un tramo para que el operador pueda
 * volver a navegarlo (típicamente para repetir grabación o salvar un tramo
 * que se marcó no grabable).
 *
 * Conserva sin tocar:
 *   - trackHistory          (intentos anteriores con su track real)
 *   - companySegmentId      (ID oficial del tramo)
 *   - notes, kml*, layer    (contexto descriptivo)
 *   - eventos previos en el log persistente
 *   - incidencias previas
 *
 * Limpia toda la traza operativa transitoria:
 *   - status → 'pendiente'
 *   - nonRecordable → false
 *   - needsRepeat → true       (señal explícita de "reintento")
 *   - repeatRequested → true   (compatibilidad con código legacy; deprecated)
 *   - workDay → targetWorkDay
 *   - trackNumber, plannedTrackNumber, plannedBy, segmentOrder, invalidatedByTrack → null/undef
 *   - timestampInicio/Fin, startedAt, endedAt, failedAt, segmentStart/EndSeconds → null/undef
 *
 * Si el tramo no está en `optimizedOrder`, lo añade al final (idempotente).
 */
import type { AppState, Segment } from '@/types/route';

export interface ReactivateOptions {
  targetWorkDay: number;
  reason: string;
  mode?: 'repeat_existing_segment';
}

export interface ReactivationSnapshot {
  segmentId: string;
  previousStatus: Segment['status'];
  previousWorkDay: number | undefined;
  previousTrackNumber: number | null;
  previousSegmentOrder: number | undefined;
  previousNonRecordable: boolean | undefined;
  previousNeedsRepeat: boolean | undefined;
}

export interface ReactivationResult {
  state: AppState;
  previousSnapshot: ReactivationSnapshot | null;
  changed: boolean;
}

/**
 * Función pura: aplica la reactivación sobre un AppState y devuelve el nuevo
 * estado más el snapshot del valor previo (para usar en el event log).
 *
 * No emite eventos ni persiste — eso es responsabilidad del hook que la envuelve.
 */
export function applyReactivation(
  state: AppState,
  segmentId: string,
  opts: ReactivateOptions,
): ReactivationResult {
  if (!state.route) {
    return { state, previousSnapshot: null, changed: false };
  }
  const seg = state.route.segments.find((s) => s.id === segmentId);
  if (!seg) {
    return { state, previousSnapshot: null, changed: false };
  }

  const previousSnapshot: ReactivationSnapshot = {
    segmentId,
    previousStatus: seg.status,
    previousWorkDay: seg.workDay,
    previousTrackNumber: seg.trackNumber,
    previousSegmentOrder: seg.segmentOrder,
    previousNonRecordable: seg.nonRecordable,
    previousNeedsRepeat: seg.needsRepeat,
  };

  const segments = state.route.segments.map((s) => {
    if (s.id !== segmentId) return s;
    return {
      ...s,
      status: 'pendiente' as const,
      nonRecordable: false,
      needsRepeat: true,
      // Deprecated, pero algunos componentes legacy aún lo leen:
      repeatRequested: true,
      workDay: opts.targetWorkDay,
      trackNumber: null,
      plannedTrackNumber: null,
      plannedBy: undefined,
      segmentOrder: undefined,
      timestampInicio: undefined,
      timestampFin: undefined,
      startedAt: null,
      endedAt: null,
      failedAt: null,
      segmentStartSeconds: null,
      segmentEndSeconds: null,
      invalidatedByTrack: null,
      // trackHistory NO se toca → conserva intentos previos.
      // companySegmentId NO se toca.
    };
  });

  const order = state.route.optimizedOrder.includes(segmentId)
    ? state.route.optimizedOrder
    : [...state.route.optimizedOrder, segmentId];

  return {
    state: {
      ...state,
      route: { ...state.route, segments, optimizedOrder: order },
    },
    previousSnapshot,
    changed: true,
  };
}
