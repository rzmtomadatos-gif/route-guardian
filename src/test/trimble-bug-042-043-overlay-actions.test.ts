/**
 * BUG-042 + BUG-043 — acciones manuales del overlay Trimble.
 *
 * BUG-042: el mensaje de error debe diagnosticar exactamente qué falta
 *  (modo Trimble inactivo / sin misión / sin pasada). No debe mostrar
 *  "Necesitas misión y pasada activas" cuando misión y pasada SÍ están
 *  activas — eso ocultaba el verdadero motivo del fallo.
 *
 * BUG-043: la acción "No grabable" debe crear una SegmentCapture con
 *  fieldStatus='no_capturable' y captureSource='operator_override'. NUNCA
 *  debe reutilizar markTrimbleSegmentManuallyCaptured (que crearía una
 *  falsa captura 'capturado_pendiente_proceso' contaminando el estado).
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

describe('BUG-042 — diagnóstico específico de contexto Trimble', () => {
  it('modo no Trimble → reason="Modo Trimble inactivo"', async () => {
    const { result } = renderHook(() => useRouteState());
    await act(async () => { await result.current.setRoute(route()); });
    // No activamos modo Trimble.
    const r = result.current.markTrimbleSegmentManuallyCaptured('A');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('Modo Trimble inactivo');
  });

  it('Trimble sin misión → reason="No hay misión Trimble abierta"', async () => {
    const { result } = renderHook(() => useRouteState());
    await act(async () => { await result.current.setRoute(route()); });
    act(() => { result.current.setAcquisitionMode('TRIMBLE_LIDAR'); });
    const r = result.current.markTrimbleSegmentManuallyCaptured('A');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('No hay misión Trimble abierta');
  });

  it('Trimble con misión sin pasada → reason="No hay pasada (run) abierta"', async () => {
    const { result } = renderHook(() => useRouteState());
    await act(async () => { await result.current.setRoute(route()); });
    act(() => { result.current.setAcquisitionMode('TRIMBLE_LIDAR'); });
    act(() => { result.current.startTrimbleMission({}); });
    const r = result.current.markTrimbleSegmentManuallyCaptured('A');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('No hay pasada (run) abierta');
  });

  it('misión y pasada abiertas → markTrimbleSegmentManuallyCaptured ok', async () => {
    const { result } = renderHook(() => useRouteState());
    await act(async () => { await result.current.setRoute(route()); });
    act(() => { result.current.setAcquisitionMode('TRIMBLE_LIDAR'); });
    act(() => { result.current.startTrimbleMission({}); });
    act(() => { result.current.startTrimbleRun({}); });
    let r: ReturnType<typeof result.current.markTrimbleSegmentManuallyCaptured> = { ok: false };
    act(() => { r = result.current.markTrimbleSegmentManuallyCaptured('A'); });
    expect(r.ok).toBe(true);
    expect(r.reason).toBeUndefined();
    const cap = result.current.state.trimbleSegmentCaptures.find((c) => c.segmentId === 'A');
    expect(cap?.fieldStatus).toBe('capturado_pendiente_proceso');
  });
});

describe('BUG-043 — markTrimbleSegmentNoCapturable crea captura no_capturable', () => {
  it('crea SegmentCapture con fieldStatus="no_capturable", no "capturado_pendiente_proceso"', async () => {
    const { result } = renderHook(() => useRouteState());
    await act(async () => { await result.current.setRoute(route()); });
    act(() => { result.current.setAcquisitionMode('TRIMBLE_LIDAR'); });
    act(() => { result.current.startTrimbleMission({}); });
    act(() => { result.current.startTrimbleRun({}); });

    let r: { ok: boolean; reason?: string; captureId?: string } = { ok: false };
    act(() => { r = result.current.markTrimbleSegmentNoCapturable('A'); });
    expect(r.ok).toBe(true);

    const caps = result.current.state.trimbleSegmentCaptures.filter((c) => c.segmentId === 'A');
    expect(caps).toHaveLength(1);
    expect(caps[0].fieldStatus).toBe('no_capturable');
    expect(caps[0].captureSource).toBe('operator_override');
    // Asegura que NO se creó accidentalmente una captura capturado_pendiente_proceso.
    expect(caps.some((c) => c.fieldStatus === 'capturado_pendiente_proceso')).toBe(false);
  });

  it('rechaza con diagnóstico cuando no hay misión/pasada', async () => {
    const { result } = renderHook(() => useRouteState());
    await act(async () => { await result.current.setRoute(route()); });
    act(() => { result.current.setAcquisitionMode('TRIMBLE_LIDAR'); });
    const r = result.current.markTrimbleSegmentNoCapturable('A');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('No hay misión Trimble abierta');
  });
});
