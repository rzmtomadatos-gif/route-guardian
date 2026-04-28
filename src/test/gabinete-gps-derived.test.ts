/**
 * Tests para utilidades GPS derivadas (Fase 1 visualización gabinete).
 */

import { describe, expect, it } from 'vitest';
import type { TrackGpsPoint } from '@/types/route';
import {
  computeTrackGpsMetrics,
  computeTrackGpsMilestones,
  getTrackPoints,
  listAvailableDays,
  listAvailableTracks,
} from '@/utils/gabinete/track-gps-derived';
import { buildTrackGpsPolylines } from '@/utils/gabinete/track-gps-geometry';

function makePoint(
  partial: Partial<TrackGpsPoint> & {
    lat: number;
    lng: number;
    timestamp: string;
    phase: 'transport' | 'recording';
  },
): TrackGpsPoint {
  return {
    workDay: 1,
    trackNumber: 1,
    source: 'gps',
    segmentId: partial.phase === 'recording' ? (partial.segmentId ?? 'seg-x') : null,
    accuracy: null,
    speed: null,
    heading: null,
    ...partial,
  };
}

describe('track-gps-derived', () => {
  it('returns empty metrics for empty / null input', () => {
    expect(computeTrackGpsMetrics([])).toMatchObject({
      pointCount: 0,
      totalDistanceMeters: 0,
      recordedSegmentIds: [],
    });
    expect(computeTrackGpsMetrics(undefined)).toMatchObject({ pointCount: 0 });
    expect(computeTrackGpsMetrics(null)).toMatchObject({ pointCount: 0 });
  });

  it('computes total distance and time across mixed phases', () => {
    // 3 puntos a ~111m de distancia entre sí (1 grado de longitud ≈ 111km a ecuador,
    // pero usamos lat ~0 y desplazamiento muy pequeño en lng).
    const pts: TrackGpsPoint[] = [
      makePoint({ lat: 0, lng: 0, timestamp: '2025-01-01T00:00:00Z', phase: 'transport' }),
      makePoint({ lat: 0, lng: 0.001, timestamp: '2025-01-01T00:00:30Z', phase: 'transport' }),
      makePoint({
        lat: 0,
        lng: 0.002,
        timestamp: '2025-01-01T00:01:00Z',
        phase: 'recording',
        segmentId: 'seg-1',
      }),
    ];
    const m = computeTrackGpsMetrics(pts);
    expect(m.pointCount).toBe(3);
    expect(m.totalDistanceMeters).toBeGreaterThan(200);
    expect(m.totalDistanceMeters).toBeLessThan(250);
    expect(m.transportDistanceMeters).toBeGreaterThan(100);
    expect(m.recordingDistanceMeters).toBeGreaterThan(100);
    expect(m.totalTimeMs).toBe(60_000);
    expect(m.transportTimeMs).toBe(30_000);
    expect(m.recordingTimeMs).toBe(30_000);
  });

  it('counts distinct recorded segments in order of appearance', () => {
    const pts: TrackGpsPoint[] = [
      makePoint({ lat: 0, lng: 0, timestamp: '2025-01-01T00:00:00Z', phase: 'transport' }),
      makePoint({
        lat: 0,
        lng: 0.001,
        timestamp: '2025-01-01T00:00:10Z',
        phase: 'recording',
        segmentId: 'A',
      }),
      makePoint({
        lat: 0,
        lng: 0.002,
        timestamp: '2025-01-01T00:00:20Z',
        phase: 'recording',
        segmentId: 'A',
      }),
      makePoint({
        lat: 0,
        lng: 0.003,
        timestamp: '2025-01-01T00:00:30Z',
        phase: 'recording',
        segmentId: 'B',
      }),
    ];
    const m = computeTrackGpsMetrics(pts);
    expect(m.recordedSegmentIds).toEqual(['A', 'B']);
    expect(m.distinctSegmentCount).toBe(2);
    expect(m.pointsBySegmentId).toEqual({ A: 2, B: 1 });
  });

  it('handles only-transport and only-recording tracks safely', () => {
    const onlyTransport: TrackGpsPoint[] = [
      makePoint({ lat: 0, lng: 0, timestamp: '2025-01-01T00:00:00Z', phase: 'transport' }),
      makePoint({ lat: 0, lng: 0.001, timestamp: '2025-01-01T00:00:30Z', phase: 'transport' }),
    ];
    const a = computeTrackGpsMetrics(onlyTransport);
    expect(a.recordingDistanceMeters).toBe(0);
    expect(a.distinctSegmentCount).toBe(0);

    const onlyRec: TrackGpsPoint[] = [
      makePoint({
        lat: 0,
        lng: 0,
        timestamp: '2025-01-01T00:00:00Z',
        phase: 'recording',
        segmentId: 'X',
      }),
      makePoint({
        lat: 0,
        lng: 0.001,
        timestamp: '2025-01-01T00:00:30Z',
        phase: 'recording',
        segmentId: 'X',
      }),
    ];
    const b = computeTrackGpsMetrics(onlyRec);
    expect(b.transportDistanceMeters).toBe(0);
    expect(b.recordingDistanceMeters).toBeGreaterThan(0);
    expect(b.distinctSegmentCount).toBe(1);
  });
});

