/**
 * Test integración: flujo completo de grabación continua Trimble.
 * - Iniciar misión + pasada
 * - Iniciar grabación
 * - Registrar puntos GPS sintéticos que cubren un tramo de extremo a extremo
 *   y otro tramo solo parcialmente (gap > 30%)
 * - Cerrar grabación → debe auto-capturar el tramo cubierto y NO el parcial
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRouteState } from '@/hooks/useRouteState';
import type { Route, Segment } from '@/types/route';

function buildSegment(id: string, coords: Array<{ lat: number; lng: number }>): Segment {
  return {
    id, routeId: 'r', trackNumber: null, plannedTrackNumber: null, trackHistory: [],
    kmlId: id, name: id, notes: '',
    coordinates: coords, direction: 'creciente', type: 'tramo',
    status: 'pendiente', kmlMeta: {},
  };
}

// Ruta corta sintética: dos tramos casi rectos a latitudes distintas.
// Usamos pasos de ~0.0001° lat ≈ 11 m para tener resolución suficiente.
function makeRoute(): Route {
  const segA: Segment = buildSegment('seg-A', [
    { lat: 40.0000, lng: -3.7000 },
    { lat: 40.0050, lng: -3.7000 }, // ~555 m hacia el norte
  ]);
  const segB: Segment = buildSegment('seg-B', [
    { lat: 40.0100, lng: -3.7000 },
    { lat: 40.0150, lng: -3.7000 },
  ]);
  return {
    id: 'r', name: 'r', loadedAt: '', fileName: '',
    segments: [segA, segB], optimizedOrder: ['seg-A', 'seg-B'],
  };
}

describe('Trimble recording — cobertura GPS auto-captura', () => {
  it('genera SegmentCapture gps_auto solo para tramos con cobertura completa', async () => {
    const { result } = renderHook(() => useRouteState());
    await act(async () => { await result.current.setRoute(makeRoute()); });
    act(() => { result.current.setAcquisitionMode('TRIMBLE_LIDAR'); });
    act(() => { result.current.startTrimbleMission({}); });
    act(() => { result.current.startTrimbleRun({}); });

    act(() => { result.current.startTrimbleRecording({}); });
    const recId = result.current.state.activeTrimbleRecordingId!;
    expect(recId).toBeTruthy();
    const runId = result.current.state.activeRunId!;

    // Inyectamos puntos GPS directamente en el log (simulando useTrimbleGpsLog).
    // segA: 12 puntos cubriendo la ruta de extremo a extremo.
    // segB: solo 3 puntos al inicio (no llega a 85% endProgress).
    const baseTime = Date.now();
    const points = [];
    for (let i = 0; i <= 11; i++) {
      points.push({
        runId,
        timestamp: baseTime + i * 1000,
        position: { lat: 40.0000 + (0.005 * i) / 11, lng: -3.7000 },
        accuracy: 5,
        speed: 10,
        phase: 'capture' as const,
        recordingSessionId: recId,
      });
    }
    // Tramo B: solo arranque
    for (let i = 0; i <= 2; i++) {
      points.push({
        runId,
        timestamp: baseTime + 20000 + i * 1000,
        position: { lat: 40.0100 + (0.0008 * i), lng: -3.7000 },
        accuracy: 5,
        speed: 10,
        phase: 'capture' as const,
        recordingSessionId: recId,
      });
    }

    act(() => {
      // Insertamos los puntos por la API pública del hook (appendTrimbleGpsPoint).
      for (const p of points) {
        result.current.appendTrimbleGpsPoint(p as any);
      }
    });

    let closeOut: any;
    act(() => { closeOut = result.current.closeTrimbleRecording({}); });

    // Inspeccionamos a través del estado committed.
    const captures = result.current.state.trimbleSegmentCaptures;
    const auto = captures.filter((c) => c.captureSource === 'gps_auto');
    expect(auto.length).toBe(1);
    expect(auto[0].segmentId).toBe('seg-A');
    expect(auto[0].fieldStatus).toBe('capturado_pendiente_proceso');
    expect(auto[0].recordingSessionId).toBe(recId);
    expect((auto[0].coverageRatio ?? 0)).toBeGreaterThanOrEqual(0.7);

    // Sesión cerrada
    expect(result.current.state.activeTrimbleRecordingId).toBeNull();
    const session = result.current.state.trimbleRecordingSessions?.find((r) => r.id === recId);
    expect(session?.endedAt).not.toBeNull();
  });
});
