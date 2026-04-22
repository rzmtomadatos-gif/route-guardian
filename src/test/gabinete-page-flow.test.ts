/**
 * Tests del Sub-bloque 3 — flujo de UI de gabinete (apply / revert)
 * verificado a nivel de API del hook + helpers de la página.
 *
 * No monta React: ejecuta la misma API que consumen los diálogos. Esto
 * cubre los criterios de aceptación funcionales sin dependencia visual.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Segment, SegmentCorrection, CorrectableField } from '@/types/route';
import { FIELDS_REQUIRING_REASON } from '@/types/route';
import {
  createSegmentCorrectionsApi,
  type SegmentCorrectionsDeps,
} from '@/hooks/useSegmentCorrections';
import { requiresReason } from '@/components/gabinete/CorrectionApplyDialog';
import { FIELD_INPUT_KIND } from '@/components/gabinete/field-types';
import { FIELD_LABELS } from '@/utils/gabinete/field-labels';

function makeSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: 'seg-A',
    routeId: 'route-1',
    trackNumber: 1,
    plannedTrackNumber: null,
    trackHistory: [1],
    kmlId: 'kml-A',
    name: 'Tramo Alpha',
    notes: '',
    coordinates: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }],
    direction: 'creciente',
    type: 'tramo',
    status: 'completado',
    kmlMeta: { carretera: 'M-501' },
    workDay: 1,
    ...overrides,
  };
}

function makeStore(initialSegments: Segment[] = [makeSegment()]) {
  let corrections: SegmentCorrection[] = [];
  let segments = initialSegments;
  return {
    deps: {
      state: {
        get segmentCorrections() { return corrections; },
        get segments() { return segments; },
      } as unknown as { segmentCorrections: SegmentCorrection[]; segments: Segment[] },
      setSegmentCorrections: (
        updater: (prev: SegmentCorrection[]) => SegmentCorrection[],
      ) => { corrections = updater(corrections); },
    },
    get corrections() { return corrections; },
    get segments() { return segments; },
  };
}

function makeApi(store: ReturnType<typeof makeStore>) {
  return createSegmentCorrectionsApi({
    ...store.deps,
    identity: { correctedBy: 'gab@test', correctedByRole: 'gabinete' },
    logEventFn: vi.fn().mockResolvedValue(undefined) as unknown as SegmentCorrectionsDeps['logEventFn'],
  });
}

describe('Sub-bloque 3 — requiresReason (UI helper)', () => {
  it('los 8 campos críticos exigen motivo', () => {
    const critical: CorrectableField[] = [
      'workDay', 'trackNumber', 'segmentOrder', 'status',
      'needsRepeat', 'nonRecordable', 'invalidatedByTrack', 'repeatNumber',
    ];
    for (const f of critical) {
      expect(requiresReason(f)).toBe(true);
      expect(FIELDS_REQUIRING_REASON.has(f)).toBe(true);
    }
  });

  it('los campos descriptivos NO exigen motivo', () => {
    const descriptive: CorrectableField[] = [
      'name', 'notes', 'kmlId', 'companySegmentId', 'direction', 'type',
      'kmlMeta.carretera', 'kmlMeta.identtramo', 'kmlMeta.tipo',
      'kmlMeta.calzada', 'kmlMeta.sentido', 'kmlMeta.pkInicial', 'kmlMeta.pkFinal',
    ];
    for (const f of descriptive) {
      expect(requiresReason(f)).toBe(false);
    }
  });
});

describe('Sub-bloque 3 — FIELD_INPUT_KIND exhaustivo', () => {
  it('todo CorrectableField tiene un kind asignado y coincide con FIELD_LABELS', () => {
    const labelKeys = Object.keys(FIELD_LABELS).sort();
    const kindKeys = Object.keys(FIELD_INPUT_KIND).sort();
    expect(kindKeys).toEqual(labelKeys);
    for (const k of kindKeys) {
      expect(FIELD_INPUT_KIND[k as CorrectableField]).toBeTruthy();
    }
  });
});

describe('Sub-bloque 3 — flujo apply desde UI', () => {
  it('apply campo crítico (workDay) con motivo: corrección creada, consolidado actualizado, base intacto', async () => {
    const seg = makeSegment({ workDay: 1 });
    const store = makeStore([seg]);
    const api = makeApi(store);

    const created = await api.applySegmentCorrection({
      segment: seg,
      field: 'workDay',
      newValue: 5,
      reason: 'reasignación de jornada',
    });

    expect(created.field).toBe('workDay');
    expect(created.previousValue).toBe(1);
    expect(created.newValue).toBe(5);
    expect(created.active).toBe(true);

    // Base intacto
    expect(store.segments[0].workDay).toBe(1);

    // Consolidado refleja el cambio
    const cons = api.getConsolidatedSegment(store.segments[0]);
    expect(cons.workDay).toBe(5);
  });

  it('apply campo descriptivo (name) sin motivo: corrección creada igualmente', async () => {
    const seg = makeSegment({ name: 'Original' });
    const store = makeStore([seg]);
    const api = makeApi(store);

    const created = await api.applySegmentCorrection({
      segment: seg,
      field: 'name',
      newValue: 'Renombrado',
      reason: '',
    });

    expect(created.field).toBe('name');
    expect(created.previousValue).toBe('Original');
    expect(created.newValue).toBe('Renombrado');
    expect(created.reason).toBe('');
    expect(api.getConsolidatedSegment(store.segments[0]).name).toBe('Renombrado');
    expect(store.segments[0].name).toBe('Original');
  });
});

describe('Sub-bloque 3 — flujo revert desde UI', () => {
  it('revertir corrección activa: active=false, revertedAt presente, consolidado vuelve al base', async () => {
    const seg = makeSegment({ workDay: 2 });
    const store = makeStore([seg]);
    const api = makeApi(store);

    const created = await api.applySegmentCorrection({
      segment: seg, field: 'workDay', newValue: 9, reason: 'corrección',
    });

    // Antes de revertir: consolidado = 9
    expect(api.getConsolidatedSegment(store.segments[0]).workDay).toBe(9);

    const reverted = await api.revertSegmentCorrection({
      correctionId: created.id,
      revertReason: 'reversión por error',
    });

    expect(reverted.id).toBe(created.id);
    expect(reverted.active).toBe(false);
    expect(reverted.revertedAt).toBeTruthy();
    expect(reverted.revertReason).toBe('reversión por error');

    // Consolidado vuelve al base
    expect(api.getConsolidatedSegment(store.segments[0]).workDay).toBe(2);
    // Base sigue intacto
    expect(store.segments[0].workDay).toBe(2);
  });

  it('revertir NO reactiva una corrección superseded anterior sobre el mismo campo', async () => {
    const seg = makeSegment({ workDay: 1 });
    const store = makeStore([seg]);
    const api = makeApi(store);

    const c1 = await api.applySegmentCorrection({
      segment: seg, field: 'workDay', newValue: 5, reason: 'a',
    });
    const c2 = await api.applySegmentCorrection({
      segment: seg, field: 'workDay', newValue: 7, reason: 'b',
    });

    // c1 quedó superseded por c2
    const c1After = store.corrections.find((c) => c.id === c1.id)!;
    expect(c1After.active).toBe(false);
    expect(c1After.supersededBy).toBe(c2.id);

    // Revertir c2
    await api.revertSegmentCorrection({
      correctionId: c2.id,
      revertReason: 'rollback',
    });

    // c1 sigue inactiva (no se reactiva), consolidado vuelve al base (1)
    const c1Final = store.corrections.find((c) => c.id === c1.id)!;
    expect(c1Final.active).toBe(false);
    expect(api.getConsolidatedSegment(store.segments[0]).workDay).toBe(1);
  });
});
