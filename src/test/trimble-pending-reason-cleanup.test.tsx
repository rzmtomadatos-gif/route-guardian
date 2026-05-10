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

describe('TrimbleNavigationPanel — limpieza de pendingAutoReason obsoleto', () => {
  beforeEach(() => {
    sessionStorage.clear();
    evt.logEvent.mockClear();
    ctx.value = trimbleCtx();
    const segs = Array.from({ length: 6 }, (_, i) => seg(`s${i}`, 40 + i * 0.01, -3));
    ctx.value.state = buildState(segs, [capOpen('s0')]);
    vi.useFakeTimers();
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('Optimizar todo sin cambiar driverBatch no envía; un cambio posterior usa reason correcto (no "optimized")', async () => {
    const props = basicProps();
    const { rerender } = render(<TrimbleNavigationPanel {...(props as any)} />);

    // 1) Envío manual inicial → fp guardado.
    fireEvent.click(screen.getByTestId('trimble-send-driver-btn'));
    await act(async () => { await Promise.resolve(); });
    (props.onCopilotPushQueue as any).mockClear();
    evt.logEvent.mockClear();

    // 2) Pulsar Optimizar todo, pero el resultado no altera los 4 primeros.
    fireEvent.click(screen.getByTestId('trimble-optimize-all-btn'));
    // Simulamos una "reoptimización" que NO cambia el orden ni capas.
    rerender(<TrimbleNavigationPanel {...(props as any)} />);
    await act(async () => { vi.advanceTimersByTime(1500); });

    // 3) No debe haber enviado nada (lote idéntico).
    expect(props.onCopilotPushQueue).not.toHaveBeenCalled();
    expect(
      evt.logEvent.mock.calls.find((c: any) => c[0] === 'TRIMBLE_COPILOT_QUEUE_AUTO_SENT'),
    ).toBeUndefined();

    // 4) Ahora un cambio real de orden (reordenamos los segmentos).
    const newSegs = [
      seg('s2', 40.5, -3), seg('s1', 40.4, -3), seg('s0', 40.3, -3),
      seg('s3', 40.6, -3), seg('s4', 40.7, -3), seg('s5', 40.8, -3),
    ];
    ctx.value.state = buildState(newSegs, [capOpen('s2')]);
    const newIds = newSegs.map((s) => s.id);
    rerender(
      <TrimbleNavigationPanel
        {...(basicProps({ onCopilotPushQueue: props.onCopilotPushQueue }) as any)}
        trimbleEligibleSegmentIds={new Set(newIds)}
        orderIds={newIds}
      />,
    );
    await act(async () => { vi.advanceTimersByTime(1500); });

    // 5) El envío automático debe usar reason='order_changed', NO 'optimized'.
    expect(props.onCopilotPushQueue).toHaveBeenCalledTimes(1);
    const autoCall = evt.logEvent.mock.calls.find(
      (c: any) => c[0] === 'TRIMBLE_COPILOT_QUEUE_AUTO_SENT',
    );
    expect(autoCall).toBeDefined();
    expect((autoCall as any)[1].payload.reason).toBe('order_changed');
    expect((autoCall as any)[1].payload.reason).not.toBe('optimized');
  });

  it('si copiloto está inactivo, las razones pendientes se descartan y no se envían al activarlo', async () => {
    const props = basicProps({ copilotActive: false, copilotSession: null });
    const { rerender } = render(<TrimbleNavigationPanel {...(props as any)} />);

    // Marca pendingAutoReason='optimized' mientras está inactivo.
    fireEvent.click(screen.getByTestId('trimble-optimize-all-btn'));
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(props.onCopilotPushQueue).not.toHaveBeenCalled();

    // Activar copiloto sin cambios reales en el lote.
    rerender(
      <TrimbleNavigationPanel
        {...(basicProps() as any)}
        onCopilotPushQueue={props.onCopilotPushQueue}
      />,
    );
    await act(async () => { vi.advanceTimersByTime(1500); });

    // No debe enviar automáticamente con un motivo viejo.
    expect(props.onCopilotPushQueue).not.toHaveBeenCalled();
  });
});
