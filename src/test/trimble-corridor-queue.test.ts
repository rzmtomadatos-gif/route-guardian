/**
 * Reglas de corredor en la cola Trimble:
 *  - Una vez iniciado un corredor compuesto, todas sus partes accionables
 *    se completan antes de pasar a otro corredor (aunque optimizedOrder
 *    las intercale con otras calles).
 *  - Una incidencia (no_capturable / procesado) en una parte saca esa
 *    parte concreta de la cola pero NO rompe el corredor.
 *  - El estado `repetir` mantiene la parte en la cola del corredor.
 */
import { describe, it, expect } from 'vitest';
import { buildTrimbleRecordingQueue } from '@/utils/trimble/recording-queue';
import { getTrimbleCorridorKey, getTrimbleCorridorPart } from '@/utils/trimble/corridor';
import type { AppState, Segment, LatLng } from '@/types/route';
import type { SegmentCapture } from '@/types/trimble';

function seg(id: string, name: string, coords: LatLng[] = [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }]): Segment {
  return {
    id, routeId: 'r', trackNumber: null, plannedTrackNumber: null, trackHistory: [],
    kmlId: id, name, notes: '', coordinates: coords, direction: 'creciente', type: 'tramo',
    status: 'pendiente', kmlMeta: {},
  };
}

function cap(segmentId: string, fieldStatus: SegmentCapture['fieldStatus'], qaStatus: SegmentCapture['qaStatus'] = null, endedAt: string | null = '2025-01-01T11:00:00Z'): SegmentCapture {
  return {
    id: `c-${segmentId}-${Math.random()}`, segmentId, runId: 'r1', missionId: 'm1',
    startedAt: '2025-01-01T10:00:00Z', endedAt, fieldStatus, qaStatus,
  };
}

function makeState(segments: Segment[], captures: SegmentCapture[] = [], optimizedOrder?: string[]): AppState {
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
    activeMissionId: null, activeRunId: 'r1',
  } as AppState;
}

describe('getTrimbleCorridorKey', () => {
  it('detecta patrón "X/Y" en el nombre', () => {
    expect(getTrimbleCorridorKey(seg('a', 'AVDA ESPAÑA 1/8'))).toBe(getTrimbleCorridorKey(seg('b', 'AVDA ESPAÑA 8/8')));
    expect(getTrimbleCorridorKey(seg('a', 'AVDA ESPAÑA 1/8'))).toContain('AVDA ESPAÑA');
  });

  it('separa corredores distintos', () => {
    expect(getTrimbleCorridorKey(seg('a', 'AVDA ESPAÑA 1/8'))).not.toBe(
      getTrimbleCorridorKey(seg('b', 'CALLE MAYOR 1/2')),
    );
  });

  it('fallback a id si no hay patrón compuesto', () => {
    expect(getTrimbleCorridorKey(seg('xyz', 'C/ Sola'))).toBe('ID:xyz');
  });

  it('extrae parte numérica', () => {
    expect(getTrimbleCorridorPart(seg('a', 'AVDA ESPAÑA 3/8'))).toBe(3);
    expect(getTrimbleCorridorPart(seg('a', 'C/ Sola'))).toBe(null);
  });
});

