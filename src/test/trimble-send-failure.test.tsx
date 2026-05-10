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

function basicProps(extra: any = {}) {
  const ids = ctx.value.state.route.segments.map((s: any) => s.id);
  return {
    trimbleEligibleSegmentIds: new Set<string>(ids),
    orderIds: ids,
    copilotSession: makeCopilotSession(),
    copilotActive: true,
    onCopilotStart: vi.fn(async () => null),
    onCopilotEnd: vi.fn(async () => {}),
    onCopilotPushQueue: vi.fn(async () => { throw new Error('network down'); }),
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

describe('TrimbleNavigationPanel — fallo de envío al conductor', () => {
  beforeEach(() => {
    sessionStorage.clear();
    evt.logEvent.mockClear();
    ctx.value = trimbleCtx();
    const segs = Array.from({ length: 6 }, (_, i) => seg(`s${i}`, 40 + i * 0.01, -3));
    ctx.value.state = buildState(segs, [capOpen('s0')]);
  });
  afterEach(() => { cleanup(); });

  it('si onCopilotPushQueue falla: registra TRIMBLE_COPILOT_QUEUE_SEND_FAILED, no actualiza fingerprint y permite reintento manual', async () => {
    const props = basicProps();
    render(<TrimbleNavigationPanel {...(props as any)} />);

    const sendBtn = screen.getByTestId('trimble-send-driver-btn');
    expect(sendBtn).not.toBeDisabled();
    // Estado inicial: "Ruta desactualizada" (lastSentFp=null) → texto "Actualizar conductor"
    expect(sendBtn.textContent).toMatch(/Enviar al conductor|Actualizar conductor/);

    await act(async () => {
      fireEvent.click(sendBtn);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(props.onCopilotPushQueue).toHaveBeenCalledTimes(1);
    const failCall = evt.logEvent.mock.calls.find(
      (c: any) => c[0] === 'TRIMBLE_COPILOT_QUEUE_SEND_FAILED',
    );
    expect(failCall).toBeDefined();
    expect((failCall as any)[1].payload.error).toContain('network down');

    // No se persiste el fingerprint → la ruta sigue desactualizada
    // (no debe aparecer "Conductor actualizado")
    expect(screen.queryAllByText('Conductor actualizado').length).toBe(0);

    // El botón manual sigue habilitado para reintento
    const sendBtn2 = screen.getByTestId('trimble-send-driver-btn');
    expect(sendBtn2).not.toBeDisabled();
  });
});
