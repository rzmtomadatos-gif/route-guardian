/**
 * Test: incidencia con invalidatesRun=true encadenada con invalidateTrimbleRun.
 *
 * Reproduce el flujo de UI de TrimbleFieldPanel a nivel de acciones:
 *  - abrir misión → pasada → captura
 *  - registrar incidencia bloqueante con invalidatesRun=true
 *  - llamar a invalidateTrimbleRun (lo que hace el handler tras confirmar)
 *
 * Verifica:
 *  - activeRunId queda null
 *  - run marcado invalidated
 *  - captura cerrada con fieldStatus = 'repetir'
 *  - eventLog contiene TRIMBLE_RUN_INVALIDATED
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
      const r = result.current.recordTrimbleIncident({
        category: 'gnss_perdida',
        severity: 'bloqueante',
        note: 'Pérdida total señal',
        runId,
        segmentId: 'seg-X',
        invalidatesRun: true,
      });
      expect(r.ok).toBe(true);
    });
    act(() => {
      const inv = result.current.invalidateTrimbleRun('Pérdida total señal');
      expect(inv.ok).toBe(true);
    });

    expect(result.current.state.activeRunId).toBeNull();
    const run = result.current.state.trimbleRuns.find((r) => r.id === runId)!;
    expect(run.invalidated).toBe(true);
    expect(run.endedAt).not.toBeNull();
    const cap = result.current.state.trimbleSegmentCaptures.find((c) => c.id === captureId)!;
    expect(cap.fieldStatus).toBe('repetir');
    expect(cap.endedAt).not.toBeNull();

    const events = result.current.state.eventLog ?? [];
    expect(events.some((e) => e.type === 'TRIMBLE_RUN_INVALIDATED')).toBe(true);
  });

  it('sin pasada activa, recordTrimbleIncident registra pero invalidateTrimbleRun falla', () => {
    const { result } = renderHook(() => useRouteState());
    act(() => { result.current.setAcquisitionMode('TRIMBLE_LIDAR'); });
    act(() => { result.current.startTrimbleMission({}); });

    act(() => {
      const r = result.current.recordTrimbleIncident({
        category: 'otro',
        severity: 'media',
        note: 'sin pasada',
        runId: null,
        segmentId: null,
        invalidatesRun: true,
      });
      expect(r.ok).toBe(true);
    });
    act(() => {
      const inv = result.current.invalidateTrimbleRun('sin pasada');
      expect(inv.ok).toBe(false);
      expect(inv.reason).toMatch(/pasada/i);
    });
    expect(result.current.state.trimbleIncidents.length).toBe(1);
  });
});
