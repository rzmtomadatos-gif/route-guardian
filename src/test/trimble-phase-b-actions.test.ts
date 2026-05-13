/**
 * Acciones de estado Trimble Phase B: overrides, capturas manuales y voids.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRouteState } from '@/hooks/useRouteState';
import { isCaptureActive } from '@/types/trimble';

function setupTrimble() {
  const hook = renderHook(() => useRouteState());
  act(() => { hook.result.current.setAcquisitionMode('TRIMBLE_LIDAR'); });
  return hook;
}

describe('Trimble — direction override', () => {
  it('aplica y limpia override por tramo', () => {
    const { result } = setupTrimble();
    act(() => { result.current.setTrimbleSegmentDirectionOverride('seg-A', 'reversed'); });
    expect(result.current.state.trimbleSegmentDirectionOverrides['seg-A']).toBe('reversed');
    act(() => { result.current.setTrimbleSegmentDirectionOverride('seg-A', null); });
    expect(result.current.state.trimbleSegmentDirectionOverrides['seg-A']).toBeUndefined();
  });
});

describe('Trimble — manual capture (operator_override)', () => {
  it('crea captura operator_override en run activo', () => {
    const { result } = setupTrimble();
    act(() => { result.current.startTrimbleMission({}); });
    act(() => { result.current.startTrimbleRun({}); });
    act(() => { result.current.markTrimbleSegmentManuallyCaptured('seg-X', 'manual ok'); });
    const caps = result.current.state.trimbleSegmentCaptures.filter((c) => c.segmentId === 'seg-X');
    expect(caps.length).toBe(1);
    expect(caps[0].captureSource).toBe('operator_override');
    expect(caps[0].fieldStatus).toBe('capturado_pendiente_proceso');
    expect(isCaptureActive(caps[0])).toBe(true);
  });

  it('falla sin misión/pasada activas', () => {
    const { result } = setupTrimble();
    act(() => { result.current.markTrimbleSegmentManuallyCaptured('seg-X'); });
    expect(result.current.state.trimbleSegmentCaptures.length).toBe(0);
  });
});

describe('Trimble — recording override force_pending durante grabación activa', () => {
  it('force_pending evita gps_auto al cerrar grabación (falso positivo paralelo)', () => {
    const { result } = setupTrimble();
    act(() => { result.current.startTrimbleMission({}); });
    act(() => { result.current.startTrimbleRun({}); });
    act(() => { result.current.startTrimbleRecording({}); });

    // Inyectar manualmente una captura gps_auto que el motor pudo crear
    // y luego marcar el tramo como force_pending: debe anular esa captura.
    const recId = result.current.state.activeTrimbleRecordingId!;
    const runId = result.current.state.activeRunId!;
    const missionId = result.current.state.activeMissionId!;
    act(() => {
      // Insertar captura sintética simulando un falso positivo del motor
      // (lo hacemos mediante markTrimbleSegmentManuallyCaptured y luego
      //  reescribimos su origen — alternativa: tocar el state vía closeRec).
      result.current.markTrimbleSegmentManuallyCaptured('seg-PARA', 'sim');
    });
    void recId; void runId; void missionId;

    // Aplicar force_pending: debe voidear capturas activas de este run/sesión
    act(() => { result.current.setTrimbleRecordingSegmentOverride('seg-PARA', 'force_pending'); });
    expect(result.current.state.trimbleRecordingSegmentOverrides[recId]?.['seg-PARA']).toBe('force_pending');
    const caps = result.current.state.trimbleSegmentCaptures.filter((c) => c.segmentId === 'seg-PARA');
    expect(caps.length).toBe(1);
    expect(caps[0].voidedAt).not.toBeNull();
    expect(isCaptureActive(caps[0])).toBe(false);

    // Cerrar grabación: no debe crear nueva captura para seg-PARA por gps_auto
    act(() => { result.current.closeTrimbleRecording({}); });
    const finalCaps = result.current.state.trimbleSegmentCaptures.filter(
      (c) => c.segmentId === 'seg-PARA' && isCaptureActive(c),
    );
    expect(finalCaps.length).toBe(0);
    // Override debe limpiarse al cerrar
    expect(result.current.state.trimbleRecordingSegmentOverrides[recId]).toBeUndefined();
  });
});

describe('Trimble — operational selection', () => {
  it('selecciona y deselecciona tramo operativo', () => {
    const { result } = setupTrimble();
    act(() => { result.current.setTrimbleOperationalSelected('seg-Y'); });
    expect(result.current.state.trimbleOperationalSelectedSegmentId).toBe('seg-Y');
    act(() => { result.current.setTrimbleOperationalSelected(null); });
    expect(result.current.state.trimbleOperationalSelectedSegmentId).toBeNull();
  });
});

describe('Trimble — RST/GARMIN no se ven afectados', () => {
  it('setTrimbleOperationalSelected es no-op fuera de TRIMBLE_LIDAR', () => {
    const hook = renderHook(() => useRouteState());
    // Modo por defecto: RST
    act(() => { hook.result.current.setTrimbleOperationalSelected('seg-Z'); });
    expect(hook.result.current.state.trimbleOperationalSelectedSegmentId).toBeNull();
  });

  it('setTrimbleRecordingSegmentOverride es no-op fuera de TRIMBLE_LIDAR', () => {
    const hook = renderHook(() => useRouteState());
    act(() => { hook.result.current.setTrimbleRecordingSegmentOverride('seg-Z', 'force_pending'); });
    expect(Object.keys(hook.result.current.state.trimbleRecordingSegmentOverrides)).toEqual([]);
  });
});
