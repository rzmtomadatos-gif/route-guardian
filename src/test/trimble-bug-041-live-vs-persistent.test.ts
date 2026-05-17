/**
 * BUG-041 — La cobertura GPS en vivo NO debe sobrescribir el color
 * persistente de un tramo ya capturado/procesado/no_capturable/descartado
 * en otra misión o pasada.
 *
 * El color base persistente (estado consolidado) tiene prioridad sobre la
 * capa transitoria de cobertura en vivo para esos estados terminales.
 * Para estados aún operativos (pendiente, en_captura, repetir) la capa
 * en vivo sí puede colorear el tramo durante la grabación.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveSegmentDisplayColor,
  TRIMBLE_STATUS_COLOR,
} from '@/utils/segment-colors';
import { TRIMBLE_LIVE_STATUS_COLOR } from '@/utils/trimble/live-coverage';
import type { Segment } from '@/types/route';
import type { TrimbleSegmentStatus } from '@/types/trimble';

function seg(id: string): Segment {
  return {
    id, routeId: 'r', trackNumber: null, plannedTrackNumber: null, trackHistory: [],
    kmlId: id, name: id, notes: '',
    coordinates: [{ lat: 40, lng: -3.7 }, { lat: 40.001, lng: -3.7 }],
    direction: 'creciente', type: 'tramo', status: 'pendiente', kmlMeta: {},
  } as Segment;
}

const PERSISTENT_TERMINAL: TrimbleSegmentStatus[] = [
  'capturado_pendiente_proceso',
  'procesado_ok',
  'procesado_con_observaciones',
  'no_capturable',
  'descartado_por_calidad',
];

const LIVE_OVERRIDE_OK: TrimbleSegmentStatus[] = [
  'pendiente',
  'en_captura',
  'repetir',
];

describe('BUG-041 — estados terminales bloquean live coverage', () => {
  for (const status of PERSISTENT_TERMINAL) {
    it(`status persistente "${status}" gana sobre live_covered`, () => {
      const color = resolveSegmentDisplayColor({
        seg: seg('A'),
        trimbleStatus: status,
        liveItem: { segmentId: 'A', status: 'live_covered',
          coverageRatio: 1, matchedPoints: 5, startProgress: 0, endProgress: 1 },
      });
      expect(color).toBe(TRIMBLE_STATUS_COLOR[status]);
    });
    it(`status persistente "${status}" gana sobre live_partial`, () => {
      const color = resolveSegmentDisplayColor({
        seg: seg('A'),
        trimbleStatus: status,
        liveItem: { segmentId: 'A', status: 'live_partial',
          coverageRatio: 0.3, matchedPoints: 3, startProgress: 0, endProgress: 0.3 },
      });
      expect(color).toBe(TRIMBLE_STATUS_COLOR[status]);
    });
  }
});

describe('BUG-041 — estados operativos permiten live coverage', () => {
  for (const status of LIVE_OVERRIDE_OK) {
    it(`status "${status}" deja pasar live_covered`, () => {
      const color = resolveSegmentDisplayColor({
        seg: seg('A'),
        trimbleStatus: status,
        liveItem: { segmentId: 'A', status: 'live_covered',
          coverageRatio: 1, matchedPoints: 5, startProgress: 0, endProgress: 1 },
      });
      expect(color).toBe(TRIMBLE_LIVE_STATUS_COLOR.live_covered);
    });
  }
});
