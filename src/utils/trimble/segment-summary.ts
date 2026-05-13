/**
 * Resúmenes derivados por tramo a partir de capturas Trimble.
 *
 * Se usa en SegmentsPage y Gabinete para mostrar última misión, última
 * pasada, fecha de captura, intentos y entregables sin recalcular en cada
 * componente.
 */
import type { CaptureMission, CaptureRun, SegmentCapture, TrimbleDeliverable } from '@/types/trimble';

export interface TrimbleSegmentSummary {
  attempts: number;
  lastCaptureAt: string | null;
  lastMissionId: string | null;
  lastMissionWorkDay: number | null;
  lastRunId: string | null;
  lastRunIndex: number | null;
  deliverableCount: number;
}

const EMPTY: TrimbleSegmentSummary = {
  attempts: 0,
  lastCaptureAt: null,
  lastMissionId: null,
  lastMissionWorkDay: null,
  lastRunId: null,
  lastRunIndex: null,
  deliverableCount: 0,
};

export function buildTrimbleSegmentSummary(
  segmentId: string,
  captures: ReadonlyArray<SegmentCapture>,
  missions: ReadonlyArray<CaptureMission>,
  runs: ReadonlyArray<CaptureRun>,
  deliverables: ReadonlyArray<TrimbleDeliverable>,
): TrimbleSegmentSummary {
  let attempts = 0;
  let last: SegmentCapture | null = null;
  for (const c of captures) {
    if (c.segmentId !== segmentId) continue;
    // Capturas voided no cuentan como intento activo ni como "última".
    if (c.voidedAt != null) continue;
    attempts++;
    const ref = c.endedAt ?? c.startedAt;
    const lastRef = last ? (last.endedAt ?? last.startedAt) : '';
    if (ref > lastRef) last = c;
  }
  if (!last) {
    const dCount = deliverables.filter((d) => d.segmentId === segmentId).length;
    return { ...EMPTY, deliverableCount: dCount };
  }
  const mission = missions.find((m) => m.id === last!.missionId) ?? null;
  const run = runs.find((r) => r.id === last!.runId) ?? null;
  const dCount = deliverables.filter((d) => d.segmentId === segmentId).length;
  return {
    attempts,
    lastCaptureAt: last.endedAt ?? last.startedAt,
    lastMissionId: mission?.id ?? null,
    lastMissionWorkDay: mission?.workDay ?? null,
    lastRunId: run?.id ?? null,
    lastRunIndex: run?.index ?? null,
    deliverableCount: dCount,
  };
}
