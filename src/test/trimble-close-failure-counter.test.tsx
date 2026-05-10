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

describe('TrimbleNavigationPanel — counter no contaminado en cierre fallido', () => {
  beforeEach(() => {
    sessionStorage.clear();
    evt.logEvent.mockClear();
    ctx.value = trimbleCtx();
    const segs = Array.from({ length: 6 }, (_, i) => seg(`s${i}`, 40 + i * 0.01, -3));
    ctx.value.state = buildState(segs, [capOpen('s0')]);
    // closeTrimbleCapture FALLA siempre.
    ctx.value.closeTrimbleCapture = vi.fn(() => ({ ok: false, reason: 'forced-fail' }));
    vi.useFakeTimers();
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('si closeTrimbleCapture falla: no incrementa contador, no marca pendingAutoReason', async () => {
    const props = basicProps();
    const { rerender } = render(<TrimbleNavigationPanel {...(props as any)} />);

    // Envío manual inicial → deja lastSentFp poblado.
    fireEvent.click(screen.getByTestId('trimble-send-driver-btn'));
    await act(async () => { await Promise.resolve(); });
    expect(props.onCopilotPushQueue).toHaveBeenCalledTimes(1);
    (props.onCopilotPushQueue as any).mockClear();

    // Dos cierres "Cerrar" (capturado) que FALLAN.
    fireEvent.click(screen.getByText('Cerrar'));
    fireEvent.click(screen.getByText('Cerrar'));
    expect(ctx.value.closeTrimbleCapture).toHaveBeenCalledTimes(2);

    // Forzamos cambio de driverBatch (mutamos route) sin cambiar capturas:
    // así el fingerprint del lote cambia. Si el bug existiera,
    // pendingAutoReasonRef sería 'two_completed' y autoenviaría.
    const newSegs = [
      seg('s9', 40.9, -3),
      ...ctx.value.state.route.segments,
    ];
    ctx.value.state = buildState(newSegs, ctx.value.state.trimbleSegmentCaptures);
    const newIds = newSegs.map((s) => s.id);
    rerender(
      <TrimbleNavigationPanel
        {...(basicProps({
          onCopilotPushQueue: props.onCopilotPushQueue,
          // mantener mock de fallo
        }) as any)}
        trimbleEligibleSegmentIds={new Set(newIds)}
        orderIds={newIds}
      />,
    );
    await act(async () => { vi.advanceTimersByTime(1500); });

    // Hay reason 'order_changed' (cambió orderIds), pero NO 'two_completed'.
    // Como el lote sí cambió y hay una reason válida, autoenvía con order_changed.
    // El test clave: la reason NO es 'two_completed' (que solo se daría si el contador
    // hubiera contado los cierres fallidos).
    const autoCalls = evt.logEvent.mock.calls.filter(
      (c: any) => c[0] === 'TRIMBLE_COPILOT_QUEUE_AUTO_SENT',
    );
    for (const call of autoCalls) {
      expect((call as any)[1].payload.reason).not.toBe('two_completed');
    }
  });

  it('si closeTrimbleCapture falla con no_capturable: no marca pendingAutoReason="non_capturable"', async () => {
    const props = basicProps();
    const { rerender } = render(<TrimbleNavigationPanel {...(props as any)} />);

    fireEvent.click(screen.getByTestId('trimble-send-driver-btn'));
    await act(async () => { await Promise.resolve(); });
    (props.onCopilotPushQueue as any).mockClear();
    evt.logEvent.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /No cap\./ }));
    expect(ctx.value.closeTrimbleCapture).toHaveBeenCalledTimes(1);

    // Rerender SIN cambiar nada → fp no cambia, no envía.
    rerender(<TrimbleNavigationPanel {...(basicProps({
      onCopilotPushQueue: props.onCopilotPushQueue,
    }) as any)} />);
    await act(async () => { vi.advanceTimersByTime(1500); });

    expect(props.onCopilotPushQueue).not.toHaveBeenCalled();
    const autoCall = evt.logEvent.mock.calls.find(
      (c: any) => c[0] === 'TRIMBLE_COPILOT_QUEUE_AUTO_SENT'
        && (c[1] as any).payload.reason === 'non_capturable',
    );
    expect(autoCall).toBeUndefined();
  });
});
