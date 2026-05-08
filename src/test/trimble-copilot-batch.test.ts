import { describe, it, expect } from 'vitest';
import { trimbleQueueToStops } from '@/utils/trimble/recording-queue';
import { buildGoogleMapsBatchUrl } from '@/utils/google-maps-batch';

const queue = [
  { start: { lat: 1, lng: 1 }, end: { lat: 2, lng: 2 } },
  { start: { lat: 3, lng: 3 }, end: { lat: 4, lng: 4 } },
  { start: { lat: 5, lng: 5 }, end: { lat: 6, lng: 6 } },
  { start: { lat: 7, lng: 7 }, end: { lat: 8, lng: 8 } },
];

describe('trimbleQueueToStops + buildGoogleMapsBatchUrl', () => {
  it('4 tramos → 8 paradas en orden start, end, start, end…', () => {
    const stops = trimbleQueueToStops(queue);
    expect(stops.length).toBe(8);
    expect(stops[0]).toEqual({ lat: 1, lng: 1 });
    expect(stops[1]).toEqual({ lat: 2, lng: 2 });
    expect(stops[6]).toEqual({ lat: 7, lng: 7 });
    expect(stops[7]).toEqual({ lat: 8, lng: 8 });
  });

  it('batch_url: destination = end del último tramo, waypoints conservan el orden previo', () => {
    const stops = trimbleQueueToStops(queue);
    const url = buildGoogleMapsBatchUrl(stops);
    expect(url).toContain('destination=8,8');
    expect(url).toContain('waypoints=1,1|2,2|3,3|4,4|5,5|6,6|7,7');
  });

  it('items copiloto con etiquetas INICIO/FIN comparten segmentId por pares', () => {
    // Simula la construcción del payload tal y como la usará MapPage.
    const segs = [
      { id: 'A', name: 'Tramo A', start: queue[0].start, end: queue[0].end },
      { id: 'B', name: 'Tramo B', start: queue[1].start, end: queue[1].end },
      { id: 'C', name: 'Tramo C', start: queue[2].start, end: queue[2].end },
      { id: 'D', name: 'Tramo D', start: queue[3].start, end: queue[3].end },
    ];
    const items = segs.flatMap((s) => [
      { segmentId: s.id, name: `INICIO · ${s.name}`, lat: s.start.lat, lng: s.start.lng },
      { segmentId: s.id, name: `FIN · ${s.name}`, lat: s.end.lat, lng: s.end.lng },
    ]);
    expect(items.length).toBe(8);
    expect(items[0].name.startsWith('INICIO · ')).toBe(true);
    expect(items[1].name.startsWith('FIN · ')).toBe(true);
    expect(items[0].segmentId).toBe(items[1].segmentId);
    expect(items[2].segmentId).toBe(items[3].segmentId);
    expect(items[0].segmentId).not.toBe(items[2].segmentId);
  });
});
