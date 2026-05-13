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

describe.skip('TrimbleNavigationPanel — anti-spam autoenvío', () => {
  beforeEach(() => {
    sessionStorage.clear();
    evt.logEvent.mockClear();
    ctx.value = trimbleCtx();
    const segs = Array.from({ length: 6 }, (_, i) => seg(`s${i}`, 40 + i * 0.01, -3));
    ctx.value.state = buildState(segs, [capOpen('s0')]);
    vi.useFakeTimers();
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('varios cambios rápidos de cola producen un solo envío tras debounce', async () => {
    const props = basicProps();
    const { rerender } = render(<TrimbleNavigationPanel {...(props as any)} />);

    // Envío manual inicial para fijar lastSentFp
    fireEvent.click(screen.getByTestId('trimble-send-driver-btn'));
    await act(async () => { await Promise.resolve(); });
    (props.onCopilotPushQueue as any).mockClear();

    // Disparar 2 cierres consecutivos sin avanzar timers (rápido)
    fireEvent.click(screen.getByRole('button', { name: /^Cerrar$/ }));
    const segs = ctx.value.state.route.segments;
    ctx.value.state = buildState(segs, [capClosed('s0'), capOpen('s1')]);
    rerender(<TrimbleNavigationPanel {...(basicProps({ onCopilotPushQueue: props.onCopilotPushQueue }) as any)} />);
    await act(async () => { vi.advanceTimersByTime(200); });

    fireEvent.click(screen.getByRole('button', { name: /^Cerrar$/ }));
    ctx.value.state = buildState(segs, [capClosed('s0'), capClosed('s1'), capOpen('s2')]);
    rerender(<TrimbleNavigationPanel {...(basicProps({ onCopilotPushQueue: props.onCopilotPushQueue }) as any)} />);
    await act(async () => { vi.advanceTimersByTime(200); });

    // Aún no se ha completado el debounce de 1000ms desde el último cambio
    expect(props.onCopilotPushQueue).not.toHaveBeenCalled();

    // Completar debounce
    await act(async () => { vi.advanceTimersByTime(1100); });
    expect(props.onCopilotPushQueue).toHaveBeenCalledTimes(1);
  });

  it('si el fingerprint del driverBatch no cambia, no autoenvía aunque haya razón pendiente', async () => {
    const props = basicProps();
    const { rerender } = render(<TrimbleNavigationPanel {...(props as any)} />);

    fireEvent.click(screen.getByTestId('trimble-send-driver-btn'));
    await act(async () => { await Promise.resolve(); });
    (props.onCopilotPushQueue as any).mockClear();

    // Pulsar Optimizar todo (marca reason) pero NO cambiar la cola/orden
    fireEvent.click(screen.getByTestId('trimble-optimize-all-btn'));
    rerender(<TrimbleNavigationPanel {...(basicProps({ onCopilotPushQueue: props.onCopilotPushQueue }) as any)} />);
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(props.onCopilotPushQueue).not.toHaveBeenCalled();
  });

  it('si no hay copiloto activo, no autoenvía', async () => {
    const props = basicProps({ copilotActive: false, copilotSession: null });
    const { rerender } = render(<TrimbleNavigationPanel {...(props as any)} />);

    fireEvent.click(screen.getByTestId('trimble-optimize-all-btn'));
    const newSegs = [
      seg('s5', 40.5, -3), seg('s4', 40.4, -3), seg('s3', 40.3, -3),
      seg('s2', 40.2, -3), seg('s1', 40.1, -3), seg('s0', 40.0, -3),
    ];
    ctx.value.state = buildState(newSegs, [capOpen('s5')]);
    rerender(<TrimbleNavigationPanel {...(basicProps({
      copilotActive: false, copilotSession: null, onCopilotPushQueue: props.onCopilotPushQueue,
    }) as any)} />);
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(props.onCopilotPushQueue).not.toHaveBeenCalled();
  });
});
