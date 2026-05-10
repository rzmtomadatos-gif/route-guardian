import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TrimbleNavigationPanel } from '@/components/map-control/TrimbleNavigationPanel';
import { SEGMENTS_PER_BATCH } from '@/utils/google-maps-batch';
import type { AppState, Segment } from '@/types/route';
import type { SegmentCapture } from '@/types/trimble';

const trimbleContext = vi.hoisted(() => ({
  state: {} as AppState,
  startTrimbleMission: vi.fn(() => ({ ok: true })),
  closeTrimbleMission: vi.fn(() => ({ ok: true })),
  startTrimbleRun: vi.fn(() => ({ ok: true })),
  closeTrimbleRun: vi.fn(() => ({ ok: true })),
  startTrimbleCapture: vi.fn(() => ({ ok: true })),
  closeTrimbleCapture: vi.fn(() => ({ ok: true })),
}));

vi.mock('@/context/RouteStateContext', () => ({
  useRouteStateContext: () => trimbleContext,
}));

function seg(id: string): Segment {
  return {
    id, routeId: 'r', trackNumber: null, plannedTrackNumber: null, trackHistory: [],
    kmlId: id, name: id, notes: '', coordinates: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }],
    direction: 'creciente', type: 'tramo', status: 'pendiente', kmlMeta: {},
  };
}

function cap(segmentId: string): SegmentCapture {
  return {
    id: `c-${segmentId}`,
    segmentId,
    runId: 'run-1',
    missionId: 'mission-1',
    startedAt: '2026-01-01T10:00:00Z',
    endedAt: '2026-01-01T10:05:00Z',
    fieldStatus: 'capturado_pendiente_proceso',
    qaStatus: null,
  };
}

function stateWith(segments: Segment[], captures: SegmentCapture[] = []): AppState {
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

function renderPanel(segments: Segment[]) {
  const ids = segments.map((s) => s.id);
  return render(
    <TrimbleNavigationPanel
      trimbleEligibleSegmentIds={new Set(ids)}
      orderIds={ids}
      copilotSession={null}
      copilotActive={false}
      onCopilotStart={async () => null}
      onCopilotEnd={async () => {}}
      onCopilotPushQueue={async () => {}}
      onSetActiveSegment={() => {}}
      onAddIncident={() => {}}
      currentPosition={null}
      gpsEnabled={false}
      gpsAccuracy={null}
      gpsSpeed={null}
      gpsError={null}
      onToggleGps={() => {}}
      onReoptimize={() => {}}
      onOpenAdvanced={() => {}}
    />,
  );
}

describe('TrimbleNavigationPanel — cola completa vs lote conductor', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    infoSpy.mockRestore();
  });

  it('con 500 tramos: fullQueue=500, driverBatch=4 y Pendientes después=496', () => {
    const segments = Array.from({ length: 500 }, (_, i) => seg(`S${i}`));
    trimbleContext.state = stateWith(segments);

    renderPanel(segments);

    expect(screen.getByText('Pendientes después: 496')).toBeInTheDocument();
    expect(screen.getByText(`8 paradas / ${SEGMENTS_PER_BATCH} tramos`)).toBeInTheDocument();
    expect(infoSpy).toHaveBeenCalledWith('[TRIMBLE QUEUE DEBUG]', expect.objectContaining({
      routeSegments: 500,
      eligibleIds: 500,
      orderIds: 500,
      fullQueue: 500,
      driverBatch: 4,
      remainingAfterBatch: 496,
    }));
  });

  it('tras cerrar 4 capturas: fullQueue=496 y no aparece cola vacía', () => {
    const segments = Array.from({ length: 500 }, (_, i) => seg(`S${i}`));
    trimbleContext.state = stateWith(segments, segments.slice(0, 4).map((s) => cap(s.id)));

    renderPanel(segments);

    expect(screen.queryByText('No hay tramos pendientes/repetir en las capas activas.')).not.toBeInTheDocument();
    expect(infoSpy).toHaveBeenCalledWith('[TRIMBLE QUEUE DEBUG]', expect.objectContaining({
      fullQueue: 496,
      driverBatch: 4,
      remainingAfterBatch: 492,
    }));
  });
});