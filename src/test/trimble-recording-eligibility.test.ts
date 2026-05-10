/**
 * closeTrimbleRecording NO debe auto-capturar tramos:
 *  - con captura terminal (capturado_pendiente_proceso, no_capturable, qa final)
 *  - marcados nonRecordable
 *  - con incidencia trimble bloqueante
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRouteState } from '@/hooks/useRouteState';
import type { Route, Segment, LatLng } from '@/types/route';

function buildSeg(id: string, coords: LatLng[], extra: Partial<Segment> = {}): Segment {
  return {
    id, routeId: 'r', trackNumber: null, plannedTrackNumber: null, trackHistory: [],
    kmlId: id, name: id, notes: '', coordinates: coords,
    direction: 'creciente', type: 'tramo', status: 'pendiente', kmlMeta: {},
    ...extra,
  };
}

function makeRoute(): Route {
  return {
    id: 'r', name: 'r', loadedAt: '', fileName: '',
    segments: [
      // Tramo terminal (ya capturado) — debe excluirse
      buildSeg('seg-terminal', [{ lat: 40.0000, lng: -3.7000 }, { lat: 40.0050, lng: -3.7000 }]),
      // Tramo no grabable — debe excluirse
      buildSeg('seg-nonrec', [{ lat: 40.0100, lng: -3.7000 }, { lat: 40.0150, lng: -3.7000 }], { nonRecordable: true }),
      // Tramo con incidencia bloqueante — debe excluirse
      buildSeg('seg-blocked', [{ lat: 40.0200, lng: -3.7000 }, { lat: 40.0250, lng: -3.7000 }]),
      // Tramo válido pendiente — debe entrar
      buildSeg('seg-pendiente', [{ lat: 40.0300, lng: -3.7000 }, { lat: 40.0350, lng: -3.7000 }]),
    ],
    optimizedOrder: ['seg-terminal', 'seg-nonrec', 'seg-blocked', 'seg-pendiente'],
  };
}

function injectCoverPoints(append: any, segIdx: number, missionId: string, runId: string, recId: string) {
  const baseLat = 40.0000 + segIdx * 0.0100;
  const baseTime = Date.now();
  const N = 60;
  for (let i = 0; i <= N; i++) {
    append({
      timestamp: new Date(baseTime + segIdx * 100000 + i * 1000).toISOString(),
      lat: baseLat + (0.005 * i) / N,
      lng: -3.7000,
      accuracy: 5, speed: 10,
      missionId, runId,
      phase: 'capture' as const,
      source: 'gps' as const,
      recordingSessionId: recId,
    });
  }
}

describe('closeTrimbleRecording — filtra terminales / no_capturable / incidencias', () => {
  it('solo auto-captura tramos pendientes; ignora terminal, nonRecordable y bloqueados', async () => {
    const { result } = renderHook(() => useRouteState());
    await act(async () => { await result.current.setRoute(makeRoute()); });
    act(() => { result.current.setAcquisitionMode('TRIMBLE_LIDAR'); });
    act(() => { result.current.startTrimbleMission({}); });
    act(() => { result.current.startTrimbleRun({}); });

    // Marcamos seg-terminal como capturado mediante captura manual previa.
    act(() => {
      result.current.startTrimbleCapture({ segmentId: 'seg-terminal' });
    });
    act(() => {
      result.current.closeTrimbleCapture({ fieldStatus: 'capturado_pendiente_proceso' });
    });

    // Registramos incidencia bloqueante sobre seg-blocked.
    act(() => {
      result.current.addTrimbleIncident({
        category: 'fallo_sensor', severity: 'bloqueante',
        segmentId: 'seg-blocked', note: 'sensor caído',
      });
    });

    act(() => { result.current.startTrimbleRecording({}); });
    const recId = result.current.state.activeTrimbleRecordingId!;
    const runId = result.current.state.activeRunId!;
    const missionId = result.current.state.activeMissionId!;

    act(() => {
      // Cubrimos los 4 tramos completamente con GPS
      for (let s = 0; s < 4; s++) {
        injectCoverPoints((p: any) => result.current.appendTrimbleGpsPoint(p), s, missionId, runId, recId);
      }
    });

    act(() => { result.current.closeTrimbleRecording({}); });

    const auto = result.current.state.trimbleSegmentCaptures
      .filter((c) => c.captureSource === 'gps_auto');
    const autoIds = auto.map((c) => c.segmentId).sort();
    expect(autoIds).toEqual(['seg-pendiente']);
  });
});
