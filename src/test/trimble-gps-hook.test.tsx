/**
 * Test del hook real `useTrimbleGpsLog`:
 *  - en TRIMBLE_LIDAR con misión y run abiertos, un punto válido se persiste
 *    en `trimbleGpsLogsByRun` vía la acción `appendTrimbleGpsPoint`.
 *  - si la acción rechaza el punto (p.ej. límite), la caché local
 *    `lastByRunRef` NO se actualiza, así que el siguiente intento sigue
 *    enviando puntos (no queda silenciado por una caché desincronizada).
 *  - en RST/Garmin, el hook no llama a la acción.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { AppState, LatLng } from '@/types/route';
import type { TrimbleGpsPoint } from '@/types/trimble';
import { createEmptyCampaignState } from '@/utils/storage';
import { RouteStateProvider } from '@/context/RouteStateContext';
import { useTrimbleGpsLog } from '@/hooks/useTrimbleGpsLog';
import type { ReactNode } from 'react';

type Append = (p: TrimbleGpsPoint) => { ok: boolean; reason?: string };

function makeCtx(state: Partial<AppState>, append: Append) {
  const base = createEmptyCampaignState();
  const value = {
    state: { ...base, ...state },
    appendTrimbleGpsPoint: append,
  } as unknown as Parameters<typeof RouteStateProvider>[0]['value'];
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RouteStateProvider value={value}>{children}</RouteStateProvider>
  );
  return wrapper;
}

const POS_A: LatLng = { lat: 40.0000, lng: -3.0000 };
const POS_B: LatLng = { lat: 40.0010, lng: -3.0010 }; // ~140 m de A

describe('useTrimbleGpsLog (hook real)', () => {
  it('TRIMBLE_LIDAR + misión + run → un punto válido se envía a appendTrimbleGpsPoint', () => {
    const append = vi.fn<Append>(() => ({ ok: true }));
    const wrapper = makeCtx({
      acquisitionMode: 'TRIMBLE_LIDAR',
      activeMissionId: 'm1',
      activeRunId: 'r1',
    }, append);

    const { rerender } = renderHook(
      ({ pos }: { pos: LatLng | null }) => useTrimbleGpsLog({ position: pos, accuracy: 5, speed: 0, heading: 0 }),
      { wrapper, initialProps: { pos: null as LatLng | null } },
    );

    act(() => { rerender({ pos: POS_A }); });
    expect(append).toHaveBeenCalledTimes(1);
    const sent = append.mock.calls[0][0];
    expect(sent.runId).toBe('r1');
    expect(sent.missionId).toBe('m1');
    expect(sent.phase).toBe('transport');
  });

  it('si appendTrimbleGpsPoint devuelve ok=false, la caché local NO se actualiza (siguiente punto vuelve a intentarse)', () => {
    const append = vi.fn<Append>(() => ({ ok: false, reason: 'Límite GPS Trimble del run alcanzado' }));
    const wrapper = makeCtx({
      acquisitionMode: 'TRIMBLE_LIDAR',
      activeMissionId: 'm1',
      activeRunId: 'r1',
    }, append);

    const { rerender } = renderHook(
      ({ pos }: { pos: LatLng | null }) => useTrimbleGpsLog({ position: pos, accuracy: 5, speed: 0, heading: 0 }),
      { wrapper, initialProps: { pos: null as LatLng | null } },
    );

    // Primer intento: append rechaza → caché NO debe actualizarse a POS_A
    act(() => { rerender({ pos: POS_A }); });
    expect(append).toHaveBeenCalledTimes(1);

    // Segundo intento con un punto MUY cercano a POS_A (< 10 m): si la caché
    // se hubiera contaminado con POS_A, el throttling lo bloquearía. Como no
    // se contaminó, debe seguir enviándolo (la caché está vacía).
    const NEAR_A: LatLng = { lat: 40.00001, lng: -3.00001 };
    act(() => { rerender({ pos: NEAR_A }); });
    expect(append).toHaveBeenCalledTimes(2);
  });

  it('cuando appendTrimbleGpsPoint acepta, el throttling de 10 m sí actúa', () => {
    const append = vi.fn<Append>(() => ({ ok: true }));
    const wrapper = makeCtx({
      acquisitionMode: 'TRIMBLE_LIDAR',
      activeMissionId: 'm1',
      activeRunId: 'r1',
    }, append);

    const { rerender } = renderHook(
      ({ pos }: { pos: LatLng | null }) => useTrimbleGpsLog({ position: pos, accuracy: 5, speed: 0, heading: 0 }),
      { wrapper, initialProps: { pos: null as LatLng | null } },
    );

    act(() => { rerender({ pos: POS_A }); });
    expect(append).toHaveBeenCalledTimes(1);

    // Punto a < 10 m: throttling bloquea
    const NEAR_A: LatLng = { lat: 40.00001, lng: -3.00001 };
    act(() => { rerender({ pos: NEAR_A }); });
    expect(append).toHaveBeenCalledTimes(1);

    // Punto a ~140 m: pasa el throttling
    act(() => { rerender({ pos: POS_B }); });
    expect(append).toHaveBeenCalledTimes(2);
  });

  it('RST/GARMIN → el hook no envía nada a appendTrimbleGpsPoint', () => {
    const append = vi.fn<Append>(() => ({ ok: true }));
    const wrapper = makeCtx({
      acquisitionMode: 'RST',
      activeMissionId: 'm1',
      activeRunId: 'r1',
    }, append);

    const { rerender } = renderHook(
      ({ pos }: { pos: LatLng | null }) => useTrimbleGpsLog({ position: pos, accuracy: 5, speed: 0, heading: 0 }),
      { wrapper, initialProps: { pos: null as LatLng | null } },
    );
    act(() => { rerender({ pos: POS_A }); });
    expect(append).not.toHaveBeenCalled();
  });
});
