/**
 * Tests sobre las acciones reales de useRouteState (Trimble).
 *
 * Importante: el contrato de las acciones es "el cambio se ve en el
 * siguiente render", porque setState(updater) puede diferir el cálculo
 * del `outcome` (closure) hasta el commit. Por eso aquí se inspecciona
 * el estado tras cada `act()` en lugar de fiarnos del valor de retorno
 * inmediato.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRouteState } from '@/hooks/useRouteState';

function setupTrimble() {
  const hook = renderHook(() => useRouteState());
  act(() => { hook.result.current.setAcquisitionMode('TRIMBLE_LIDAR'); });
  return hook;
}

describe('useRouteState — Trimble actions', () => {
  it('startTrimbleRun usa índice 1-based (primera pasada = 1, segunda = 2)', () => {
    const { result } = setupTrimble();

    act(() => { result.current.startTrimbleMission({}); });
    expect(result.current.state.activeMissionId).not.toBeNull();

    act(() => { result.current.startTrimbleRun({}); });
    const firstRunId = result.current.state.activeRunId!;
    const firstRun = result.current.state.trimbleRuns.find((r) => r.id === firstRunId);
    expect(firstRun?.index).toBe(1);

    act(() => { result.current.closeTrimbleRun({}); });
    expect(result.current.state.activeRunId).toBeNull();

    act(() => { result.current.startTrimbleRun({}); });
    const secondRunId = result.current.state.activeRunId!;
    expect(secondRunId).not.toBe(firstRunId);
    const secondRun = result.current.state.trimbleRuns.find((r) => r.id === secondRunId);
    expect(secondRun?.index).toBe(2);
  });

  it('closeTrimbleMission consolida capturas abiertas a capturado_pendiente_proceso', () => {
    const { result } = setupTrimble();

    act(() => { result.current.startTrimbleMission({}); });
    act(() => { result.current.startTrimbleRun({}); });
    act(() => { result.current.startTrimbleCapture('seg-A'); });

    // La captura existe abierta y en_captura
    const capturesOpen = result.current.state.trimbleSegmentCaptures;
    expect(capturesOpen.length).toBe(1);
    const captureId = capturesOpen[0].id;
    expect(capturesOpen[0].fieldStatus).toBe('en_captura');
    expect(capturesOpen[0].endedAt).toBeNull();

    act(() => { result.current.closeTrimbleMission('manual'); });

    const after = result.current.state.trimbleSegmentCaptures.find((c) => c.id === captureId)!;
    expect(after.endedAt).not.toBeNull();
    expect(after.fieldStatus).toBe('capturado_pendiente_proceso');
    expect(result.current.state.activeMissionId).toBeNull();
    expect(result.current.state.activeRunId).toBeNull();
  });

  it('appendTrimbleGpsPoint persiste en trimbleGpsLogsByRun y NUNCA en trackGpsLogsByDay', () => {
    const { result } = setupTrimble();
    act(() => { result.current.startTrimbleMission({}); });
    act(() => { result.current.startTrimbleRun({}); });
    const runId = result.current.state.activeRunId!;
    const missionId = result.current.state.activeMissionId!;

    act(() => {
      result.current.appendTrimbleGpsPoint({
        timestamp: '2026-01-01T00:00:00Z',
        lat: 40, lng: -3,
        accuracy: 5, speed: 0, heading: 0,
        missionId, runId,
        phase: 'transport', segmentId: null,
        source: 'gps',
      });
    });

    expect(result.current.state.trimbleGpsLogsByRun[runId]?.length).toBe(1);
    expect(Object.keys(result.current.state.trackGpsLogsByDay)).toEqual([]);
  });
});