describe('computeTrackGpsMilestones', () => {
  it('returns first/last and detects phase transitions', () => {
    const pts: TrackGpsPoint[] = [
      makePoint({ lat: 0, lng: 0, timestamp: '2025-01-01T00:00:00Z', phase: 'transport' }),
      makePoint({
        lat: 0,
        lng: 0.001,
        timestamp: '2025-01-01T00:00:10Z',
        phase: 'recording',
        segmentId: 'A',
      }),
      makePoint({
        lat: 0,
        lng: 0.002,
        timestamp: '2025-01-01T00:00:20Z',
        phase: 'transport',
      }),
    ];
    const ms = computeTrackGpsMilestones(pts);
    expect(ms.first?.timestamp).toBe('2025-01-01T00:00:00Z');
    expect(ms.last?.timestamp).toBe('2025-01-01T00:00:20Z');
    expect(ms.phaseTransitions.map((t) => `${t.from}->${t.to}`)).toEqual([
      'transport->recording',
      'recording->transport',
    ]);
    expect(ms.segmentBoundaries.map((b) => b.segmentId)).toEqual(['A']);
  });

  it('flags new boundary when segmentId changes (after intermediate transport)', () => {
    const pts: TrackGpsPoint[] = [
      makePoint({
        lat: 0,
        lng: 0,
        timestamp: '2025-01-01T00:00:00Z',
        phase: 'recording',
        segmentId: 'A',
      }),
      makePoint({ lat: 0, lng: 0.001, timestamp: '2025-01-01T00:00:10Z', phase: 'transport' }),
      makePoint({
        lat: 0,
        lng: 0.002,
        timestamp: '2025-01-01T00:00:20Z',
        phase: 'recording',
        segmentId: 'B',
      }),
    ];
    const ms = computeTrackGpsMilestones(pts);
    expect(ms.segmentBoundaries.map((b) => b.segmentId)).toEqual(['A', 'B']);
  });
});

describe('buildTrackGpsPolylines', () => {
  it('separates transport and recording polylines and computes bounds', () => {
    const pts: TrackGpsPoint[] = [
      makePoint({ lat: 40, lng: -3, timestamp: '2025-01-01T00:00:00Z', phase: 'transport' }),
      makePoint({ lat: 40.001, lng: -3, timestamp: '2025-01-01T00:00:10Z', phase: 'transport' }),
      makePoint({
        lat: 40.002,
        lng: -3,
        timestamp: '2025-01-01T00:00:20Z',
        phase: 'recording',
        segmentId: 'A',
      }),
      makePoint({
        lat: 40.003,
        lng: -3,
        timestamp: '2025-01-01T00:00:30Z',
        phase: 'recording',
        segmentId: 'A',
      }),
    ];
    const g = buildTrackGpsPolylines(pts);
    expect(g.transport.length).toBeGreaterThan(0);
    expect(g.recording.length).toBeGreaterThan(0);
    expect(g.bounds).not.toBeNull();
    if (g.bounds) {
      const [minLat, , maxLat] = g.bounds;
      expect(minLat).toBeCloseTo(40);
      expect(maxLat).toBeCloseTo(40.003);
    }
  });

  it('returns empty bounds for empty input', () => {
    expect(buildTrackGpsPolylines([])).toEqual({
      transport: [],
      recording: [],
      bounds: null,
    });
  });
});

