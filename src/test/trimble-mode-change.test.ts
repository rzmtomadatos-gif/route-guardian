/**
 * Tests del guard `canChangeAcquisitionMode`.
 * Cubre todos los bloqueos de §8 del plan + permite en estado vacío.
 */
import { describe, it, expect } from 'vitest';
import { canChangeAcquisitionMode } from '@/utils/trimble/mode-change-guard';
import { createEmptyCampaignState } from '@/utils/storage';
import type { AppState } from '@/types/route';

const empty = (): AppState => createEmptyCampaignState();

describe('canChangeAcquisitionMode', () => {
  it('permite cambiar en campaña vacía', () => {
    expect(canChangeAcquisitionMode(empty()).ok).toBe(true);
  });

  it('bloquea con navegación activa', () => {
    const s = { ...empty(), navigationActive: true };
    const r = canChangeAcquisitionMode(s);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Navegación/);
  });

  it('bloquea con activeSegmentId', () => {
    const s = { ...empty(), activeSegmentId: 'seg1' };
    expect(canChangeAcquisitionMode(s).ok).toBe(false);
  });

  it('bloquea con trackSession activo', () => {
    const s: AppState = {
      ...empty(),
      trackSession: {
        active: true, trackNumber: 1, capacity: 9, segmentIds: [],
        startedAt: '2026-01-01T00:00:00Z', endedAt: null, closedManually: false,
      },
    };
    expect(canChangeAcquisitionMode(s).ok).toBe(false);
  });

  it('bloquea con blockEndPrompt abierto', () => {
    const s: AppState = {
      ...empty(),
      blockEndPrompt: { isOpen: true, trackNumber: 1, reason: 'capacity' },
    };
    expect(canChangeAcquisitionMode(s).ok).toBe(false);
  });

  it('bloquea con lastConsumedTrackByDay > 0', () => {
    const s = { ...empty(), lastConsumedTrackByDay: { 1: 3 } };
    expect(canChangeAcquisitionMode(s).ok).toBe(false);
  });

  it('permite con claves de GPS pero sin puntos reales', () => {
    const s = { ...empty(), trackGpsLogsByDay: { 1: { 1: [] } } };
    expect(canChangeAcquisitionMode(s).ok).toBe(true);
  });

  it('bloquea con puntos GPS reales', () => {
    const s: AppState = {
      ...empty(),
      trackGpsLogsByDay: {
        1: {
          1: [{
            timestamp: '2026-01-01T00:00:00Z', lat: 40, lng: -3,
            workDay: 1, trackNumber: 1, phase: 'transport', source: 'gps',
            accuracy: null, speed: null, heading: null, segmentId: null,
          }],
        },
      },
    };
    expect(canChangeAcquisitionMode(s).ok).toBe(false);
  });

  it('bloquea con misiones, runs o capturas Trimble', () => {
    const s = { ...empty(), trimbleMissions: [{ id: 'm1', workDay: 1, startedAt: '2026-01-01T00:00:00Z', endedAt: null }] };
    expect(canChangeAcquisitionMode(s).ok).toBe(false);
  });

  it('bloquea con activeMissionId/activeRunId', () => {
    expect(canChangeAcquisitionMode({ ...empty(), activeMissionId: 'm1' }).ok).toBe(false);
    expect(canChangeAcquisitionMode({ ...empty(), activeRunId: 'r1' }).ok).toBe(false);
  });

  it('permite con run vacío en GPS Trimble', () => {
    const s = { ...empty(), trimbleGpsLogsByRun: { run1: [] } };
    expect(canChangeAcquisitionMode(s).ok).toBe(true);
  });

  it('bloquea con puntos GPS Trimble reales', () => {
    const s: AppState = {
      ...empty(),
      trimbleGpsLogsByRun: {
        run1: [{
          timestamp: '2026-01-01T00:00:00Z', lat: 40, lng: -3,
          missionId: 'm1', runId: 'run1', phase: 'transport', source: 'gps',
          accuracy: null, speed: null, heading: null, segmentId: null,
        }],
      },
    };
    expect(canChangeAcquisitionMode(s).ok).toBe(false);
  });
});
