import { describe, it, expect } from 'vitest';
import { analyzeTrimbleGpsCoverage } from '@/utils/trimble/gps-coverage';
import type { Segment, LatLng } from '@/types/route';
import type { TrimbleGpsPoint } from '@/types/trimble';

// Tramo este-oeste de ~100 m a 40º N. 1 grado de longitud ≈ 85.4 km a 40ºN,
// luego 100 m ≈ 0.001172 grados.
const LNG_PER_M = 1 / (111_320 * Math.cos((40 * Math.PI) / 180));
function makeSeg(id: string, lengthM = 100): Segment {
  const start: LatLng = { lat: 40, lng: 0 };
  const end: LatLng = { lat: 40, lng: lengthM * LNG_PER_M };
  return {
    id, routeId: 'r', trackNumber: null, plannedTrackNumber: null, trackHistory: [],
    kmlId: id, name: id, notes: '', coordinates: [start, end],
    direction: 'creciente', type: 'tramo', status: 'pendiente', kmlMeta: {},
  };
}

function pt(progress: number, t: number, lengthM = 100, accuracy: number | null = 5): TrimbleGpsPoint {
  return {
    timestamp: new Date(2026, 0, 1, 10, 0, t).toISOString(),
    lat: 40,
    lng: progress * lengthM * LNG_PER_M,
    accuracy, speed: null, heading: null,
    missionId: 'm', runId: 'r1', phase: 'capture', source: 'gps',
    recordingSessionId: 'rec1',
  };
}

describe('analyzeTrimbleGpsCoverage', () => {
  it('1) Tramo recto cubierto del 0 al 100 — capturado', () => {
    const seg = makeSeg('s1');
    const pts = Array.from({ length: 11 }, (_, i) => pt(i / 10, i));
    const r = analyzeTrimbleGpsCoverage(pts, [seg]);
    expect(r.captured).toHaveLength(1);
    expect(r.captured[0].coverageRatio).toBeGreaterThanOrEqual(0.7);
  });

  it('2) Sólo 0..0.6 — parcial missing_end', () => {
    const seg = makeSeg('s1');
    const pts = Array.from({ length: 7 }, (_, i) => pt(i / 10, i));
    const r = analyzeTrimbleGpsCoverage(pts, [seg]);
    expect(r.captured).toHaveLength(0);
    expect(r.partial[0].reason).toBe('missing_end');
  });

  it('3) Sólo 0.3..1.0 — parcial missing_start', () => {
    const seg = makeSeg('s1');
    const pts = Array.from({ length: 8 }, (_, i) => pt(0.3 + i * 0.1, i));
    const r = analyzeTrimbleGpsCoverage(pts, [seg]);
    expect(r.captured).toHaveLength(0);
    expect(r.partial[0].reason).toBe('missing_start');
  });

  it('4) Hueco interior grande 0..0.4 y 0.7..1 — gap_too_large', () => {
    const seg = makeSeg('s1', 200);
    const a = [0, 0.1, 0.2, 0.3, 0.4].map((p, i) => pt(p, i, 200));
    const b = [0.7, 0.8, 0.9, 1.0].map((p, i) => pt(p, 10 + i, 200));
    const r = analyzeTrimbleGpsCoverage([...a, ...b], [seg]);
    expect(r.captured).toHaveLength(0);
    expect(['gap_too_large', 'low_coverage']).toContain(r.partial[0].reason);
  });

  it('5) Recorrido inverso — reverse_direction', () => {
    const seg = makeSeg('s1');
    const pts = Array.from({ length: 11 }, (_, i) => pt(1 - i / 10, i));
    const r = analyzeTrimbleGpsCoverage(pts, [seg]);
    expect(r.captured).toHaveLength(0);
    expect(r.partial[0].reason).toBe('reverse_direction');
  });

  it('6) Puntos con accuracy > 25 m descartados', () => {
    const seg = makeSeg('s1');
    const pts = Array.from({ length: 11 }, (_, i) => pt(i / 10, i, 100, 50));
    const r = analyzeTrimbleGpsCoverage(pts, [seg]);
    expect(r.discardedByAccuracy).toBeGreaterThan(0);
    expect(r.captured).toHaveLength(0);
  });

  it('7) Geometría insuficiente — too_short', () => {
    const seg = makeSeg('s1', 5);
    const r = analyzeTrimbleGpsCoverage([pt(0, 0, 5), pt(1, 1, 5)], [seg]);
    expect(r.captured).toHaveLength(0);
    expect(r.partial[0].reason).toBe('too_short');
  });
});
