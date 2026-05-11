import { describe, it, expect } from 'vitest';
import { buildTrimbleLiveCoverage } from '@/utils/trimble/live-coverage';
import type { Segment, LatLng } from '@/types/route';
import type { TrimbleGpsPoint } from '@/types/trimble';

const LNG_PER_M = 1 / (111_320 * Math.cos((40 * Math.PI) / 180));
function makeSeg(id: string, lengthM = 100, lat = 40, lngStart = 0): Segment {
  const start: LatLng = { lat, lng: lngStart };
  const end: LatLng = { lat, lng: lngStart + lengthM * LNG_PER_M };
  return {
    id, routeId: 'r', trackNumber: null, plannedTrackNumber: null, trackHistory: [],
    kmlId: id, name: id, notes: '', coordinates: [start, end],
    direction: 'creciente', type: 'tramo', status: 'pendiente', kmlMeta: {},
  } as Segment;
}
function pt(lng: number, t: number, lat = 40): TrimbleGpsPoint {
  return {
    timestamp: new Date(2026, 0, 1, 10, 0, t).toISOString(),
    lat, lng, accuracy: 5, speed: null, heading: null,
    missionId: 'm', runId: 'r1', phase: 'capture', source: 'gps',
    recordingSessionId: 'rec1',
  };
}

describe('buildTrimbleLiveCoverage', () => {
  it('puntos sobre tramo completo → live_covered', () => {
    const seg = makeSeg('s1');
    const pts = Array.from({ length: 11 }, (_, i) => pt(i * 10 * LNG_PER_M, i));
    const m = buildTrimbleLiveCoverage(pts, [seg]);
    expect(m.get('s1')?.status).toBe('live_covered');
  });

  it('puntos sobre tramo parcial (0..0.5) → live_partial', () => {
    const seg = makeSeg('s1');
    const pts = Array.from({ length: 6 }, (_, i) => pt(i * 10 * LNG_PER_M, i));
    expect(buildTrimbleLiveCoverage(pts, [seg]).get('s1')?.status).toBe('live_partial');
  });

  it('currentSegmentId fuerza live_current', () => {
    const seg = makeSeg('s1');
    const m = buildTrimbleLiveCoverage([], [seg], { currentSegmentId: 's1' });
    expect(m.get('s1')?.status).toBe('live_current');
  });

  it('sin puntos y sin current → mapa vacío', () => {
    expect(buildTrimbleLiveCoverage([], [makeSeg('s1')]).size).toBe(0);
  });

  it('puntos lejos del eje (otra latitud) → no cuentan', () => {
    const seg = makeSeg('s1');
    const pts = Array.from({ length: 5 }, (_, i) => pt(i * 20 * LNG_PER_M, i, 40.01)); // ~1.1 km al norte
    const m = buildTrimbleLiveCoverage(pts, [seg]);
    expect(m.has('s1')).toBe(false);
  });
});
