/**
 * Helper sendSingleSegment respeta:
 *  - geometría sin modificar (coordinates intactas)
 *  - override 'reversed' invierte INICIO/FIN
 *  - geometría < 2 puntos devuelve null
 */
import { describe, it, expect } from 'vitest';
import { buildSingleSegmentSendPayload } from '@/utils/trimble/single-segment-send';
import type { Segment } from '@/types/route';

const seg = (coords = [{ lat: 40, lng: -3 }, { lat: 41, lng: -4 }]): Segment => ({
  id: 's1',
  routeId: 'r1',
  trackNumber: null,
  plannedTrackNumber: null,
  trackHistory: [],
  kmlId: '',
  name: 'Seg 1',
  notes: '',
  coordinates: coords,
  direction: 'creciente',
  type: 'tramo',
  status: 'pendiente',
  kmlMeta: {},
});

describe('buildSingleSegmentSendPayload', () => {
  it('normal: INICIO=primer punto, FIN=último', () => {
    const p = buildSingleSegmentSendPayload(seg(), undefined)!;
    expect(p.reversed).toBe(false);
    expect(p.effectiveStart).toEqual({ lat: 40, lng: -3 });
    expect(p.effectiveEnd).toEqual({ lat: 41, lng: -4 });
    expect(p.items[0].name).toMatch(/^INICIO/);
    expect(p.items[1].name).toMatch(/^FIN/);
  });

  it('reversed: INICIO=último, FIN=primero (sin tocar geometría)', () => {
    const original = seg();
    const p = buildSingleSegmentSendPayload(original, 'reversed')!;
    expect(p.reversed).toBe(true);
    expect(p.effectiveStart).toEqual({ lat: 41, lng: -4 });
    expect(p.effectiveEnd).toEqual({ lat: 40, lng: -3 });
    // geometría no modificada
    expect(original.coordinates[0]).toEqual({ lat: 40, lng: -3 });
    expect(original.coordinates[1]).toEqual({ lat: 41, lng: -4 });
  });

  it('< 2 puntos devuelve null', () => {
    expect(buildSingleSegmentSendPayload(seg([{ lat: 40, lng: -3 }]), undefined)).toBeNull();
  });

  it('genera batchUrl válido con 2 paradas', () => {
    const p = buildSingleSegmentSendPayload(seg(), 'reversed')!;
    expect(p.batchUrl).toContain('google.com/maps');
  });
});
