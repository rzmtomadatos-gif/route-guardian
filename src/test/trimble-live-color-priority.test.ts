/**
 * Verifica la prioridad de color del render de tramos:
 *   live > trimbleStatus > color base
 * y que al invalidar la grabación la capa live desaparece (no hay capturas).
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRouteState } from '@/hooks/useRouteState';
import { resolveSegmentDisplayColor } from '@/utils/segment-colors';
import {
  TRIMBLE_LIVE_STATUS_COLOR,
  buildTrimbleLiveCoverage,
} from '@/utils/trimble/live-coverage';
import { TRIMBLE_STATUS_COLOR } from '@/utils/segment-colors';
import type { Route, Segment } from '@/types/route';
import type { TrimbleGpsPoint } from '@/types/trimble';

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

describe('resolveSegmentDisplayColor — prioridad visual', () => {
  const s = seg('A');

  it('live override gana sobre trimbleStatus y color base', () => {
    const color = resolveSegmentDisplayColor({
      seg: s,
      trimbleStatus: 'capturado_pendiente_proceso',
      liveItem: { segmentId: 'A', status: 'live_covered',
        coverageRatio: 1, matchedPoints: 5, startProgress: 0, endProgress: 1 },
    });
    expect(color).toBe(TRIMBLE_LIVE_STATUS_COLOR.live_covered);
  });

  it('sin live, trimbleStatus gana sobre color base', () => {
    const color = resolveSegmentDisplayColor({
      seg: s, trimbleStatus: 'capturado_pendiente_proceso', liveItem: null,
    });
    expect(color).toBe(TRIMBLE_STATUS_COLOR.capturado_pendiente_proceso);
  });

  it('sin live ni trimbleStatus, devuelve color base operativo', () => {
    const color = resolveSegmentDisplayColor({ seg: s });
    // pendiente sin layer => gris por defecto del resolver base
    expect(color).toBe('#6b7280');
  });
});

describe('invalidación de grabación → desaparece live, no se generan capturas', () => {
  it('tras invalidar, live coverage no aplica y no hay SegmentCapture', async () => {
    const { result } = renderHook(() => useRouteState());
    await act(async () => { await result.current.setRoute(route()); });
    act(() => { result.current.setAcquisitionMode('TRIMBLE_LIDAR'); });
    act(() => { result.current.startTrimbleMission({}); });
    act(() => { result.current.startTrimbleRun({}); });
    act(() => { result.current.startTrimbleRecording({}); });

    const recId = result.current.state.activeTrimbleRecordingId!;
    expect(recId).toBeTruthy();

    // Simulamos puntos GPS de la sesión activa: live coverage debe colorear A.
    const segs = result.current.state.route.segments;
    const points: TrimbleGpsPoint[] = Array.from({ length: 12 }, (_, i) => ({
      timestamp: new Date(Date.UTC(2026, 0, 1, 10, 0, i * 5)).toISOString(),
      lat: 40 + (i / 11) * 0.001, lng: -3.7,
      missionId: 'm', runId: 'r', phase: 'capture',
      source: 'gps', recordingSessionId: recId,
    }));

    const liveActive = buildTrimbleLiveCoverage(points, segs);
    expect(liveActive.get('A')?.status === 'live_covered'
        || liveActive.get('A')?.status === 'live_partial').toBe(true);

    // Invalidamos.
    act(() => { result.current.invalidateTrimbleRecording('fallo sensor'); });

    // 1) No se creó ninguna captura.
    expect(result.current.state.trimbleSegmentCaptures).toHaveLength(0);
    // 2) activeTrimbleRecordingId es null → MapPage devuelve null y no hay live.
    expect(result.current.state.activeTrimbleRecordingId).toBeNull();
    // 3) La sesión queda marcada invalidated (auditable).
    const session = result.current.state.trimbleRecordingSessions.find((x) => x.id === recId)!;
    expect(session.status).toBe('invalidated');

    // 4) En el render, sin liveItem, el tramo vuelve a su color base/persistente.
    const colorAfter = resolveSegmentDisplayColor({
      seg: segs[0], liveItem: null, trimbleStatus: null,
    });
    expect(colorAfter).not.toBe(TRIMBLE_LIVE_STATUS_COLOR.live_covered);
    expect(colorAfter).not.toBe(TRIMBLE_LIVE_STATUS_COLOR.live_partial);
  });
});
