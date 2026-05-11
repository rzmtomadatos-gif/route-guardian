/**
 * Cerrar grabación con capturas automáticas (auto > 0) debe disparar
 * autoenvío al conductor con reason='auto_captured' cuando el driverBatch
 * cambia tras consolidar las capturas gps_auto.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { TrimbleNavigationPanel } from '@/components/map-control/TrimbleNavigationPanel';
import { seg, capClosed, buildState, makeCopilotSession, trimbleCtx } from './helpers/trimble-panel-harness';
import type { TrimbleRecordingSession } from '@/types/trimble';

const ctx = vi.hoisted(() => ({ value: null as any }));
vi.mock('@/context/RouteStateContext', () => ({
  useRouteStateContext: () => ctx.value,
}));
const evt = vi.hoisted(() => ({ logEvent: vi.fn(async () => ({})) }));
vi.mock('@/utils/persistence/event-log', () => ({ logEvent: evt.logEvent }));

function basicProps(extra: any = {}) {
  const ids = ctx.value.state.route.segments.map((s: any) => s.id);
  return {
    trimbleEligibleSegmentIds: new Set<string>(ids),
    orderIds: ids,
    copilotSession: makeCopilotSession(),
    copilotActive: true,
    onCopilotStart: vi.fn(async () => null),
    onCopilotEnd: vi.fn(async () => {}),
    onCopilotPushQueue: vi.fn(async () => {}),
    onSetActiveSegment: vi.fn(),
    onAddIncident: vi.fn(),
    currentPosition: { lat: 0, lng: 0 },
    gpsEnabled: true, gpsAccuracy: 5, gpsSpeed: 0, gpsError: null,
    onToggleGps: vi.fn(),
    onReoptimize: vi.fn(),
    onOpenAdvanced: vi.fn(),
    ...extra,
  };
}

function withRecording(state: any): any {
  const recording: TrimbleRecordingSession = {
    id: 'rec-1', missionId: 'mission-1', runId: 'run-1',
    startedAt: '2026-01-01T10:00:00Z', endedAt: null, status: 'active',
  };
  return {
    ...state,
    trimbleRecordingSessions: [recording],
    activeTrimbleRecordingId: 'rec-1',
  };
}

describe('TrimbleNavigationPanel — autoenvío tras cerrar grabación', () => {
  beforeEach(() => {
    sessionStorage.clear();
    evt.logEvent.mockClear();
    ctx.value = trimbleCtx();
    const segs = Array.from({ length: 6 }, (_, i) => seg(`s${i}`, 40 + i * 0.01, -3));
    ctx.value.state = withRecording(buildState(segs, []));
    vi.useFakeTimers();
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('close con autoCapturedCount>0 + cambio en driverBatch ⇒ push con reason=auto_captured', async () => {
    const props = basicProps();
    const { rerender } = render(<TrimbleNavigationPanel {...(props as any)} />);

    // Envío manual inicial para fijar fingerprint
    fireEvent.click(screen.getByTestId('trimble-send-driver-btn'));
    await act(async () => { await Promise.resolve(); });
    expect(props.onCopilotPushQueue).toHaveBeenCalledTimes(1);

    // Mock de close devolviendo capturas automáticas.
    // Reemplazar el mock antes de re-renderizar para que el nuevo closure
    // de handleCloseRecording recoja la versión con autoCapturedCount>0.
    ctx.value.closeTrimbleRecording = vi.fn(() => ({
      ok: true, recordingSessionId: 'rec-1',
      autoCapturedCount: 2, partialCount: 1, pointsAnalyzed: 123,
    }));
    rerender(<TrimbleNavigationPanel {...(basicProps({
      onCopilotPushQueue: props.onCopilotPushQueue,
    }) as any)} />);
    fireEvent.click(screen.getByTestId('trimble-close-recording-btn'));

    // Simular consolidación: s0 y s1 ahora capturados, recording cerrada → driverBatch cambia.
    const segs = ctx.value.state.route.segments;
    const next = buildState(segs, [capClosed('s0'), capClosed('s1')]);
    ctx.value.state = next; // sin recording activa
    rerender(<TrimbleNavigationPanel {...(basicProps({
      onCopilotPushQueue: props.onCopilotPushQueue,
    }) as any)} />);
    await act(async () => { vi.advanceTimersByTime(1500); });

    expect(props.onCopilotPushQueue).toHaveBeenCalledTimes(2);
    const autoCall = evt.logEvent.mock.calls.find(
      (c: any) => c[0] === 'TRIMBLE_COPILOT_QUEUE_AUTO_SENT',
    );
    expect(autoCall).toBeDefined();
    const payload = (autoCall as any)[1].payload;
    expect(payload.reason).toBe('auto_captured');
    expect(payload.recordingSessionId).toBe('rec-1');
    expect(payload.autoCapturedCount).toBe(2);
    expect(payload.partialCount).toBe(1);
    expect(payload.pointsAnalyzed).toBe(123);
  });
});