describe('list helpers', () => {
  const logs: Record<number, Record<number, TrackGpsPoint[]>> = {
    2: {
      1: [makePoint({ lat: 0, lng: 0, timestamp: '2025-01-02T00:00:00Z', phase: 'transport' })],
    },
    1: {
      2: [makePoint({ lat: 0, lng: 0, timestamp: '2025-01-01T00:00:00Z', phase: 'transport' })],
      1: [makePoint({ lat: 0, lng: 0, timestamp: '2025-01-01T00:00:00Z', phase: 'transport' })],
    },
  };

  it('listAvailableDays returns sorted ascending days', () => {
    expect(listAvailableDays(logs)).toEqual([1, 2]);
    expect(listAvailableDays(undefined)).toEqual([]);
  });

  it('listAvailableTracks returns sorted (day,track) pairs', () => {
    expect(listAvailableTracks(logs)).toEqual([
      { day: 1, track: 1, pointCount: 1 },
      { day: 1, track: 2, pointCount: 1 },
      { day: 2, track: 1, pointCount: 1 },
    ]);
  });

  it('getTrackPoints handles missing entries safely', () => {
    expect(getTrackPoints(logs, 1, 1)).toHaveLength(1);
    expect(getTrackPoints(logs, 1, 99)).toEqual([]);
    expect(getTrackPoints(logs, 99, 1)).toEqual([]);
    expect(getTrackPoints(undefined, 1, 1)).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────
// Tests para nueva visualización rica de gabinete
// ───────────────────────────────────────────────────────────────────────

import {
  computeTrackGpsSegmentRows,
  filterIncidentsForTrack,
  getSegmentDisplayId,
  getSegmentDisplayName,
} from '@/utils/gabinete/track-gps-derived';
import type { Incident, Segment } from '@/types/route';

function mkSegment(partial: Partial<Segment> & { id: string }): Segment {
  return {
    id: partial.id,
    routeId: 'r1',
    trackNumber: null,
    plannedTrackNumber: null,
    trackHistory: [],
    kmlId: '',
    name: '',
    notes: '',
    coordinates: [],
    direction: 'creciente',
    type: 'tramo',
    status: 'pendiente',
    kmlMeta: {},
    ...partial,
  };
}

describe('getSegmentDisplayId / getSegmentDisplayName', () => {
  it('prioriza companySegmentId, luego name, luego kmlId, luego id', () => {
    expect(
      getSegmentDisplayId(
        mkSegment({ id: 'jsn339su', companySegmentId: 'BOA_00012', name: 'Calle X', kmlId: 'k1' }),
      ),
    ).toBe('BOA_00012');
    expect(
      getSegmentDisplayId(mkSegment({ id: 'jsn339su', name: 'Calle X', kmlId: 'k1' })),
    ).toBe('Calle X');
    expect(getSegmentDisplayId(mkSegment({ id: 'jsn339su', kmlId: 'k1' }))).toBe('k1');
    expect(getSegmentDisplayId(mkSegment({ id: 'jsn339su' }))).toBe('jsn339su');
  });

  it('displayName prioriza name pero nunca devuelve id si hay otra alternativa', () => {
    expect(
      getSegmentDisplayName(
        mkSegment({ id: 'jsn339su', companySegmentId: 'BOA_00012', name: 'Calle X' }),
      ),
    ).toBe('Calle X');
    expect(
      getSegmentDisplayName(mkSegment({ id: 'jsn339su', companySegmentId: 'BOA_00012' })),
    ).toBe('BOA_00012');
    expect(getSegmentDisplayName(mkSegment({ id: 'jsn339su', kmlId: 'k1' }))).toBe('k1');
    expect(getSegmentDisplayName(mkSegment({ id: 'jsn339su' }))).toBe('jsn339su');
  });
});

describe('computeTrackGpsSegmentRows', () => {
  const points: TrackGpsPoint[] = [
    makePoint({ lat: 40, lng: -3, timestamp: '2025-01-01T00:00:00Z', phase: 'transport' }),
    makePoint({
      lat: 40.001,
      lng: -3,
      timestamp: '2025-01-01T00:00:30Z',
      phase: 'recording',
      segmentId: 'A',
    }),
    makePoint({
      lat: 40.002,
      lng: -3,
      timestamp: '2025-01-01T00:01:00Z',
      phase: 'recording',
      segmentId: 'A',
    }),
    makePoint({
      lat: 40.003,
      lng: -3,
      timestamp: '2025-01-01T00:01:30Z',
      phase: 'recording',
      segmentId: 'B',
    }),
    makePoint({
      lat: 40.004,
      lng: -3,
      timestamp: '2025-01-01T00:02:00Z',
      phase: 'recording',
      segmentId: 'B',
    }),
  ];

  const segs: Segment[] = [
    mkSegment({ id: 'A', companySegmentId: 'BOA_00001', name: 'Tramo A' }),
    mkSegment({
      id: 'B',
      name: 'Tramo B',
      segmentStartSeconds: 30,
      segmentEndSeconds: 90,
    }),
  ];

  it('genera una fila por cada segmento grabado, en orden de aparición', () => {
    const rows = computeTrackGpsSegmentRows(points, segs);
    expect(rows.map((r) => r.segmentId)).toEqual(['A', 'B']);
    expect(rows[0].displayId).toBe('BOA_00001');
    expect(rows[1].displayId).toBe('Tramo B');
  });

  it('calcula segundos desde inicio del track y distancia acumulada', () => {
    const rows = computeTrackGpsSegmentRows(points, segs);
    expect(rows[0].secondsFromTrackStartToSegmentStart).toBe(30);
    expect(rows[0].secondsFromTrackStartToSegmentEnd).toBe(60);
    expect(rows[1].secondsFromTrackStartToSegmentStart).toBe(90);
    expect(rows[1].secondsFromTrackStartToSegmentEnd).toBe(120);
    expect(rows[0].trackDistanceAtStartMeters).toBeGreaterThan(0);
    expect(rows[0].trackDistanceAtEndMeters).toBeGreaterThan(
      rows[0].trackDistanceAtStartMeters!,
    );
  });

  it('expone segmentStart/EndSeconds (modo Garmin) cuando existen', () => {
    const rows = computeTrackGpsSegmentRows(points, segs);
    expect(rows[0].segmentStartSeconds).toBeNull();
    expect(rows[1].segmentStartSeconds).toBe(30);
    expect(rows[1].segmentEndSeconds).toBe(90);
  });

  it('marca segmentExists=false si el segmento del GPS ya no está en la campaña', () => {
    const rows = computeTrackGpsSegmentRows(points, [
      mkSegment({ id: 'A', companySegmentId: 'BOA_00001' }),
    ]);
    const a = rows.find((r) => r.segmentId === 'A')!;
    const b = rows.find((r) => r.segmentId === 'B')!;
    expect(a.segmentExists).toBe(true);
    expect(b.segmentExists).toBe(false);
    expect(b.displayId).toBe('B'); // fallback al id, no rompe
  });

  it('devuelve [] si no hay puntos', () => {
    expect(computeTrackGpsSegmentRows([], segs)).toEqual([]);
    expect(computeTrackGpsSegmentRows(undefined, segs)).toEqual([]);
  });
});

describe('filterIncidentsForTrack', () => {
  const base = {
    id: 'i1',
    segmentId: 'A',
    category: 'bache' as const,
    impact: 'informativa' as const,
    timestamp: '2025-01-01T00:00:00Z',
    location: { lat: 40, lng: -3 },
  };

  it('filtra por workDayAtIncident y trackAtIncident', () => {
    const incidents: Incident[] = [
      { ...base, id: 'i1', workDayAtIncident: 1, trackAtIncident: 1 },
      { ...base, id: 'i2', workDayAtIncident: 2, trackAtIncident: 1 },
      { ...base, id: 'i3', workDayAtIncident: 1, trackAtIncident: 2 },
    ];
    const out = filterIncidentsForTrack(incidents, 1, 1);
    expect(out.map((i) => i.id)).toEqual(['i1']);
  });

  it('descarta incidencias sin location (no pintables en el mapa)', () => {
    const incidents: Incident[] = [
      { ...base, id: 'no-loc', location: undefined, workDayAtIncident: 1, trackAtIncident: 1 },
    ];
    expect(filterIncidentsForTrack(incidents, 1, 1)).toEqual([]);
  });

  it('descarta incidencias sin workDayAtIncident ni trackAtIncident (no se puede confirmar pertenencia)', () => {
    const incidents: Incident[] = [{ ...base, id: 'orphan' }];
    expect(filterIncidentsForTrack(incidents, 1, 1)).toEqual([]);
  });

  it('acepta incidencias con solo trackAtIncident si coincide', () => {
    const incidents: Incident[] = [{ ...base, id: 'old', trackAtIncident: 1 }];
    expect(filterIncidentsForTrack(incidents, 1, 1).map((i) => i.id)).toEqual(['old']);
    expect(filterIncidentsForTrack(incidents, 1, 2)).toEqual([]);
  });

  it('devuelve [] con array vacío o nulo', () => {
    expect(filterIncidentsForTrack([], 1, 1)).toEqual([]);
    expect(filterIncidentsForTrack(undefined, 1, 1)).toEqual([]);
  });
});
