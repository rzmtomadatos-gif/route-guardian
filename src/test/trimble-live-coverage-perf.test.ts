/**
 * Rendimiento: buildTrimbleLiveCoverage debe escalar a campañas reales.
 * Umbral conservador para que el test no parpadee en CI: 500ms para
 * 2000 tramos × 2000 puntos GPS. En máquinas normales tarda <150ms.
 *
 * Si esto se rompe, hay que revisar la pasada O(N·M) sobre projectPointToPolyline
 * y pensar en bucketización por bbox / spatial index, no relajar el umbral.
 */
import { describe, it, expect } from 'vitest';
import type { Segment } from '@/types/route';
import type { TrimbleGpsPoint } from '@/types/trimble';
import { buildTrimbleLiveCoverage } from '@/utils/trimble/live-coverage';

function makeSegments(n: number): Segment[] {
  const segs: Segment[] = [];
  for (let i = 0; i < n; i++) {
    const lat = 40 + (i % 100) * 0.001;
    const lng = -3.7 + Math.floor(i / 100) * 0.001;
    segs.push({
      id: `S${i}`, routeId: 'r', trackNumber: null, plannedTrackNumber: null, trackHistory: [],
      kmlId: `S${i}`, name: `S${i}`, notes: '',
      coordinates: [{ lat, lng }, { lat: lat + 0.0008, lng }],
      direction: 'creciente', type: 'tramo', status: 'pendiente', kmlMeta: {},
    } as Segment);
  }
  return segs;
}

function makePoints(n: number): TrimbleGpsPoint[] {
  const pts: TrimbleGpsPoint[] = [];
  for (let i = 0; i < n; i++) {
    pts.push({
      timestamp: new Date(Date.UTC(2026, 0, 1, 10, 0, i)).toISOString(),
      lat: 40 + ((i % 100) + 0.4) * 0.001,
      lng: -3.7 + Math.floor(i / 100) * 0.001,
      missionId: 'm', runId: 'r', phase: 'capture', source: 'gps',
      recordingSessionId: 'rec-1',
    });
  }
  return pts;
}

describe('buildTrimbleLiveCoverage — performance', () => {
  it('procesa 2000 tramos × 2000 puntos en menos de 500ms', () => {
    const segs = makeSegments(2000);
    const pts = makePoints(2000);

    const t0 = performance.now();
    const map = buildTrimbleLiveCoverage(pts, segs);
    const elapsed = performance.now() - t0;

    expect(map.size).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(500);
    // eslint-disable-next-line no-console
    console.info('[perf live-coverage]', { segs: 2000, pts: 2000, ms: Math.round(elapsed) });
  });
});
