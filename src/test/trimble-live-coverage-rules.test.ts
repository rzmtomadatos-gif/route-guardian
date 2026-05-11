/**
 * Reglas duras de buildTrimbleLiveCoverage alineadas con analyzeTrimbleGpsCoverage:
 *  - mínimo de matches (>=3) para live_covered
 *  - puntos con accuracy > 25 m no cuentan
 *  - recorrido inverso queda live_partial
 *  - hueco interior > 30 % queda live_partial
 *  - tramo completo monótono start→end con coverage>=70 % queda live_covered
 *  - status nunca se sobreescribe por isCurrent (color = cobertura)
 */
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
function pt(lng: number, t: number, accuracy: number | null = 5, lat = 40): TrimbleGpsPoint {
  return {
    timestamp: new Date(2026, 0, 1, 10, 0, t).toISOString(),
    lat, lng, accuracy: accuracy ?? null, speed: null, heading: null,
    missionId: 'm', runId: 'r1', phase: 'capture', source: 'gps',
    recordingSessionId: 'rec1',
  };
}

describe('buildTrimbleLiveCoverage — reglas duras alineadas con cierre', () => {
  it('< 3 puntos válidos no llega a live_covered', () => {
    const seg = makeSeg('s1');
    // Solo 2 puntos cubriendo extremos: aunque coverageRatio sea alto, sin mínimo de matches → partial.
    const pts = [pt(0, 0), pt(100 * LNG_PER_M, 1)];
    const m = buildTrimbleLiveCoverage(pts, [seg]);
    expect(m.get('s1')?.status).toBe('live_partial');
  });

  it('puntos con accuracy > 25 m no cuentan', () => {
    const seg = makeSeg('s1');
    const pts = Array.from({ length: 11 }, (_, i) => pt(i * 10 * LNG_PER_M, i, 50));
    const m = buildTrimbleLiveCoverage(pts, [seg]);
    expect(m.has('s1')).toBe(false); // todos descartados
  });

  it('recorrido inverso (timestamps crecientes pero progress decreciente) → live_partial', () => {
    const seg = makeSeg('s1');
    // Pasamos por el tramo de fin a inicio en orden temporal.
    const pts = Array.from({ length: 11 }, (_, i) => pt((10 - i) * 10 * LNG_PER_M, i));
    const m = buildTrimbleLiveCoverage(pts, [seg]);
    expect(m.get('s1')?.status).toBe('live_partial');
  });

  it('hueco interior > 30 % deja live_partial', () => {
    const seg = makeSeg('s1', 200);
    // Cubre 0..0.15 y 0.85..1, hueco interior ~0.7
    const pts = [
      pt(0, 0), pt(10 * LNG_PER_M, 1), pt(20 * LNG_PER_M, 2),
      pt(180 * LNG_PER_M, 10), pt(190 * LNG_PER_M, 11), pt(200 * LNG_PER_M, 12),
    ];
    const m = buildTrimbleLiveCoverage(pts, [seg]);
    expect(m.get('s1')?.status).toBe('live_partial');
  });

  it('tramo completo monótono → live_covered', () => {
    const seg = makeSeg('s1');
    const pts = Array.from({ length: 11 }, (_, i) => pt(i * 10 * LNG_PER_M, i));
    expect(buildTrimbleLiveCoverage(pts, [seg]).get('s1')?.status).toBe('live_covered');
  });

  it('isCurrent NO sobreescribe el color: status sigue siendo live_covered', () => {
    const seg = makeSeg('s1');
    const pts = Array.from({ length: 11 }, (_, i) => pt(i * 10 * LNG_PER_M, i));
    const m = buildTrimbleLiveCoverage(pts, [seg], { currentSegmentId: 's1' });
    const item = m.get('s1');
    expect(item?.status).toBe('live_covered');
    expect(item?.isCurrent).toBe(true);
  });
});

describe('buildTrimbleLiveCoverage — currentMaxDistanceMeters', () => {
  it('si último match excede currentMaxDistanceMeters, no marca isCurrent', () => {
    const seg = makeSeg('s1', 200);
    // Puntos relativamente lejos del eje (~20 m al norte) pero dentro de maxDistanceMeters=25.
    const offsetLat = 40 + 20 / 111_320;
    const pts = Array.from({ length: 5 }, (_, i) => pt(i * 40 * LNG_PER_M, i, 5, offsetLat));
    const m = buildTrimbleLiveCoverage(pts, [seg], {
      currentSegmentId: 's1',
      currentMaxDistanceMeters: 5, // exigente
    });
    expect(m.get('s1')?.isCurrent).toBeFalsy();
  });

  it('si último match está cerca, marca isCurrent', () => {
    const seg = makeSeg('s1', 200);
    const pts = Array.from({ length: 5 }, (_, i) => pt(i * 40 * LNG_PER_M, i, 5));
    const m = buildTrimbleLiveCoverage(pts, [seg], {
      currentSegmentId: 's1',
      currentMaxDistanceMeters: 25,
    });
    expect(m.get('s1')?.isCurrent).toBe(true);
  });
});
