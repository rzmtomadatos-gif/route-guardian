import { vi } from 'vitest';
import type { AppState, Segment } from '@/types/route';
import type { SegmentCapture } from '@/types/trimble';
import type { CopilotSession } from '@/hooks/useCopilotSession';

export function seg(id: string, lat = 0, lng = 0): Segment {
  return {
    id, routeId: 'r', trackNumber: null, plannedTrackNumber: null, trackHistory: [],
    kmlId: id, name: id, notes: '',
    coordinates: [{ lat, lng }, { lat: lat + 0.01, lng: lng + 0.01 }],
    direction: 'creciente', type: 'tramo', status: 'pendiente', kmlMeta: {},
  };
}

export function capClosed(segmentId: string, fieldStatus: SegmentCapture['fieldStatus'] = 'capturado_pendiente_proceso'): SegmentCapture {
  return {
    id: `c-${segmentId}`, segmentId, runId: 'run-1', missionId: 'mission-1',
    startedAt: '2026-01-01T10:00:00Z', endedAt: '2026-01-01T10:05:00Z',
    fieldStatus, qaStatus: null,
  };
}

export function capOpen(segmentId: string): SegmentCapture {
  return {
    id: `open-${segmentId}`, segmentId, runId: 'run-1', missionId: 'mission-1',
    startedAt: '2026-01-01T10:10:00Z', endedAt: null,
    fieldStatus: 'en_captura', qaStatus: null,
  };
}

export function buildState(segments: Segment[], captures: SegmentCapture[] = []): AppState {
  return {
    route: { id: 'r', name: 'r', loadedAt: '', fileName: '', segments, optimizedOrder: segments.map((s) => s.id) },
    incidents: [], activeSegmentId: null, navigationActive: false, currentPosition: null, base: null,
    rstMode: false, rstGroupSize: 9, trackSession: null,
    blockEndPrompt: { isOpen: false, trackNumber: null, reason: 'manual' },
    workDay: 1, acquisitionMode: 'TRIMBLE_LIDAR', lastConsumedTrackByDay: {},
    segmentCorrections: [], trackGpsLogsByDay: {},
    trimbleMissions: [{ id: 'mission-1', workDay: 1, startedAt: '2026-01-01T09:00:00Z', endedAt: null }],
    trimbleRuns: [{ id: 'run-1', missionId: 'mission-1', index: 1, direction: 'ida', startedAt: '2026-01-01T09:10:00Z', endedAt: null }],
    trimbleSegmentCaptures: captures,
    trimbleIncidents: [], trimbleDeliverables: [], trimbleGpsLogsByRun: {},
    activeMissionId: 'mission-1', activeRunId: 'run-1',
  } as AppState;
}

export function makeCopilotSession(): CopilotSession {
  return {
    id: 'cop-1', token: 'tok-1',
    segment_name: null, segment_id: null,
    destination_lat: null, destination_lng: null,
    status: 'waiting', track_number: null,
    queue: [], cursor_index: 0, batch_number: 0, batch_url: null,
  };
}

export const trimbleCtx = () => ({
  state: {} as AppState,
  startTrimbleMission: vi.fn(() => ({ ok: true })),
  closeTrimbleMission: vi.fn(() => ({ ok: true })),
  startTrimbleRun: vi.fn(() => ({ ok: true })),
  closeTrimbleRun: vi.fn(() => ({ ok: true })),
  startTrimbleCapture: vi.fn(() => ({ ok: true })),
  closeTrimbleCapture: vi.fn(() => ({ ok: true })),
  startTrimbleRecording: vi.fn(() => ({ ok: true, recordingId: 'rec-1' })),
  closeTrimbleRecording: vi.fn(() => ({ ok: true, autoCapturedCount: 0, partialCount: 0, pointsAnalyzed: 0 })),
});
