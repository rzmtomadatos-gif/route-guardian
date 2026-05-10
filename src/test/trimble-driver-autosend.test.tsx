import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { TrimbleNavigationPanel } from '@/components/map-control/TrimbleNavigationPanel';
import { SEGMENTS_PER_BATCH } from '@/utils/google-maps-batch';
import { seg, capOpen, capClosed, buildState, makeCopilotSession, trimbleCtx } from './helpers/trimble-panel-harness';

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
    currentPosition: null,
    gpsEnabled: false, gpsAccuracy: null, gpsSpeed: null, gpsError: null,
    onToggleGps: vi.fn(),
    onReoptimize: vi.fn(),
    onOpenAdvanced: vi.fn(),
    ...extra,
  };
}

describe('TrimbleNavigationPanel — autoenvío al conductor', () => {
  beforeEach(() => {
    sessionStorage.clear();
    evt.logEvent.mockClear();
    ctx.value = trimbleCtx();
    const segs = Array.from({ length: 6 }, (_, i) => seg(`s${i}`, 40 + i * 0.01, -3));
    ctx.value.state = buildState(segs, [capOpen('s0')]);
    vi.useFakeTimers();
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('tras envío manual: 1 cierre no autoenvía, 2º sí; nuevo lote = primeros 4 de la cola; counter reseteado', async () => {
    const props = basicProps();
    const { rerender } = render(<TrimbleNavigationPanel {...(props as any)} />);

    // Envío manual inicial
    fireEvent.click(screen.getByTestId('trimble-send-driver-btn'));
    await act(async () => { await Promise.resolve(); });
    expect(props.onCopilotPushQueue).toHaveBeenCalledTimes(1);

    // 1er cierre 'capturado_pendiente_proceso'
    fireEvent.click(screen.getByText('Cerrar'));
    // Simular cambio de estado: s0 cerrado, s1 abierto
    const segs = ctx.value.state.route.segments;
    ctx.value.state = buildState(segs, [capClosed('s0'), capOpen('s1')]);
    rerender(<TrimbleNavigationPanel {...(basicProps({
      onCopilotPushQueue: props.onCopilotPushQueue,
    }) as any)} />);
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(props.onCopilotPushQueue).toHaveBeenCalledTimes(1); // sigue 1

    // 2º cierre 'capturado_pendiente_proceso' → debe autoenviar
    fireEvent.click(screen.getByText('Cerrar'));
    ctx.value.state = buildState(segs, [capClosed('s0'), capClosed('s1'), capOpen('s2')]);
    rerender(<TrimbleNavigationPanel {...(basicProps({
      onCopilotPushQueue: props.onCopilotPushQueue,
    }) as any)} />);
    await act(async () => { vi.advanceTimersByTime(1500); });

    expect(props.onCopilotPushQueue).toHaveBeenCalledTimes(2);
    const items = (props.onCopilotPushQueue as any).mock.calls[1][0];
    // driverBatch = primeros 4 (s2, s3, s4, s5)
    expect(items.length).toBe(SEGMENTS_PER_BATCH * 2);
    expect(items[0].segmentId).toBe('s2');
    expect(items[6].segmentId).toBe('s5');
    const autoCall = evt.logEvent.mock.calls.find(
      (c: any) => c[0] === 'TRIMBLE_COPILOT_QUEUE_AUTO_SENT',
    );
    expect(autoCall).toBeDefined();
    expect((autoCall as any)[1].payload.reason).toBe('two_completed');

    // Tras autoenvío: counter reseteado → cerrar 1 más NO autoenvía
    fireEvent.click(screen.getByText('Cerrar'));
    ctx.value.state = buildState(segs, [
      capClosed('s0'), capClosed('s1'), capClosed('s2'), capOpen('s3'),
    ]);
    rerender(<TrimbleNavigationPanel {...(basicProps({
      onCopilotPushQueue: props.onCopilotPushQueue,
    }) as any)} />);
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(props.onCopilotPushQueue).toHaveBeenCalledTimes(2);
  });
});
