// SKIPPED por plan §15: en TRIMBLE_LIDAR el auto-envío de lote queda desactivado;
// el flujo principal de copiloto es el envío individual desde el overlay.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { TrimbleNavigationPanel } from '@/components/map-control/TrimbleNavigationPanel';
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

describe.skip('TrimbleNavigationPanel — no_capturable autoenvío', () => {
  beforeEach(() => {
    sessionStorage.clear();
    evt.logEvent.mockClear();
    ctx.value = trimbleCtx();
    const segs = Array.from({ length: 6 }, (_, i) => seg(`s${i}`, 40 + i * 0.01, -3));
    ctx.value.state = buildState(segs, [capOpen('s0')]);
    vi.useFakeTimers();
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('cerrar como no_capturable autoenvía si cambia el lote', async () => {
    const props = basicProps();
    const { rerender } = render(<TrimbleNavigationPanel {...(props as any)} />);

    fireEvent.click(screen.getByTestId('trimble-send-driver-btn'));
    await act(async () => { await Promise.resolve(); });
    (props.onCopilotPushQueue as any).mockClear();
    evt.logEvent.mockClear();

    // Click "No cap." (cierre como no_capturable)
    fireEvent.click(screen.getByRole('button', { name: /No cap\./ }));
    const segs = ctx.value.state.route.segments;
    ctx.value.state = buildState(segs, [capClosed('s0', 'no_capturable'), capOpen('s1')]);
    rerender(<TrimbleNavigationPanel {...(basicProps({ onCopilotPushQueue: props.onCopilotPushQueue }) as any)} />);
    await act(async () => { vi.advanceTimersByTime(1500); });

    expect(props.onCopilotPushQueue).toHaveBeenCalledTimes(1);
    const autoCall = evt.logEvent.mock.calls.find(
      (c: any) => c[0] === 'TRIMBLE_COPILOT_QUEUE_AUTO_SENT',
    );
    expect(autoCall).toBeDefined();
    expect((autoCall as any)[1].payload.reason).toBe('non_capturable');
  });

  it('cerrar como no_capturable NO autoenvía si el lote (fingerprint) no cambia', async () => {
    // Solo 1 segmento elegible; al cerrarlo como no_capturable, fullQueue=[],
    // driverBatch=[] → fingerprint='' → autosend bail-out (driverBatch.length===0).
    // Aquí probamos el caso opuesto: lote no cambia porque rerendezamos sin
    // mutar capturas. handleClose marca reason, pero fp no cambia.
    const props = basicProps();
    const { rerender } = render(<TrimbleNavigationPanel {...(props as any)} />);
    fireEvent.click(screen.getByTestId('trimble-send-driver-btn'));
    await act(async () => { await Promise.resolve(); });
    (props.onCopilotPushQueue as any).mockClear();

    fireEvent.click(screen.getByRole('button', { name: /No cap\./ }));
    // Rerender sin mutar capturas → mismo driverBatch → mismo fingerprint
    rerender(<TrimbleNavigationPanel {...(basicProps({ onCopilotPushQueue: props.onCopilotPushQueue }) as any)} />);
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(props.onCopilotPushQueue).not.toHaveBeenCalled();
  });
});
