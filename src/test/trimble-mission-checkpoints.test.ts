/**
 * Tests Fase 2 — Checkpoints operativos de misión Trimble.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRouteState } from '@/hooks/useRouteState';

function setup() {
  const hook = renderHook(() => useRouteState());
  act(() => { hook.result.current.setAcquisitionMode('TRIMBLE_LIDAR'); });
  return hook;
}

describe('Trimble — checkpoints de misión', () => {
  it('startTrimbleMission acepta metadatos opcionales nuevos', () => {
    const { result } = setup();
    act(() => {
      result.current.startTrimbleMission({
        vehicle: 'V1', trimbleModel: 'MX60', trimbleVariant: 'Pro',
        externalMissionId: 'EXT-1', missionContainerType: 'mxdb',
        dmiEnabled: true, gnssAzimuthEnabled: false,
      });
    });
    const m = result.current.state.trimbleMissions[0];
    expect(m.trimbleModel).toBe('MX60');
    expect(m.externalMissionId).toBe('EXT-1');
    expect(m.dmiEnabled).toBe(true);
  });

  it('completeTrimblePrecheck setea precheckCompletedAt', () => {
    const { result } = setup();
    act(() => { result.current.startTrimbleMission({}); });
    let r;
    act(() => { r = result.current.completeTrimblePrecheck({ source: 'field' }); });
    expect(r!.ok).toBe(true);
    expect(result.current.state.trimbleMissions[0].precheckCompletedAt).toBeTruthy();
  });

  it('confirmTrimbleSystemReady y confirmTrimbleGpsTimeValid', () => {
    const { result } = setup();
    act(() => { result.current.startTrimbleMission({}); });
    act(() => { result.current.confirmTrimbleSystemReady({}); });
    act(() => { result.current.confirmTrimbleGpsTimeValid({}); });
    const m = result.current.state.trimbleMissions[0];
    expect(m.systemReadyAt).toBeTruthy();
    expect(m.gpsTimeValidAt).toBeTruthy();
  });

  it('startTrimbleRun sin hora GPS válida devuelve warning, no bloquea', () => {
    const { result } = setup();
    act(() => { result.current.startTrimbleMission({}); });
    let r: any;
    act(() => { r = result.current.startTrimbleRun({}); });
    expect(r.ok).toBe(true);
    expect(r.warning).toBe('warning_no_gps_time_valid');
    const run = result.current.state.trimbleRuns[0];
    expect(run.gpsTimeWasValidAtStart).toBe(false);
  });

  it('startTrimbleRun con hora GPS válida no devuelve warning', () => {
    const { result } = setup();
    act(() => { result.current.startTrimbleMission({}); });
    act(() => { result.current.confirmTrimbleGpsTimeValid({}); });
    let r: any;
    act(() => { r = result.current.startTrimbleRun({}); });
    expect(r.ok).toBe(true);
    expect(r.warning).toBeUndefined();
    expect(result.current.state.trimbleRuns[0].gpsTimeWasValidAtStart).toBe(true);
  });

  it('confirmTrimbleStaticTail con 120s registra estado', () => {
    const { result } = setup();
    act(() => { result.current.startTrimbleMission({}); });
    let r: any;
    act(() => { r = result.current.confirmTrimbleStaticTail({ seconds: 120 }); });
    expect(r.ok).toBe(true);
    const m = result.current.state.trimbleMissions[0];
    expect(m.staticTailSeconds).toBe(120);
    expect(m.staticTailCompletedAt).toBeTruthy();
    expect(m.staticTailOverrideReason).toBeNull();
  });

  it('overrideTrimbleStaticTail sin motivo falla', () => {
    const { result } = setup();
    act(() => { result.current.startTrimbleMission({}); });
    let r: any;
    act(() => { r = result.current.overrideTrimbleStaticTail('   '); });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/motivo/i);
  });

  it('overrideTrimbleStaticTail con motivo registra override', () => {
    const { result } = setup();
    act(() => { result.current.startTrimbleMission({}); });
    let r: any;
    act(() => { r = result.current.overrideTrimbleStaticTail('Tráfico extremo'); });
    expect(r.ok).toBe(true);
    expect(result.current.state.trimbleMissions[0].staticTailOverrideReason).toBe('Tráfico extremo');
  });

  it('markTrimbleDataOffloaded guarda referencia externa', () => {
    const { result } = setup();
    act(() => { result.current.startTrimbleMission({}); });
    let r: any;
    act(() => {
      r = result.current.markTrimbleDataOffloaded({
        offloadRef: '\\\\nas\\trimble\\mission1',
        ssdIds: ['SSD-A', 'SSD-B'],
        safeEjectConfirmed: true,
        posFolderStatus: 'ok',
        selectedRawFolder: 'raw',
      });
    });
    expect(r.ok).toBe(true);
    const m = result.current.state.trimbleMissions[0];
    expect(m.dataOffloadedAt).toBeTruthy();
    expect(m.offloadRef).toContain('mission1');
    expect(m.ssdIds).toEqual(['SSD-A', 'SSD-B']);
    expect(m.posFolderStatus).toBe('ok');
  });

  it('updateTrimbleMissionMetadata aplica patch parcial', () => {
    const { result } = setup();
    act(() => { result.current.startTrimbleMission({}); });
    act(() => { result.current.updateTrimbleMissionMetadata({ datumCrs: 'ETRS89/UTM30N', geoidModel: 'EGM2008' }); });
    const m = result.current.state.trimbleMissions[0];
    expect(m.datumCrs).toBe('ETRS89/UTM30N');
    expect(m.geoidModel).toBe('EGM2008');
  });

  it('updateTrimbleRunMetadata actualiza run específico', () => {
    const { result } = setup();
    act(() => { result.current.startTrimbleMission({}); });
    act(() => { result.current.startTrimbleRun({}); });
    const runId = result.current.state.activeRunId!;
    act(() => {
      result.current.updateTrimbleRunMetadata(runId, {
        wifiLossCount: 2, urbanCanyonObserved: true, integrityStatus: 'field_warning',
      });
    });
    const run = result.current.state.trimbleRuns.find((r) => r.id === runId)!;
    expect(run.wifiLossCount).toBe(2);
    expect(run.urbanCanyonObserved).toBe(true);
    expect(run.integrityStatus).toBe('field_warning');
  });

  it('todas las acciones requieren modo TRIMBLE_LIDAR', () => {
    const { result } = renderHook(() => useRouteState()).result;
    // Modo por defecto NO es Trimble
    expect(result.current.state.acquisitionMode).not.toBe('TRIMBLE_LIDAR');
    let r: any;
    act(() => { r = result.current.completeTrimblePrecheck({}); });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Trimble/i);
  });

  it('acciones de misión fallan sin misión activa', () => {
    const { result } = setup();
    let r: any;
    act(() => { r = result.current.confirmTrimbleSystemReady({}); });
    expect(r.ok).toBe(false);
  });
});
