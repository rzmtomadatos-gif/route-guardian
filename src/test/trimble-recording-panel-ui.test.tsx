/**
 * UI real del TrimbleNavigationPanel para grabación continua + cobertura en vivo.
 *
 * Cubre:
 *  - Sin grabación: botón "Iniciar grabación continua", sin bloque de cobertura.
 *  - Con grabación + puntos GPS: muestra "Grabando · N pts" y bloque
 *    "Cobertura en vivo" con los tramos detectados.
 *  - Click en "invalidar" pide motivo y llama a invalidateTrimbleRecording.
 *  - Tras invalidación (estado sin activeTrimbleRecordingId) el bloque
 *    "Cobertura en vivo" desaparece.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TrimbleNavigationPanel } from '@/components/map-control/TrimbleNavigationPanel';
import type { AppState, Segment } from '@/types/route';
import type { TrimbleGpsPoint, TrimbleRecordingSession } from '@/types/trimble';

const ctx = vi.hoisted(() => ({
  state: {} as AppState,
  startTrimbleMission: vi.fn(() => ({ ok: true })),
  closeTrimbleMission: vi.fn(() => ({ ok: true })),
  startTrimbleRun: vi.fn(() => ({ ok: true })),
  closeTrimbleRun: vi.fn(() => ({ ok: true })),
  startTrimbleCapture: vi.fn(() => ({ ok: true })),
  closeTrimbleCapture: vi.fn(() => ({ ok: true })),
  startTrimbleRecording: vi.fn(() => ({ ok: true, recordingId: 'rec-1' })),
  closeTrimbleRecording: vi.fn(() => ({ ok: true, autoCapturedCount: 0, partialCount: 0, pointsAnalyzed: 0 })),
  invalidateTrimbleRecording: vi.fn(() => ({ ok: true })),
}));

vi.mock('@/context/RouteStateContext', () => ({
  useRouteStateContext: () => ctx,
}));

function seg(id: string): Segment {
  return {
    id, routeId: 'r', trackNumber: null, plannedTrackNumber: null, trackHistory: [],
    kmlId: id, name: id, notes: '',
    coordinates: [{ lat: 40, lng: -3.7 }, { lat: 40.001, lng: -3.7 }],
    direction: 'creciente', type: 'tramo', status: 'pendiente', kmlMeta: {},
  } as Segment;
}

function baseState(opts: {
  recording?: TrimbleRecordingSession | null;
  points?: TrimbleGpsPoint[];
}): AppState {
  const segments = [seg('A'), seg('B')];
  const recId = opts.recording?.id ?? null;
  return {
    route: { id: 'r', name: 'r', loadedAt: '', fileName: '', segments, optimizedOrder: ['A', 'B'] },
    incidents: [], activeSegmentId: null, navigationActive: false, currentPosition: null, base: null,
    rstMode: false, rstGroupSize: 9, trackSession: null,
    blockEndPrompt: { isOpen: false, trackNumber: null, reason: 'manual' },
    workDay: 1, acquisitionMode: 'TRIMBLE_LIDAR', lastConsumedTrackByDay: {},
    segmentCorrections: [], trackGpsLogsByDay: {},
    trimbleMissions: [{ id: 'mission-1', workDay: 1, startedAt: '2026-01-01T09:00:00Z', endedAt: null }],
    trimbleRuns: [{ id: 'run-1', missionId: 'mission-1', index: 1, direction: 'ida', startedAt: '2026-01-01T09:10:00Z', endedAt: null }],
    trimbleSegmentCaptures: [],
    trimbleIncidents: [], trimbleDeliverables: [],
    trimbleGpsLogsByRun: opts.points ? { 'run-1': opts.points } : {},
    activeMissionId: 'mission-1', activeRunId: 'run-1',
    trimbleRecordingSessions: opts.recording ? [opts.recording] : [],
    activeTrimbleRecordingId: recId,
  } as AppState;
}

function renderPanel() {
  return render(
    <TrimbleNavigationPanel
      trimbleEligibleSegmentIds={new Set(['A', 'B'])}
      orderIds={['A', 'B']}
      copilotSession={null}
      copilotActive={false}
      onCopilotStart={async () => null}
      onCopilotEnd={async () => {}}
      onCopilotGeneratePairing={async () => null}
      onCopilotPushQueue={async () => {}}
      onSetActiveSegment={() => {}}
      onAddIncident={() => {}}
      currentPosition={{ lat: 40.0005, lng: -3.7 }}
      gpsEnabled={true}
      gpsAccuracy={5}
      gpsSpeed={10}
      gpsError={null}
      onToggleGps={() => {}}
      onReoptimize={() => {}}
      onOpenAdvanced={() => {}}
    />,
  );
}

describe('TrimbleNavigationPanel — UI grabación continua', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    Object.values(ctx).forEach((v) => { if (typeof v === 'function' && 'mockClear' in v) (v as any).mockClear(); });
  });
  afterEach(() => cleanup());

  it('sin grabación activa: muestra botón iniciar y NO bloque cobertura', () => {
    ctx.state = baseState({});
    renderPanel();
    expect(screen.getByTestId('trimble-start-recording-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('trimble-live-coverage-block')).not.toBeInTheDocument();
    expect(screen.queryByTestId('trimble-invalidate-recording-btn')).not.toBeInTheDocument();
  });

  it('con grabación activa + puntos GPS: muestra bloque cobertura y botón invalidar', () => {
    const recording: TrimbleRecordingSession = {
      id: 'rec-1', missionId: 'mission-1', runId: 'run-1',
      startedAt: '2026-01-01T10:00:00Z', endedAt: null, status: 'active',
    };
    const points: TrimbleGpsPoint[] = Array.from({ length: 8 }, (_, i) => ({
      timestamp: new Date(Date.UTC(2026, 0, 1, 10, 0, i * 5)).toISOString(),
      lat: 40 + (i / 7) * 0.001, lng: -3.7,
      missionId: 'mission-1', runId: 'run-1', phase: 'capture',
      source: 'gps', recordingSessionId: 'rec-1',
    }));
    ctx.state = baseState({ recording, points });

    renderPanel();
    expect(screen.getByTestId('trimble-close-recording-btn')).toBeInTheDocument();
    expect(screen.getByTestId('trimble-invalidate-recording-btn')).toBeInTheDocument();
    expect(screen.getByTestId('trimble-live-coverage-block')).toBeInTheDocument();
    // Indicador "Grabando · N pts"
    expect(screen.getByText(/Grabando · 8 pts/)).toBeInTheDocument();
    // Al menos un tramo listado (A o B detectado por proximidad)
    const block = screen.getByTestId('trimble-live-coverage-block');
    expect(block.textContent).toMatch(/A|B/);
  });

  it('click en invalidar pide motivo y llama a invalidateTrimbleRecording', () => {
    const recording: TrimbleRecordingSession = {
      id: 'rec-1', missionId: 'mission-1', runId: 'run-1',
      startedAt: '2026-01-01T10:00:00Z', endedAt: null, status: 'active',
    };
    ctx.state = baseState({ recording, points: [] });
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('fallo sensor');

    renderPanel();
    fireEvent.click(screen.getByTestId('trimble-invalidate-recording-btn'));

    expect(promptSpy).toHaveBeenCalled();
    expect(ctx.invalidateTrimbleRecording).toHaveBeenCalledWith('fallo sensor');
    promptSpy.mockRestore();
  });

  it('tras invalidación (estado sin activeTrimbleRecordingId) el bloque cobertura desaparece', () => {
    // 1ª render con grabación
    const recording: TrimbleRecordingSession = {
      id: 'rec-1', missionId: 'mission-1', runId: 'run-1',
      startedAt: '2026-01-01T10:00:00Z', endedAt: null, status: 'active',
    };
    ctx.state = baseState({ recording, points: [] });
    const { rerender } = renderPanel();
    expect(screen.getByTestId('trimble-live-coverage-block')).toBeInTheDocument();

    // 2ª render simulando que el estado ya marcó la sesión invalidated y limpió activeId
    ctx.state = baseState({});
    rerender(
      <TrimbleNavigationPanel
        trimbleEligibleSegmentIds={new Set(['A', 'B'])}
        orderIds={['A', 'B']}
        copilotSession={null}
        copilotActive={false}
        onCopilotStart={async () => null}
        onCopilotEnd={async () => {}}
        onCopilotGeneratePairing={async () => null}
        onCopilotPushQueue={async () => {}}
        onSetActiveSegment={() => {}}
        onAddIncident={() => {}}
        currentPosition={{ lat: 40.0005, lng: -3.7 }}
        gpsEnabled={true}
        gpsAccuracy={5}
        gpsSpeed={10}
        gpsError={null}
        onToggleGps={() => {}}
        onReoptimize={() => {}}
        onOpenAdvanced={() => {}}
      />,
    );
    expect(screen.queryByTestId('trimble-live-coverage-block')).not.toBeInTheDocument();
    expect(screen.getByTestId('trimble-start-recording-btn')).toBeInTheDocument();
  });
});
