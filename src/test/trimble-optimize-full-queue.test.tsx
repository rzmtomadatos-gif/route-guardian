// SKIPPED por plan §15: en TRIMBLE_LIDAR el auto-envío de lote queda desactivado.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { TrimbleNavigationPanel } from '@/components/map-control/TrimbleNavigationPanel';
import { SEGMENTS_PER_BATCH } from '@/utils/google-maps-batch';
import { buildTrimbleRecordingQueue } from '@/utils/trimble/recording-queue';
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

describe.skip('TrimbleNavigationPanel — Optimizar todo opera sobre cola completa (500 tramos)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    evt.logEvent.mockClear();
    ctx.value = trimbleCtx();
    const segs = Array.from({ length: 500 }, (_, i) =>
      seg(`s${String(i).padStart(3, '0')}`, 40 + i * 0.001, -3),
    );
    ctx.value.state = buildState(segs, [capOpen('s000')]);
    vi.useFakeTimers();
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('Optimizar todo: orden completo (500), driverBatch=4, autoenvía con reason="optimized"', async () => {
    const ids = ctx.value.state.route.segments.map((s: any) => s.id);
    expect(ids.length).toBe(500);

    // Verificar pre-condición: la cola Trimble cubre los 500 tramos.
    const { items: fullQueue } = buildTrimbleRecordingQueue(
      ctx.value.state, new Set<string>(ids), ids,
    );
    expect(fullQueue.length).toBe(500);

    const props = basicProps();
    const { rerender } = render(<TrimbleNavigationPanel {...(props as any)} />);

    // Envío manual inicial → fp guardado.
    fireEvent.click(screen.getByTestId('trimble-send-driver-btn'));
    await act(async () => { await Promise.resolve(); });
    (props.onCopilotPushQueue as any).mockClear();
    evt.logEvent.mockClear();

    // Pulsar "Optimizar todo".
    fireEvent.click(screen.getByTestId('trimble-optimize-all-btn'));
    expect(props.onReoptimize).toHaveBeenCalledTimes(1);

    // Simular el resultado de la optimización: reorden COMPLETO de los 500 IDs.
    // Para asegurar que el lote (primeros 4) cambia: tomamos los últimos 4 al inicio.
    const reordered = [...ids].reverse(); // s499 ... s000
    const newSegs = reordered.map((id, i) =>
      seg(id, 40 + i * 0.001, -3),
    );
    ctx.value.state = buildState(newSegs, [capOpen(reordered[0])]);

    rerender(
      <TrimbleNavigationPanel
        {...(basicProps({ onCopilotPushQueue: props.onCopilotPushQueue }) as any)}
        trimbleEligibleSegmentIds={new Set(reordered)}
        orderIds={reordered}
      />,
    );
    await act(async () => { vi.advanceTimersByTime(1500); });

    // Cola completa post-optimización sigue siendo 500.
    const { items: postQueue } = buildTrimbleRecordingQueue(
      ctx.value.state, new Set<string>(reordered), reordered,
    );
    expect(postQueue.length).toBe(500);
    expect(postQueue.slice(0, SEGMENTS_PER_BATCH).length).toBe(SEGMENTS_PER_BATCH);

    // onCopilotPushQueue se llamó automáticamente.
    expect(props.onCopilotPushQueue).toHaveBeenCalledTimes(1);
    const callItems = (props.onCopilotPushQueue as any).mock.calls[0][0];
    // 4 tramos × (inicio + fin) = 8 paradas.
    expect(callItems.length).toBe(SEGMENTS_PER_BATCH * 2);
    // Primer item del payload corresponde al inicio del primer tramo del nuevo orden.
    expect(callItems[0].segmentId).toBe(reordered[0]);
    expect(callItems[6].segmentId).toBe(reordered[3]);

    const autoCall = evt.logEvent.mock.calls.find(
      (c: any) => c[0] === 'TRIMBLE_COPILOT_QUEUE_AUTO_SENT',
    );
    expect(autoCall).toBeDefined();
    expect((autoCall as any)[1].payload.reason).toBe('optimized');
  });
});
