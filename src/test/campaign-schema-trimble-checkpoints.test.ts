/**
 * Round-trip schema: campañas antiguas (sin nuevos campos) y nuevas (con
 * checkpoints/metadatos/trayectoria) validan correctamente.
 */
import { describe, it, expect } from 'vitest';
import { campaignExportSchema } from '@/utils/persistence/campaign-schema';

const baseState = {
  route: null,
  incidents: [],
  activeSegmentId: null,
  navigationActive: false,
  currentPosition: null,
  base: null,
  rstMode: false,
  rstGroupSize: 9,
  trackSession: null,
  blockEndPrompt: { isOpen: false, trackNumber: null, reason: 'manual' },
  workDay: 1,
  acquisitionMode: 'TRIMBLE_LIDAR',
  lastConsumedTrackByDay: {},
  segmentCorrections: [],
  trackGpsLogsByDay: {},
  trimbleIncidents: [],
  trimbleGpsLogsByRun: {},
  activeMissionId: null,
  activeRunId: null,
};

describe('Schema Trimble — checkpoints/metadatos', () => {
  it('campaña antigua (mission sin nuevos campos) sigue validando', () => {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion: '1.0.0',
      state: {
        ...baseState,
        trimbleMissions: [{
          id: 'm1', workDay: 1, startedAt: new Date().toISOString(), endedAt: null,
          vehicle: 'V1',
        }],
        trimbleRuns: [],
        trimbleSegmentCaptures: [],
        trimbleDeliverables: [],
      },
      eventLog: [],
    };
    const r = campaignExportSchema.safeParse(data);
    expect(r.success).toBe(true);
  });

  it('campaña nueva con checkpoints/metadatos completos valida', () => {
    const now = new Date().toISOString();
    const data = {
      version: 1,
      exportedAt: now,
      appVersion: '1.1.0',
      state: {
        ...baseState,
        trimbleMissions: [{
          id: 'm1', workDay: 1, startedAt: now, endedAt: null,
          trimbleModel: 'MX60', trimbleVariant: 'Pro',
          externalMissionId: 'EXT-1', missionContainerType: 'mxdb', missionContainerRef: 'C:\\proj\\m1.mxdb',
          dmiEnabled: true, gnssAzimuthEnabled: false,
          tmiVersion: '3.07.00', posFirmwareVersion: '8.10',
          precheckCompletedAt: now, systemReadyAt: now, gpsTimeValidAt: now,
          staticTailSeconds: 120, staticTailCompletedAt: now, staticTailOverrideReason: null,
          dataOffloadedAt: now, offloadRef: '\\\\nas\\m1', ssdIds: ['A', 'B'], safeEjectConfirmed: true,
          posFolderStatus: 'ok', selectedRawFolder: 'raw', downloadIntegrityWarning30700: false,
          datumCrs: 'ETRS89/UTM30N', geoidModel: 'EGM2008',
          trajectoryDeliverableId: 'd1', trajectorySource: 'processed',
          trajectoryMethod: 'SBET', trajectoryAccepted: true, trajectoryProcessedAt: now, trajectoryProcessedBy: 'Gab',
        }],
        trimbleRuns: [{
          id: 'r1', missionId: 'm1', index: 1, startedAt: now, endedAt: null,
          gpsTimeWasValidAtStart: true, systemReadyWasConfirmed: true,
          runDistanceMeters: 1500, wifiLossCount: 1, gnssIssueCount: 0,
          urbanCanyonObserved: true, integrityStatus: 'field_ok', operatorNotes: 'OK',
        }],
        trimbleSegmentCaptures: [],
        trimbleDeliverables: [{
          id: 'd1', kind: 'trayectoria', missionId: 'm1',
          reference: '\\\\nas\\m1\\sbet.out', uploadedAt: now,
          storageType: 'nas', version: '1.0', processedBy: 'Gab', processedAt: now,
          trajectoryMethod: 'SBET', trajectoryAccepted: true,
          datumCrs: 'ETRS89/UTM30N', geoidModel: 'EGM2008',
          processingStage: 'trajectory_processed',
        }],
      },
      eventLog: [],
    };
    const r = campaignExportSchema.safeParse(data);
    if (!r.success) console.error(r.error.issues);
    expect(r.success).toBe(true);
  });

  it('campos enum inválidos en misión son rechazados', () => {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion: '1.1.0',
      state: {
        ...baseState,
        trimbleMissions: [{
          id: 'm1', workDay: 1, startedAt: new Date().toISOString(), endedAt: null,
          trimbleModel: 'INVALID_MODEL',
        }],
        trimbleRuns: [],
        trimbleSegmentCaptures: [],
        trimbleDeliverables: [],
      },
      eventLog: [],
    };
    const r = campaignExportSchema.safeParse(data);
    expect(r.success).toBe(false);
  });
});
