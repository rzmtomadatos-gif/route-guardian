import { describe, it, expect } from 'vitest';
import { getTrimbleEligibleSegmentIds, getTrimbleOrderIds } from '@/utils/trimble/map-page-selectors';
import type { Route, Segment } from '@/types/route';

function seg(id: string, layer?: string): Segment {
  return {
    id, routeId: 'r', trackNumber: null, plannedTrackNumber: null, trackHistory: [],
    kmlId: id, name: id, notes: '', coordinates: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }],
    direction: 'creciente', type: 'tramo', status: 'pendiente', kmlMeta: {}, layer,
  };
}

function route(segments: Segment[], optimizedOrder = segments.map((s) => s.id)): Route {
  return { id: 'r', name: 'r', loadedAt: '', fileName: '', segments, optimizedOrder };
}

describe('MapPage Trimble selectors', () => {
  it('no recorta la cola Trimble aunque una ventana visual/renderizada tenga 6 tramos', () => {
    const segments = Array.from({ length: 500 }, (_, i) => seg(`S${i}`));
    const renderedViewportWindow = segments.slice(0, 6);
    const r = route(segments);

    expect(renderedViewportWindow.length).toBe(6);
    expect(getTrimbleEligibleSegmentIds(r, new Set()).size).toBe(500);
    expect(getTrimbleOrderIds(r).length).toBe(500);
  });

  it('filtra sólo por capas ocultas y conserva todos los segmentos en orden', () => {
    const segments = [seg('A', 'ok'), seg('B', 'hidden'), seg('C', 'ok')];
    const r = route(segments, ['C', 'missing', 'A']);

    expect([...getTrimbleEligibleSegmentIds(r, new Set(['hidden']))]).toEqual(['A', 'C']);
    expect(getTrimbleOrderIds(r)).toEqual(['C', 'A', 'B']);
  });

  it('500 segmentos con optimizedOrder de sólo 6 → 500 IDs, primeros 6 respetan el orden', () => {
    const segments = Array.from({ length: 500 }, (_, i) => seg(`S${i}`));
    const partialOrder = ['S100', 'S50', 'S200', 'S0', 'S300', 'S10'];
    const r = route(segments, partialOrder);

    const ids = getTrimbleOrderIds(r);
    expect(ids.length).toBe(500);
    expect(ids.slice(0, 6)).toEqual(partialOrder);
    expect(new Set(ids).size).toBe(500);
  });
});