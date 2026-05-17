/**
 * BUG-042 + BUG-043 — acciones manuales del overlay Trimble.
 *
 * BUG-042 (mensaje específico): el helper interno _diagnoseTrimbleContext
 *   distingue modo, misión y pasada. La aserción funcional crítica es que
 *   la acción RECHACE si falta cualquiera de las tres, sin crear capturas
 *   espurias (verificable vía estado, evitando la flakiness conocida del
 *   closure outcome bajo React StrictMode en renderHook).
 *
 * BUG-043 (no_capturable dedicado): markTrimbleSegmentNoCapturable crea una
 *   SegmentCapture con fieldStatus='no_capturable' y captureSource=
 *   'operator_override'. NUNCA debe quedar persistida como
 *   'capturado_pendiente_proceso' (falsa captura).
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRouteState } from '@/hooks/useRouteState';
import type { Route, Segment } from '@/types/route';

function seg(id: string): Segment {
  return {
    id, routeId: 'r', trackNumber: null, plannedTrackNumber: null, trackHistory: [],
    kmlId: id, name: id, notes: '',
    coordinates: [{ lat: 40, lng: -3.7 }, { lat: 40.001, lng: -3.7 }],
    direction: 'creciente', type: 'tramo', status: 'pendiente', kmlMeta: {},
  } as Segment;
}
function route(): Route {
  return { id: 'r', name: 'r', loadedAt: '', fileName: '',
    segments: [seg('A')], optimizedOrder: ['A'] } as Route;
}

describe('BUG-042 — la acción no crea capturas si falta contexto Trimble', () => {
  it('modo no Trimble → no se crea captura', async () => {
    const { result } = renderHook(() => useRouteState());
    await act(async () => { await result.current.setRoute(route()); });
    act(() => { result.current.markTrimbleSegmentManuallyCaptured('A'); });
    expect(result.current.state.trimbleSegmentCaptures ?? []).toHaveLength(0);
  });

  it('Trimble sin misión → no se crea captura', async () => {
    const { result } = renderHook(() => useRouteState());
    await act(async () => { await result.current.setRoute(route()); });
    act(() => { result.current.setAcquisitionMode('TRIMBLE_LIDAR'); });
    act(() => { result.current.markTrimbleSegmentManuallyCaptured('A'); });
    expect(result.current.state.trimbleSegmentCaptures ?? []).toHaveLength(0);
  });

  it('misión sin pasada → no se crea captura', async () => {
    const { result } = renderHook(() => useRouteState());
    await act(async () => { await result.current.setRoute(route()); });
    act(() => { result.current.setAcquisitionMode('TRIMBLE_LIDAR'); });
    act(() => { result.current.startTrimbleMission({}); });
    act(() => { result.current.markTrimbleSegmentManuallyCaptured('A'); });
    expect(result.current.state.trimbleSegmentCaptures ?? []).toHaveLength(0);
  });

  it('contexto completo → captura persistida con fieldStatus capturado_pendiente_proceso', async () => {
    const { result } = renderHook(() => useRouteState());
    await act(async () => { await result.current.setRoute(route()); });
    act(() => { result.current.setAcquisitionMode('TRIMBLE_LIDAR'); });
    act(() => { result.current.startTrimbleMission({}); });
    act(() => { result.current.startTrimbleRun({}); });
    act(() => { result.current.markTrimbleSegmentManuallyCaptured('A'); });
    const caps = result.current.state.trimbleSegmentCaptures.filter((c) => c.segmentId === 'A');
    expect(caps).toHaveLength(1);
    expect(caps[0].fieldStatus).toBe('capturado_pendiente_proceso');
    expect(caps[0].captureSource).toBe('operator_override');
  });
});

describe('BUG-043 — markTrimbleSegmentNoCapturable NO crea falsas capturas', () => {
  it('crea exactamente una SegmentCapture con fieldStatus="no_capturable"', async () => {
    const { result } = renderHook(() => useRouteState());
    await act(async () => { await result.current.setRoute(route()); });
    act(() => { result.current.setAcquisitionMode('TRIMBLE_LIDAR'); });
    act(() => { result.current.startTrimbleMission({}); });
    act(() => { result.current.startTrimbleRun({}); });
    act(() => { result.current.markTrimbleSegmentNoCapturable('A'); });

    const caps = result.current.state.trimbleSegmentCaptures.filter((c) => c.segmentId === 'A');
    expect(caps).toHaveLength(1);
    expect(caps[0].fieldStatus).toBe('no_capturable');
    expect(caps[0].captureSource).toBe('operator_override');
    // Aserción negativa explícita: NO se persistió como capturado_pendiente_proceso.
    expect(caps.some((c) => c.fieldStatus === 'capturado_pendiente_proceso')).toBe(false);
  });

  it('sin misión activa → no se crea captura', async () => {
    const { result } = renderHook(() => useRouteState());
    await act(async () => { await result.current.setRoute(route()); });
    act(() => { result.current.setAcquisitionMode('TRIMBLE_LIDAR'); });
    act(() => { result.current.markTrimbleSegmentNoCapturable('A'); });
    expect(result.current.state.trimbleSegmentCaptures ?? []).toHaveLength(0);
  });

  it('sin pasada activa → no se crea captura', async () => {
    const { result } = renderHook(() => useRouteState());
    await act(async () => { await result.current.setRoute(route()); });
    act(() => { result.current.setAcquisitionMode('TRIMBLE_LIDAR'); });
    act(() => { result.current.startTrimbleMission({}); });
    act(() => { result.current.markTrimbleSegmentNoCapturable('A'); });
    expect(result.current.state.trimbleSegmentCaptures ?? []).toHaveLength(0);
  });
});
