/**
 * Duplicación segura de tramos.
 *
 * Regla crítica:
 *   - El duplicado NUNCA hereda `companySegmentId` del original.
 *     Si lo hiciera, gabinete vería dos tramos con el mismo ID oficial y
 *     no podría auditar campañas. companySegmentId es único por tramo real.
 *
 * El duplicado nace como tramo nuevo "limpio", como si lo hubiera creado
 * manualmente el operador en el día actual.
 */
import type { AppState, Segment } from '@/types/route';

export interface DuplicateRecord {
  sourceSegmentId: string;
  newSegmentId: string;
  sourceCompanySegmentId?: string;
}

export interface DuplicateResult {
  state: AppState;
  records: DuplicateRecord[];
}

function freshId(): string {
  // Mismo patrón que el resto del hook — suficiente para uso local.
  return Math.random().toString(36).substring(2, 10);
}

export function applyDuplicate(
  state: AppState,
  segmentIds: string[],
  idGenerator: () => string = freshId,
): DuplicateResult {
  if (!state.route) return { state, records: [] };

  const newSegments: Segment[] = [];
  const records: DuplicateRecord[] = [];

  for (const id of segmentIds) {
    const orig = state.route.segments.find((s) => s.id === id);
    if (!orig) continue;
    const newId = idGenerator();
    const dup: Segment = {
      ...orig,
      id: newId,
      name: orig.name + ' (copia)',
      // NUNCA heredar el ID oficial.
      companySegmentId: undefined,
      status: 'pendiente',
      nonRecordable: false,
      needsRepeat: false,
      repeatRequested: false,
      trackNumber: null,
      plannedTrackNumber: null,
      plannedBy: undefined,
      segmentOrder: undefined,
      trackHistory: [],
      workDay: state.workDay,
      timestampInicio: undefined,
      timestampFin: undefined,
      startedAt: null,
      endedAt: null,
      failedAt: null,
      segmentStartSeconds: null,
      segmentEndSeconds: null,
      invalidatedByTrack: null,
      repeatNumber: 0,
    };
    newSegments.push(dup);
    records.push({
      sourceSegmentId: orig.id,
      newSegmentId: newId,
      sourceCompanySegmentId: orig.companySegmentId,
    });
  }

  return {
    state: {
      ...state,
      route: {
        ...state.route,
        segments: [...state.route.segments, ...newSegments],
        optimizedOrder: [
          ...state.route.optimizedOrder,
          ...newSegments.map((s) => s.id),
        ],
      },
    },
    records,
  };
}
