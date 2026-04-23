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
