// SKIPPED por plan §15: en TRIMBLE_LIDAR el auto-envío de lote queda desactivado;
// el flujo principal de copiloto es el envío individual desde el overlay.

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

function basicProps(overrides: any = {}) {
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
    ...overrides,
  };
}

describe.skip('TrimbleNavigationPanel — autoenvío por cambio de capas', () => {
  beforeEach(() => {
    sessionStorage.clear();
    evt.logEvent.mockClear();
    ctx.value = trimbleCtx();
    const segs = Array.from({ length: 6 }, (_, i) => seg(`s${i}`, 40 + i * 0.01, -3));
    ctx.value.state = buildState(segs, [capOpen('s0')]);
    vi.useFakeTimers();
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('ocultar capa que retira el primer tramo del lote → autoenvía con reason="layer_changed"', async () => {
    const props = basicProps();
    const { rerender } = render(<TrimbleNavigationPanel {...(props as any)} />);

    fireEvent.click(screen.getByTestId('trimble-send-driver-btn'));
    await act(async () => { await Promise.resolve(); });
    (props.onCopilotPushQueue as any).mockClear();
    evt.logEvent.mockClear();

    // Ocultar la capa que contiene s0 → eligible queda s1..s5.
    // Simulado pasando un Set sin s0.
    const newEligible = new Set(['s1', 's2', 's3', 's4', 's5']);
    rerender(
      <TrimbleNavigationPanel
        {...(basicProps({ onCopilotPushQueue: props.onCopilotPushQueue }) as any)}
        trimbleEligibleSegmentIds={newEligible}
      />,
    );
    await act(async () => { vi.advanceTimersByTime(1500); });

    expect(props.onCopilotPushQueue).toHaveBeenCalledTimes(1);
    const autoCall = evt.logEvent.mock.calls.find(
      (c: any) => c[0] === 'TRIMBLE_COPILOT_QUEUE_AUTO_SENT',
    );
    expect(autoCall).toBeDefined();
    expect((autoCall as any)[1].payload.reason).toBe('layer_changed');
  });
});
