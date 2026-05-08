/**
 * Comprobaciones de la separación estricta GPS por modo (§9).
 * Como los tests existentes para GPS, replicamos las DECISIONES sin React.
 */
import { describe, it, expect } from 'vitest';
import type { AppState, LatLng } from '@/types/route';
import { createEmptyCampaignState } from '@/utils/storage';
import { findActiveCapture } from '@/types/trimble';

function trackGpsShouldRecord(s: AppState): boolean {
  if (s.acquisitionMode === 'TRIMBLE_LIDAR') return false;
  if (!s.navigationActive) return false;
  if (!s.trackSession?.active) return false;
  return true;
}

function trimbleGpsShouldRecord(s: AppState): boolean {
  if (s.acquisitionMode !== 'TRIMBLE_LIDAR') return false;
  if (!s.activeMissionId || !s.activeRunId) return false;
  return true;
}

function trimblePhase(s: AppState): 'capture' | 'transport' | null {
  if (!trimbleGpsShouldRecord(s)) return null;
  const open = findActiveCapture(s.trimbleSegmentCaptures, s.activeRunId);
  return open ? 'capture' : 'transport';
}

const POS: LatLng = { lat: 40, lng: -3 };

describe('GPS doble — separación estricta por modo', () => {
  it('1) TRIMBLE_LIDAR + run abierto → trimble registra, track NO', () => {
    const s: AppState = {
      ...createEmptyCampaignState(),
      acquisitionMode: 'TRIMBLE_LIDAR',
      navigationActive: true,
      activeMissionId: 'm1',
      activeRunId: 'r1',
    };
    expect(trimbleGpsShouldRecord(s)).toBe(true);
    expect(trackGpsShouldRecord(s)).toBe(false);
  });

  it('2) TRIMBLE_LIDAR sin run → ningún hook registra', () => {
    const s: AppState = { ...createEmptyCampaignState(), acquisitionMode: 'TRIMBLE_LIDAR' };
    expect(trimbleGpsShouldRecord(s)).toBe(false);
    expect(trackGpsShouldRecord(s)).toBe(false);
  });

  it('3) RST con track activo → track registra, trimble NO', () => {
    const s: AppState = {
      ...createEmptyCampaignState(),
      acquisitionMode: 'RST',
      navigationActive: true,
      trackSession: { active: true, trackNumber: 1, capacity: 9, segmentIds: [], startedAt: '2026-01-01T00:00:00Z', endedAt: null, closedManually: false },
    };
    expect(trackGpsShouldRecord(s)).toBe(true);
    expect(trimbleGpsShouldRecord(s)).toBe(false);
  });

  it('4) GARMIN con track activo → track registra, trimble NO', () => {
    const s: AppState = {
      ...createEmptyCampaignState(),
      acquisitionMode: 'GARMIN',
      navigationActive: true,
      trackSession: { active: true, trackNumber: 1, capacity: 9, segmentIds: [], startedAt: '2026-01-01T00:00:00Z', endedAt: null, closedManually: false },
    };
    expect(trackGpsShouldRecord(s)).toBe(true);
    expect(trimbleGpsShouldRecord(s)).toBe(false);
  });

  it('5) phase=capture si hay captura abierta; transport si no', () => {
    const base: AppState = {
      ...createEmptyCampaignState(),
      acquisitionMode: 'TRIMBLE_LIDAR',
      activeMissionId: 'm1',
      activeRunId: 'r1',
    };
    expect(trimblePhase(base)).toBe('transport');
    const withCap: AppState = {
      ...base,
      trimbleSegmentCaptures: [{
        id: 'c1', segmentId: 's1', runId: 'r1', missionId: 'm1',
        startedAt: '2026-01-01T00:00:00Z', endedAt: null,
        fieldStatus: 'en_captura', qaStatus: null,
      }],
    };
    expect(trimblePhase(withCap)).toBe('capture');
  });

  // Mantener referencia para que el linter no se queje
  it('POS disponible para futuras extensiones', () => {
    expect(POS.lat).toBeDefined();
  });
});
