import { describe, it, expect } from 'vitest';
import { buildTrimbleRecordingQueue } from '@/utils/trimble/recording-queue';
import { SEGMENTS_PER_BATCH } from '@/utils/google-maps-batch';
import type { AppState, Segment, LatLng } from '@/types/route';
import type { SegmentCapture } from '@/types/trimble';

function seg(id: string, coords: LatLng[] = [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }]): Segment {
  return {
    id, routeId: 'r', trackNumber: null, plannedTrackNumber: null, trackHistory: [],
    kmlId: id, name: id, notes: '', coordinates: coords, direction: 'creciente', type: 'tramo',
    status: 'pendiente', kmlMeta: {},
  };
}

function cap(segmentId: string, fieldStatus: SegmentCapture['fieldStatus'], qaStatus: SegmentCapture['qaStatus'] = null, endedAt: string | null = '2025-01-01T11:00:00Z'): SegmentCapture {
  return {
    id: `c-${segmentId}-${Math.random()}`, segmentId, runId: 'r1', missionId: 'm1',
    startedAt: '2025-01-01T10:00:00Z', endedAt, fieldStatus, qaStatus,
  };
}

function makeState(segments: Segment[], captures: SegmentCapture[] = [], activeRunId: string | null = null, optimizedOrder?: string[]): AppState {
  return {
    route: {
      id: 'r', name: 'r', loadedAt: '', fileName: '', segments,
      optimizedOrder: optimizedOrder ?? segments.map((s) => s.id),
    },
    incidents: [], activeSegmentId: null, navigationActive: false, currentPosition: null, base: null,
    rstMode: false, rstGroupSize: 9, trackSession: null,
    blockEndPrompt: { isOpen: false, trackNumber: null, reason: 'manual' },
    workDay: 1, acquisitionMode: 'TRIMBLE_LIDAR', lastConsumedTrackByDay: {},
    segmentCorrections: [], trackGpsLogsByDay: {},
    trimbleMissions: [], trimbleRuns: [], trimbleSegmentCaptures: captures,
    trimbleIncidents: [], trimbleDeliverables: [], trimbleGpsLogsByRun: {},
    activeMissionId: null, activeRunId,
  } as AppState;
}

describe('buildTrimbleRecordingQueue', () => {
  const all = ['A', 'B', 'C', 'D', 'E', 'F'];
  const visible = new Set(all);

  it('respeta el orderIds provisto', () => {
    const segs = all.map((id) => seg(id));
    const order = ['C', 'A', 'B'];
    const st = makeState(segs);
    const { items } = buildTrimbleRecordingQueue(st, visible, order);
    expect(items.map((i) => i.segment.id)).toEqual(['C', 'A', 'B']);
  });

  it('filtra por visibleSegmentIds', () => {
    const segs = all.map((id) => seg(id));
    const st = makeState(segs);
    const { items } = buildTrimbleRecordingQueue(st, new Set(['B', 'D']), all);
    expect(items.map((i) => i.segment.id)).toEqual(['B', 'D']);
  });

  it('incluye solo pendiente, en_captura y repetir; excluye terminales', () => {
    const segs = ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => seg(id));
    const captures: SegmentCapture[] = [
      cap('B', 'capturado_pendiente_proceso'),               // excluido
      cap('C', 'capturado_pendiente_proceso', 'procesado_ok'), // excluido
      cap('D', 'no_capturable'),                              // excluido
      cap('E', 'capturado_pendiente_proceso', 'procesado_con_observaciones'), // excluido
      cap('F', 'repetir'),                                    // incluido
    ];
    const st = makeState(segs, captures);
    const { items } = buildTrimbleRecordingQueue(st, visible, ['A', 'B', 'C', 'D', 'E', 'F'], 10);
    expect(items.map((i) => i.segment.id)).toEqual(['A', 'F']);
    expect(items.map((i) => i.status)).toEqual(['pendiente', 'repetir']);
  });

  it('start = primera coord, end = última coord', () => {
    const coords = [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }, { lat: 5, lng: 6 }];
    const segs = [seg('A', coords)];
    const { items } = buildTrimbleRecordingQueue(makeState(segs), new Set(['A']), ['A']);
    expect(items[0].start).toEqual({ lat: 1, lng: 2 });
    expect(items[0].end).toEqual({ lat: 5, lng: 6 });
  });

  it('por defecto NO aplica límite (cola operativa completa)', () => {
    const segs = Array.from({ length: 10 }, (_, i) => seg(`S${i}`));
    const ids = segs.map((s) => s.id);
    const { items } = buildTrimbleRecordingQueue(makeState(segs), new Set(ids), ids);
    expect(items.length).toBe(10);
  });

  it('respeta el limit explícito cuando se pasa (lote conductor)', () => {
    const segs = Array.from({ length: 10 }, (_, i) => seg(`S${i}`));
    const ids = segs.map((s) => s.id);
    const { items } = buildTrimbleRecordingQueue(makeState(segs), new Set(ids), ids, SEGMENTS_PER_BATCH);
    expect(items.length).toBe(SEGMENTS_PER_BATCH);
  });

  it('excluye tramos con coordinates.length < 2 y los lista en skippedNoGeometry', () => {
    const segs = [seg('A', [{ lat: 0, lng: 0 }]), seg('B'), seg('C', [])];
    const { items, skippedNoGeometry } = buildTrimbleRecordingQueue(
      makeState(segs), new Set(['A', 'B', 'C']), ['A', 'B', 'C'],
    );
    expect(items.map((i) => i.segment.id)).toEqual(['B']);
    expect(skippedNoGeometry).toEqual(['A', 'C']);
  });
});
