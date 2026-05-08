/**
 * Test: incidencia con invalidatesRun=true encadenada con invalidateTrimbleRun.
 *
 * Sigue la convención de trimble-actions.test.ts: NO confiamos en el
 * valor devuelto por la acción dentro del mismo act() (el outcome
 * pertenece al updater diferido); inspeccionamos el estado tras el
 * commit.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRouteState } from '@/hooks/useRouteState';

describe('Trimble — incidencia invalidante encadena invalidateTrimbleRun', () => {
  it('invalida la pasada y reabre la captura como repetir', () => {
    const { result } = renderHook(() => useRouteState());
    act(() => { result.current.setAcquisitionMode('TRIMBLE_LIDAR'); });
    act(() => { result.current.startTrimbleMission({}); });
    act(() => { result.current.startTrimbleRun({}); });
    const runId = result.current.state.activeRunId!;
    act(() => { result.current.startTrimbleCapture('seg-X'); });
    const captureId = result.current.state.trimbleSegmentCaptures[0].id;

    act(() => {
      result.current.recordTrimbleIncident({
        category: 'gnss_perdida',
        severity: 'bloqueante',
        note: 'Pérdida total señal',
        runId,
        segmentId: 'seg-X',
        invalidatesRun: true,
      });
    });
    expect(result.current.state.trimbleIncidents.length).toBe(1);

    act(() => { result.current.invalidateTrimbleRun('Pérdida total señal'); });

    expect(result.current.state.activeRunId).toBeNull();
    const run = result.current.state.trimbleRuns.find((r) => r.id === runId)!;
    expect(run.invalidated).toBe(true);
    expect(run.endedAt).not.toBeNull();
    const cap = result.current.state.trimbleSegmentCaptures.find((c) => c.id === captureId)!;
    expect(cap.fieldStatus).toBe('repetir');
    expect(cap.endedAt).not.toBeNull();
  });

  it('sin pasada activa: la incidencia se registra pero no hay nada que invalidar', () => {
    const { result } = renderHook(() => useRouteState());
    act(() => { result.current.setAcquisitionMode('TRIMBLE_LIDAR'); });
    act(() => { result.current.startTrimbleMission({}); });

    expect(result.current.state.activeRunId).toBeNull();

    act(() => {
      result.current.recordTrimbleIncident({
        category: 'otro',
        severity: 'media',
        note: 'sin pasada',
        runId: null,
        segmentId: null,
        invalidatesRun: true,
      });
    });
    expect(result.current.state.trimbleIncidents.length).toBe(1);

    // invalidateTrimbleRun debe ser no-op (no hay activeRunId).
    act(() => { result.current.invalidateTrimbleRun('sin pasada'); });
    expect(result.current.state.trimbleRuns.every((r) => !r.invalidated)).toBe(true);
  });
});
