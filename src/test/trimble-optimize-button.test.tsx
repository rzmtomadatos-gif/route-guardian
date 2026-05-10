import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { TrimbleNavigationPanel } from '@/components/map-control/TrimbleNavigationPanel';
import { seg, capOpen, buildState, makeCopilotSession, trimbleCtx } from './helpers/trimble-panel-harness';

const ctx = vi.hoisted(() => ({ value: null as any }));
vi.mock('@/context/RouteStateContext', () => ({
  useRouteStateContext: () => ctx.value,
}));
const evt = vi.hoisted(() => ({ logEvent: vi.fn(async () => ({})) }));
vi.mock('@/utils/persistence/event-log', () => ({ logEvent: evt.logEvent }));

function renderPanel(overrides: Partial<React.ComponentProps<typeof TrimbleNavigationPanel>> = {}) {
  const ids = ctx.value.state.route.segments.map((s: any) => s.id);
  const props = {
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
    gpsEnabled: false,
    gpsAccuracy: null,
    gpsSpeed: null,
    gpsError: null,
    onToggleGps: vi.fn(),
    onReoptimize: vi.fn(),
    onOpenAdvanced: vi.fn(),
    ...overrides,
  };
  const utils = render(<TrimbleNavigationPanel {...(props as any)} />);
  return { ...utils, props };
}

describe('TrimbleNavigationPanel — Optimizar todo', () => {
  beforeEach(() => {
    sessionStorage.clear();
    evt.logEvent.mockClear();
    ctx.value = trimbleCtx();
    const segs = Array.from({ length: 6 }, (_, i) => seg(`s${i}`, 40 + i * 0.01, -3));
    ctx.value.state = buildState(segs, [capOpen('s0')]);
    vi.useFakeTimers();
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('el botón "Optimizar todo" existe y llama onReoptimize', () => {
    const { props } = renderPanel();
    const btn = screen.getByTestId('trimble-optimize-all-btn');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(props.onReoptimize).toHaveBeenCalledTimes(1);
  });

  it('si tras optimizar el driverBatch cambia y hay copiloto activo, autoenvía con reason="optimized"', async () => {
    const { props, rerender } = renderPanel();

    // Pulsar "Optimizar todo" → marca pendingAutoReason='optimized'
    fireEvent.click(screen.getByTestId('trimble-optimize-all-btn'));
    expect(props.onReoptimize).toHaveBeenCalledTimes(1);

    // Simular el cambio de orden producido por la optimización: los IDs
    // del lote cambian (reordenamos los segmentos de la ruta).
    const newSegs = [
      seg('s2', 40.5, -3), seg('s1', 40.4, -3), seg('s0', 40.3, -3),
      seg('s3', 40.6, -3), seg('s4', 40.7, -3), seg('s5', 40.8, -3),
    ];
    ctx.value.state = buildState(newSegs, [capOpen('s2')]);
    const newIds = newSegs.map((s) => s.id);
    rerender(
      <TrimbleNavigationPanel
        {...(props as any)}
        trimbleEligibleSegmentIds={new Set(newIds)}
        orderIds={newIds}
      />,
    );

    // Debounce 1000ms
    await act(async () => { vi.advanceTimersByTime(1100); });

    expect(props.onCopilotPushQueue).toHaveBeenCalledTimes(1);
    // El primer item del payload corresponde a INICIO del nuevo primer tramo.
    const callItems = (props.onCopilotPushQueue as any).mock.calls[0][0];
    expect(callItems[0].segmentId).toBe('s2');
    // logEvent con reason='optimized' y autoSend=true
    const autoCall = evt.logEvent.mock.calls.find(
      (c: any) => c[0] === 'TRIMBLE_COPILOT_QUEUE_AUTO_SENT',
    );
    expect(autoCall).toBeDefined();
    expect((autoCall as any)[1].payload.reason).toBe('optimized');
    expect((autoCall as any)[1].payload.autoSend).toBe(true);
  });
});
