/**
 * Test invalidación de grabación Trimble: NO genera capturas, limpia el id
 * activo y emite TRIMBLE_RECORDING_INVALIDATED.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRouteState } from '@/hooks/useRouteState';
import type { Route, Segment } from '@/types/route';

function seg(id: string): Segment {
  return {
    id, routeId: 'r', trackNumber: null, plannedTrackNumber: null, trackHistory: [],
    kmlId: id, name: id, notes: '',
    coordinates: [{ lat: 40, lng: -3.7 }, { lat: 40.005, lng: -3.7 }],
    direction: 'creciente', type: 'tramo', status: 'pendiente', kmlMeta: {},
  } as Segment;
}
function route(): Route {
  return { id: 'r', name: 'r', loadedAt: '', fileName: '',
    segments: [seg('A')], optimizedOrder: ['A'] } as Route;
}

describe('invalidateTrimbleRecording', () => {
  it('limpia activeTrimbleRecordingId, marca status invalidated, no crea capturas', async () => {
    const { result } = renderHook(() => useRouteState());
    await act(async () => { await result.current.setRoute(route()); });
    act(() => { result.current.setAcquisitionMode('TRIMBLE_LIDAR'); });
    act(() => { result.current.startTrimbleMission({}); });
    act(() => { result.current.startTrimbleRun({}); });
    act(() => { result.current.startTrimbleRecording({}); });
    const recId = result.current.state.activeTrimbleRecordingId!;
    expect(recId).toBeTruthy();

    act(() => { result.current.invalidateTrimbleRecording('fallo sensor'); });

    expect(result.current.state.activeTrimbleRecordingId).toBeNull();
    const session = result.current.state.trimbleRecordingSessions.find((s) => s.id === recId)!;
    expect(session.status).toBe('invalidated');
    expect(session.invalidatedReason).toBe('fallo sensor');
    expect(result.current.state.trimbleSegmentCaptures).toHaveLength(0);
  });

  it('falla si no hay grabación activa', async () => {
    const { result } = renderHook(() => useRouteState());
    await act(async () => { await result.current.setRoute(route()); });
    let r: any;
    act(() => { r = result.current.invalidateTrimbleRecording('x'); });
    expect(r.ok).toBe(false);
  });
});
