/**
 * Verifica que el schema de validación de campañas acepta los campos
 * `distanceToMatchedSegmentMeters` y `progressOnMatchedSegment` en
 * los puntos GPS Trimble (regresión: el .strict() los rechazaba).
 */
import { describe, it, expect } from 'vitest';
import { campaignExportSchema } from '@/utils/persistence/campaign-schema';

const baseRoute = {
  id: 'r1',
  name: 'Ruta',
  loadedAt: '2026-01-01T00:00:00Z',
  fileName: 'r.kml',
  segments: [
    {
      id: 's1',
      routeId: 'r1',
      trackNumber: null,
      plannedTrackNumber: null,
      trackHistory: [],
      kmlId: '',
      name: 'S1',
      notes: '',
      coordinates: [{ lat: 40, lng: -3 }, { lat: 40.001, lng: -3.001 }],
      direction: 'creciente' as const,
      type: 'tramo' as const,
      status: 'pendiente' as const,
      kmlMeta: {},
    },
  ],
  optimizedOrder: ['s1'],
};

function buildPoint(extras: Record<string, unknown> = {}) {
  return {
    timestamp: '2026-01-01T10:00:00Z',
    lat: 40,
    lng: -3,
    accuracy: 5,
    speed: 10,
    heading: 90,
    missionId: 'm1',
    runId: 'run1',
    phase: 'capture' as const,
    source: 'gps' as const,
    recordingSessionId: 'rec1',
    matchedSegmentId: 's1',
    ...extras,
  };
}

function buildExport(points: unknown[]) {
  return {
    version: 1 as const,
    exportedAt: '2026-01-01T00:00:00Z',
    appVersion: '1.0.0',
    state: {
      route: baseRoute,
      trimbleGpsLogsByRun: { run1: points },
    },
    eventLog: [],
  };
}

describe('campaign schema · Trimble GPS new fields', () => {
  it('acepta puntos con distanceToMatchedSegmentMeters y progressOnMatchedSegment', () => {
    const point = buildPoint({
      distanceToMatchedSegmentMeters: 12.4,
      progressOnMatchedSegment: 0.42,
    });
    const result = campaignExportSchema.safeParse(buildExport([point]));
    expect(result.success).toBe(true);
  });

  it('acepta campañas antiguas sin esos campos (compat. hacia atrás)', () => {
    const result = campaignExportSchema.safeParse(buildExport([buildPoint()]));
    expect(result.success).toBe(true);
  });

  it('normaliza progressOnMatchedSegment 0..100 a 0..1', () => {
    const r = campaignExportSchema.safeParse(
      buildExport([buildPoint({ progressOnMatchedSegment: 42 })]),
    );
    expect(r.success).toBe(true);
    if (r.success) {
      const p = r.data.state.trimbleGpsLogsByRun.run1[0] as { progressOnMatchedSegment: number };
      expect(p.progressOnMatchedSegment).toBeCloseTo(0.42);
    }
  });

  it('degrada progressOnMatchedSegment imposible (>100) a null sin bloquear', () => {
    const r = campaignExportSchema.safeParse(
      buildExport([buildPoint({ progressOnMatchedSegment: 120 })]),
    );
    expect(r.success).toBe(true);
    if (r.success) {
      const p = r.data.state.trimbleGpsLogsByRun.run1[0] as { progressOnMatchedSegment: number | null };
      expect(p.progressOnMatchedSegment).toBeNull();
    }
  });

  it('degrada distanceToMatchedSegmentMeters negativa a null sin bloquear', () => {
    const r = campaignExportSchema.safeParse(
      buildExport([buildPoint({ distanceToMatchedSegmentMeters: -5 })]),
    );
    expect(r.success).toBe(true);
    if (r.success) {
      const p = r.data.state.trimbleGpsLogsByRun.run1[0] as { distanceToMatchedSegmentMeters: number | null };
      expect(p.distanceToMatchedSegmentMeters).toBeNull();
    }
  });

  it('acepta trimbleRecordingSessions con status invalidated y campos asociados', () => {
    const exp = buildExport([buildPoint()]);
    (exp.state as any).trimbleRecordingSessions = [{
      id: 'rec1',
      missionId: 'm1',
      runId: 'run1',
      startedAt: '2026-01-01T09:00:00Z',
      endedAt: '2026-01-01T10:00:00Z',
      status: 'invalidated',
      invalidatedAt: '2026-01-01T10:00:00Z',
      invalidatedReason: 'fallo sensor',
    }];
    const r = campaignExportSchema.safeParse(exp);
    if (!r.success) throw new Error(r.error.issues[0].message);
    expect(r.success).toBe(true);
  });

  it('valida un run realista con 700+ puntos sin Unrecognized key', () => {
    const points = Array.from({ length: 750 }, (_, i) =>
      buildPoint({
        timestamp: new Date(Date.UTC(2026, 0, 1, 10, 0, i)).toISOString(),
        distanceToMatchedSegmentMeters: i % 30,
        progressOnMatchedSegment: (i % 100) / 100,
      }),
    );
    const result = campaignExportSchema.safeParse(buildExport(points));
    if (!result.success) {
      const err = result.error.issues[0];
      throw new Error(`Validación falló: ${err.path.join('.')} - ${err.message}`);
    }
    expect(result.success).toBe(true);
  });
});
