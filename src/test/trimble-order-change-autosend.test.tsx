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

describe('TrimbleNavigationPanel — autoenvío por cambio de orden', () => {
  beforeEach(() => {
    sessionStorage.clear();
    evt.logEvent.mockClear();
    ctx.value = trimbleCtx();
    const segs = Array.from({ length: 6 }, (_, i) => seg(`s${i}`, 40 + i * 0.01, -3));
    ctx.value.state = buildState(segs, [capOpen('s0')]);
    vi.useFakeTimers();
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('cambio de orden con lote distinto → autoenvía con reason="order_changed"', async () => {
    const props = basicProps();
    const { rerender } = render(<TrimbleNavigationPanel {...(props as any)} />);

    // Envío manual inicial → fp guardado.
    fireEvent.click(screen.getByTestId('trimble-send-driver-btn'));
    await act(async () => { await Promise.resolve(); });
    (props.onCopilotPushQueue as any).mockClear();
    evt.logEvent.mockClear();

    // Cambiamos el orden REAL: route.segments reordenados.
    const newSegs = [
      seg('s5', 40.5, -3), seg('s4', 40.4, -3), seg('s3', 40.3, -3),
      seg('s2', 40.2, -3), seg('s1', 40.1, -3), seg('s0', 40.0, -3),
    ];
    ctx.value.state = buildState(newSegs, [capOpen('s5')]);
    const newIds = newSegs.map((s) => s.id);
    rerender(
      <TrimbleNavigationPanel
        {...(basicProps({ onCopilotPushQueue: props.onCopilotPushQueue }) as any)}
        trimbleEligibleSegmentIds={new Set(newIds)}
        orderIds={newIds}
      />,
    );
    await act(async () => { vi.advanceTimersByTime(1500); });

    expect(props.onCopilotPushQueue).toHaveBeenCalledTimes(1);
    const autoCall = evt.logEvent.mock.calls.find(
      (c: any) => c[0] === 'TRIMBLE_COPILOT_QUEUE_AUTO_SENT',
    );
    expect(autoCall).toBeDefined();
    expect((autoCall as any)[1].payload.reason).toBe('order_changed');
  });

  it('cambio de orden pero mismo driverBatch (cola de exactamente 4) → NO autoenvía', async () => {
    // 4 segmentos: el lote (4) es la cola completa. Reordenar fuera de los 4
    // primeros no es posible aquí, así que probamos: si reordenamos los segmentos
    // de tal modo que orderIds cambie pero el conjunto de los primeros 4 IDs sea
    // idéntico (no hay reorder posible con 4) → usamos 5 segmentos y reordenamos
    // solo los dos últimos: el lote (primeros 4) queda igual.
    const segs = Array.from({ length: 5 }, (_, i) => seg(`s${i}`, 40 + i * 0.01, -3));
    ctx.value.state = buildState(segs, [capOpen('s0')]);

    const props = basicProps();
    const { rerender } = render(<TrimbleNavigationPanel {...(props as any)} />);

    fireEvent.click(screen.getByTestId('trimble-send-driver-btn'));
    await act(async () => { await Promise.resolve(); });
    (props.onCopilotPushQueue as any).mockClear();
    evt.logEvent.mockClear();

    // Reordenar SOLO la posición 5 con la 4 → ambas fuera del lote (primeros 4).
    // Pero como SEGMENTS_PER_BATCH=4, los IDs s0..s3 siguen siendo los primeros 4.
    // Manipulamos orderIds directamente conservando los 4 primeros.
    const ids = ['s0', 's1', 's2', 's3', 's4'];
    const reorderedIds = ['s0', 's1', 's2', 's3', 's4']; // sin cambio efectivo en lote
    // Para forzar cambio en orderFingerprint sin tocar lote: añadir un id "fantasma"
    // al final del orderIds NO funcionaría porque getTrimbleOrderIds en MapPage
    // ya filtra. Aquí el componente recibe orderIds como prop directa.
    const orderWithExtra = [...ids, 'sX']; // distinto fingerprint, mismo lote efectivo
    void reorderedIds;

    ctx.value.state = buildState(segs, [capOpen('s0')]);
    rerender(
      <TrimbleNavigationPanel
        {...(basicProps({ onCopilotPushQueue: props.onCopilotPushQueue }) as any)}
        orderIds={orderWithExtra}
      />,
    );
    await act(async () => { vi.advanceTimersByTime(1500); });

    expect(props.onCopilotPushQueue).not.toHaveBeenCalled();
  });
});
