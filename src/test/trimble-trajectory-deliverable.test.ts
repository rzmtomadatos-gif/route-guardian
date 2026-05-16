/**
 * Tests Fase 2 — Vinculación y aceptación de trayectoria procesada externa.
 *
 * Regla dura: la trayectoria final SIEMPRE es un TrimbleDeliverable externo.
 * La traza GPS auxiliar de VialRoute (`trimbleGpsLogsByRun`) nunca se convierte
 * en trayectoria final.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRouteState } from '@/hooks/useRouteState';

function setupWithMission() {
  const hook = renderHook(() => useRouteState());
  act(() => { hook.result.current.setAcquisitionMode('TRIMBLE_LIDAR'); });
  act(() => { hook.result.current.startTrimbleMission({}); });
  return hook;
}

describe('Trimble — trayectoria como deliverable externo', () => {
  it('linkTrimbleTrajectoryDeliverable crea deliverable kind=trayectoria y referencia en misión', () => {
    const { result } = setupWithMission();
    let r: any;
    act(() => {
      r = result.current.linkTrimbleTrajectoryDeliverable({
        reference: '\\\\nas\\proj\\sbet.out',
        trajectoryMethod: 'SBET',
        datumCrs: 'ETRS89/UTM30N',
        geoidModel: 'EGM2008',
        processedBy: 'Gabinete',
      });
    });
    const d = result.current.state.trimbleDeliverables.find((x) => x.id === r.deliverableId)!;
    expect(d.kind).toBe('trayectoria');
    expect(d.trajectoryMethod).toBe('SBET');
    expect(d.processingStage).toBe('trajectory_processed');
    const m = result.current.state.trimbleMissions[0];
    expect(m.trajectoryDeliverableId).toBe(r.deliverableId);
    expect(m.trajectorySource).toBe('processed');
    expect(m.trajectoryAccepted).toBeNull();
  });

  it('linkTrimbleTrajectoryDeliverable exige reference no vacía', () => {
    const { result } = setupWithMission();
    let r: any;
    act(() => { r = result.current.linkTrimbleTrajectoryDeliverable({ reference: '   ' }); });
    expect(r.ok).toBe(false);
  });

  it('acceptTrimbleTrajectory marca aceptada y persiste timestamp', () => {
    const { result } = setupWithMission();
    const missionId = result.current.state.activeMissionId!;
    act(() => {
      result.current.linkTrimbleTrajectoryDeliverable({ reference: 'ref', trajectoryMethod: 'SBET' });
    });
    let r: any;
    act(() => { r = result.current.acceptTrimbleTrajectory(missionId, { processedBy: 'op-gab' }); });
    const m = result.current.state.trimbleMissions.find((x) => x.id === missionId)!;
    expect(m.trajectoryAccepted).toBe(true);
    expect(m.trajectoryProcessedAt).toBeTruthy();
  });

  it('rejectTrimbleTrajectory marca rechazada', () => {
    const { result } = setupWithMission();
    const missionId = result.current.state.activeMissionId!;
    act(() => { result.current.linkTrimbleTrajectoryDeliverable({ reference: 'ref' }); });
    let r: any;
    act(() => { r = result.current.rejectTrimbleTrajectory(missionId); });
    expect(result.current.state.trimbleMissions.find((x) => x.id === missionId)!.trajectoryAccepted).toBe(false);
  });

  it('aceptar/rechazar sin trayectoria vinculada falla', () => {
    const { result } = setupWithMission();
    const missionId = result.current.state.activeMissionId!;
    let r: any;
    act(() => { r = result.current.acceptTrimbleTrajectory(missionId); });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/trayectoria/i);
  });

  it('GPS auxiliar (trimbleGpsLogsByRun) no es deliverable y no se promueve', () => {
    const { result } = setupWithMission();
    act(() => { result.current.confirmTrimbleGpsTimeValid({}); });
    act(() => { result.current.startTrimbleRun({}); });
    const runId = result.current.state.activeRunId!;
    const missionId = result.current.state.activeMissionId!;
    act(() => {
      result.current.appendTrimbleGpsPoint({
        timestamp: new Date().toISOString(), lat: 40, lng: -3,
        missionId, runId, phase: 'transport', source: 'gps',
      });
    });
    // No hay deliverable creado automáticamente desde la traza GPS auxiliar
    expect(result.current.state.trimbleDeliverables.length).toBe(0);
    // La misión no tiene trayectoria final
    expect(result.current.state.trimbleMissions[0].trajectoryDeliverableId).toBeFalsy();
  });
});
