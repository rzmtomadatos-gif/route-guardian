import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRouteState } from '@/hooks/useRouteState';

describe('debug', () => {
  it('mission then state inspect', () => {
    const { result } = renderHook(() => useRouteState());
    act(() => {
      const r = result.current.setAcquisitionMode('TRIMBLE_LIDAR');
      console.log('setMode:', r);
    });
    console.log('mode after:', result.current.state.acquisitionMode);
    act(() => {
      const r = result.current.startTrimbleMission({});
      console.log('startMission:', r);
    });
    console.log('mission after:', result.current.state.activeMissionId, 'missions:', result.current.state.trimbleMissions.length);
    act(() => {
      const r = result.current.startTrimbleRun({});
      console.log('startRun:', r);
    });
    console.log('run after:', result.current.state.activeRunId);
  });
});
