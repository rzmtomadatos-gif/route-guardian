/**
 * Plan §15: en TRIMBLE_LIDAR no debe ejecutarse auto-envío de lote por las
 * reasons two_completed / auto_captured / order_changed / layer_changed /
 * optimized. Sólo el envío manual (botón) o el envío individual del overlay
 * son válidos.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { TrimbleNavigationPanel } from '@/components/map-control/TrimbleNavigationPanel';
import { seg, capClosed, buildState, makeCopilotSession, trimbleCtx } from './helpers/trimble-panel-harness';

const ctx = vi.hoisted(() => ({ value: null as any }));
vi.mock('@/context/RouteStateContext', () => ({ useRouteStateContext: () => ctx.value }));
const evt = vi.hoisted(() => ({ logEvent: vi.fn(async () => ({})) }));
vi.mock('@/utils/persistence/event-log', () => ({ logEvent: evt.logEvent }));

function props(extra: any = {}) {
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

describe('Trimble §15 — autoenvío de lote desactivado', () => {
  beforeEach(() => {
    sessionStorage.clear();
    evt.logEvent.mockClear();
    ctx.value = trimbleCtx();
    const segs = Array.from({ length: 6 }, (_, i) => seg(`s${i}`, 40 + i * 0.01, -3));
    ctx.value.state = buildState(segs, [capClosed('s0'), capClosed('s1')]);
  });
  afterEach(() => { cleanup(); });

  it('cambio de orden NO dispara auto-envío en Trimble', async () => {
    const p = props();
    const { rerender } = render(<TrimbleNavigationPanel {...(p as any)} />);
    await act(async () => {
      const newOrder = [...p.orderIds].reverse();
      rerender(<TrimbleNavigationPanel {...(p as any)} orderIds={newOrder} />);
      await new Promise((r) => setTimeout(r, 1200));
    });
    expect(p.onCopilotPushQueue).not.toHaveBeenCalled();
  });

  it('cambio de capas elegibles NO dispara auto-envío en Trimble', async () => {
    const p = props();
    const { rerender } = render(<TrimbleNavigationPanel {...(p as any)} />);
    await act(async () => {
      const reduced = new Set<string>(p.orderIds.slice(0, 3));
      rerender(<TrimbleNavigationPanel {...(p as any)} trimbleEligibleSegmentIds={reduced} />);
      await new Promise((r) => setTimeout(r, 1200));
    });
    expect(p.onCopilotPushQueue).not.toHaveBeenCalled();
  });
});