describe('cola Trimble — regla de corredor', () => {
  const visible = new Set(['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'C1']);

  it('Caso 1: corredor intercalado en optimizedOrder se completa primero', () => {
    const segs = [
      seg('A1', 'AVDA ESPAÑA 1/4'),
      seg('B1', 'CALLE MAYOR 1/2'),
      seg('A2', 'AVDA ESPAÑA 2/4'),
      seg('C1', 'CALLE REAL 1/1'),
      seg('A3', 'AVDA ESPAÑA 3/4'),
      seg('A4', 'AVDA ESPAÑA 4/4'),
    ];
    const order = ['A1', 'B1', 'A2', 'C1', 'A3', 'A4'];
    const { items } = buildTrimbleRecordingQueue(makeState(segs, [], order), visible, order);
    expect(items.map((i) => i.segment.id)).toEqual(['A1', 'A2', 'A3', 'A4', 'B1', 'C1']);
  });

  it('Caso 2: incidencia (no_capturable) intermedia no rompe el corredor', () => {
    const segs = [
      seg('A1', 'AVDA ESPAÑA 1/4'),
      seg('A2', 'AVDA ESPAÑA 2/4'),
      seg('A3', 'AVDA ESPAÑA 3/4'),
      seg('A4', 'AVDA ESPAÑA 4/4'),
      seg('B1', 'CALLE MAYOR 1/2'),
    ];
    const captures = [
      cap('A1', 'capturado_pendiente_proceso'),  // fuera de cola
      cap('A2', 'no_capturable'),                 // fuera de cola
    ];
    const order = segs.map((s) => s.id);
    const { items } = buildTrimbleRecordingQueue(makeState(segs, captures, order), new Set(order), order);
    expect(items.map((i) => i.segment.id)).toEqual(['A3', 'A4', 'B1']);
  });

  it('Caso 3: estado repetir permanece en el corredor', () => {
    const segs = [
      seg('A1', 'AVDA ESPAÑA 1/4'),
      seg('A2', 'AVDA ESPAÑA 2/4'),
      seg('B1', 'CALLE MAYOR 1/2'),
    ];
    const captures = [cap('A1', 'repetir')];
    const order = segs.map((s) => s.id);
    const { items } = buildTrimbleRecordingQueue(makeState(segs, captures, order), new Set(order), order);
    expect(items.map((i) => i.segment.id)).toEqual(['A1', 'A2', 'B1']);
  });

  it('Caso 4: corredor terminado pasa al siguiente de optimizedOrder', () => {
    const segs = [
      seg('A1', 'AVDA ESPAÑA 1/2'),
      seg('A2', 'AVDA ESPAÑA 2/2'),
      seg('B1', 'CALLE MAYOR 1/1'),
    ];
    const captures = [cap('A1', 'capturado_pendiente_proceso'), cap('A2', 'no_capturable')];
    const order = segs.map((s) => s.id);
    const { items } = buildTrimbleRecordingQueue(makeState(segs, captures, order), new Set(order), order);
    expect(items.map((i) => i.segment.id)).toEqual(['B1']);
  });

  it('Caso 5: campaña grande — cola completa, sin viewport, sin límite', () => {
    const segs = Array.from({ length: 500 }, (_, i) => seg(`S${i}`, `Tramo ${i}`));
    const ids = segs.map((s) => s.id);
    const { items } = buildTrimbleRecordingQueue(makeState(segs, [], ids), new Set(ids), ids);
    expect(items.length).toBe(500);
  });

  it('Caso 5b: lote conductor sigue acotado a 4 cuando se pasa el límite', () => {
    const segs = Array.from({ length: 500 }, (_, i) => seg(`S${i}`, `Tramo ${i}`));
    const ids = segs.map((s) => s.id);
    const { items } = buildTrimbleRecordingQueue(makeState(segs, [], ids), new Set(ids), ids, 4);
    expect(items.length).toBe(4);
  });

  it('Caso 6: ordena por número de parte aunque vengan desordenadas', () => {
    const segs = [
      seg('A3', 'AVDA ESPAÑA 3/4'),
      seg('A1', 'AVDA ESPAÑA 1/4'),
      seg('A4', 'AVDA ESPAÑA 4/4'),
      seg('A2', 'AVDA ESPAÑA 2/4'),
    ];
    const order = ['A3', 'A1', 'A4', 'A2'];
    const { items } = buildTrimbleRecordingQueue(makeState(segs, [], order), new Set(order), order);
    expect(items.map((i) => i.segment.id)).toEqual(['A1', 'A2', 'A3', 'A4']);
  });
});
