/**
 * Tests del modelo de correcciones auditadas y reversibles (Sub-bloque 1).
 *
 * Cubre:
 *  - apply: campo simple, campo kmlMeta.*, motivo obligatorio, supersede.
 *  - revert: motivo obligatorio, idempotencia, NO reactivación de anterior.
 *  - getConsolidatedSegment: aplicación cronológica de correcciones activas.
 */

import { describe, it, expect } from 'vitest';
import type { Segment, SegmentCorrection } from '@/types/route';
import {
  applyCorrection,
  revertCorrection,
  getConsolidatedSegment,
  getActiveCorrections,
  isFieldCorrected,
} from '@/utils/gabinete/consolidate';

function makeSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: 'seg-1',
    routeId: 'route-1',
    trackNumber: 2,
    plannedTrackNumber: null,
    trackHistory: [2],
    kmlId: 'kml-1',
    name: 'Tramo de prueba',
    notes: '',
    coordinates: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }],
    direction: 'creciente',
    type: 'tramo',
    status: 'completado',
    kmlMeta: { carretera: 'M-501', identtramo: 'T-001' },
    workDay: 1,
    ...overrides,
  };
}

let counter = 0;
const fakeId = () => `corr-fake-${++counter}`;
const fixedNow = (iso: string) => () => new Date(iso);

describe('applyCorrection', () => {
  it('aplica una corrección sobre un campo descriptivo sin motivo obligatorio', () => {
    const segment = makeSegment();
    const r = applyCorrection([], {
      segment,
      field: 'name',
      newValue: 'Nuevo nombre',
      reason: '',
      correctedBy: 'gabinete@test',
      correctedByRole: 'gabinete',
      idGenerator: fakeId,
      now: fixedNow('2026-04-18T10:00:00Z'),
    });
    expect(r.created.active).toBe(true);
    expect(r.created.previousValue).toBe('Tramo de prueba');
    expect(r.created.newValue).toBe('Nuevo nombre');
    expect(r.corrections).toHaveLength(1);
  });

  it('exige motivo en campos críticos (trackNumber)', () => {
    const segment = makeSegment();
    expect(() =>
      applyCorrection([], {
        segment,
        field: 'trackNumber',
        newValue: 3,
        reason: '   ',
        correctedBy: 'gabinete@test',
        correctedByRole: 'gabinete',
      }),
    ).toThrow(/motivo obligatorio/i);
  });

  it('aplica corrección en path anidado kmlMeta.carretera', () => {
    const segment = makeSegment();
    const r = applyCorrection([], {
      segment,
      field: 'kmlMeta.carretera',
      newValue: 'M-502',
      reason: '',
      correctedBy: 'gabinete@test',
      correctedByRole: 'gabinete',
      idGenerator: fakeId,
    });
    const consolidated = getConsolidatedSegment(segment, r.corrections);
    expect(consolidated.kmlMeta.carretera).toBe('M-502');
    expect(consolidated.kmlMeta.identtramo).toBe('T-001'); // intacto
    expect(segment.kmlMeta.carretera).toBe('M-501'); // original no mutado
  });

  it('marca la corrección anterior como superseded al re-corregir el mismo campo', () => {
    const segment = makeSegment();
    const first = applyCorrection([], {
      segment,
      field: 'workDay',
      newValue: 2,
      reason: 'Día real era 2',
      correctedBy: 'gabinete@test',
      correctedByRole: 'gabinete',
      idGenerator: fakeId,
      now: fixedNow('2026-04-18T10:00:00Z'),
    });
    const second = applyCorrection(first.corrections, {
      segment,
      field: 'workDay',
      newValue: 3,
      reason: 'Re-corrección a día 3',
      correctedBy: 'gabinete@test',
      correctedByRole: 'gabinete',
      idGenerator: fakeId,
      now: fixedNow('2026-04-18T11:00:00Z'),
    });

    const oldCorr = second.corrections.find((c) => c.id === first.created.id)!;
    expect(oldCorr.active).toBe(false);
    expect(oldCorr.supersededBy).toBe(second.created.id);
    expect(second.created.active).toBe(true);
    expect(second.superseded).toHaveLength(1);

    // previousValue debe reflejar el consolidado anterior (=2), no el original (=1)
    expect(second.created.previousValue).toBe(2);
  });

  it('correcciones sobre campos distintos coexisten activas', () => {
    const segment = makeSegment();
    const r1 = applyCorrection([], {
      segment, field: 'workDay', newValue: 2, reason: 'x',
      correctedBy: 'g', correctedByRole: 'gabinete', idGenerator: fakeId,
    });
    const r2 = applyCorrection(r1.corrections, {
      segment, field: 'trackNumber', newValue: 5, reason: 'y',
      correctedBy: 'g', correctedByRole: 'gabinete', idGenerator: fakeId,
    });
    expect(getActiveCorrections(segment.id, r2.corrections)).toHaveLength(2);
  });
});

describe('getConsolidatedSegment', () => {
  it('aplica correcciones activas en orden cronológico', () => {
    const segment = makeSegment({ workDay: 1, trackNumber: 2 });
    const c1: SegmentCorrection = {
      id: 'c1', segmentId: 'seg-1', field: 'workDay',
      previousValue: 1, newValue: 2, reason: 'r', correctedBy: 'g',
      correctedByRole: 'gabinete', correctedAt: '2026-04-18T10:00:00Z', active: true,
    };
    const c2: SegmentCorrection = {
      id: 'c2', segmentId: 'seg-1', field: 'trackNumber',
      previousValue: 2, newValue: 5, reason: 'r', correctedBy: 'g',
      correctedByRole: 'gabinete', correctedAt: '2026-04-18T11:00:00Z', active: true,
    };
    const consolidated = getConsolidatedSegment(segment, [c1, c2]);
    expect(consolidated.workDay).toBe(2);
    expect(consolidated.trackNumber).toBe(5);
  });

  it('ignora correcciones inactivas', () => {
    const segment = makeSegment({ workDay: 1 });
    const c1: SegmentCorrection = {
      id: 'c1', segmentId: 'seg-1', field: 'workDay',
      previousValue: 1, newValue: 9, reason: 'r', correctedBy: 'g',
      correctedByRole: 'gabinete', correctedAt: '2026-04-18T10:00:00Z', active: false,
    };
    expect(getConsolidatedSegment(segment, [c1]).workDay).toBe(1);
  });

  it('no muta el segmento original', () => {
    const segment = makeSegment({ workDay: 1 });
    const c1: SegmentCorrection = {
      id: 'c1', segmentId: 'seg-1', field: 'workDay',
      previousValue: 1, newValue: 99, reason: 'r', correctedBy: 'g',
      correctedByRole: 'gabinete', correctedAt: '2026-04-18T10:00:00Z', active: true,
    };
    getConsolidatedSegment(segment, [c1]);
    expect(segment.workDay).toBe(1);
  });
});

describe('revertCorrection', () => {
  it('revierte una corrección activa marcándola inactiva con motivo', () => {
    const segment = makeSegment();
    const r = applyCorrection([], {
      segment, field: 'workDay', newValue: 2, reason: 'cambio',
      correctedBy: 'g', correctedByRole: 'gabinete', idGenerator: fakeId,
    });
    const rv = revertCorrection(r.corrections, {
      correctionId: r.created.id,
      revertReason: 'fue un error',
      revertedBy: 'gabinete@test',
      now: fixedNow('2026-04-18T12:00:00Z'),
    });
    expect(rv.reverted.active).toBe(false);
    expect(rv.reverted.revertReason).toBe('fue un error');
    expect(rv.reverted.revertedAt).toBe('2026-04-18T12:00:00.000Z');
    // consolidado vuelve al original
    expect(getConsolidatedSegment(segment, rv.corrections).workDay).toBe(1);
  });

  it('exige motivo de reversión', () => {
    const segment = makeSegment();
    const r = applyCorrection([], {
      segment, field: 'workDay', newValue: 2, reason: 'x',
      correctedBy: 'g', correctedByRole: 'gabinete', idGenerator: fakeId,
    });
    expect(() =>
      revertCorrection(r.corrections, {
        correctionId: r.created.id, revertReason: '   ', revertedBy: 'g',
      }),
    ).toThrow(/motivo/i);
  });

  it('no permite revertir una corrección ya inactiva', () => {
    const segment = makeSegment();
    const r = applyCorrection([], {
      segment, field: 'workDay', newValue: 2, reason: 'x',
      correctedBy: 'g', correctedByRole: 'gabinete', idGenerator: fakeId,
    });
    const rv = revertCorrection(r.corrections, {
      correctionId: r.created.id, revertReason: 'err', revertedBy: 'g',
    });
    expect(() =>
      revertCorrection(rv.corrections, {
        correctionId: r.created.id, revertReason: 'otra', revertedBy: 'g',
      }),
    ).toThrow(/inactiva/i);
  });

  it('al revertir la última corrección NO reactiva la anterior superseded', () => {
    const segment = makeSegment({ workDay: 1 });
    const r1 = applyCorrection([], {
      segment, field: 'workDay', newValue: 2, reason: 'a',
      correctedBy: 'g', correctedByRole: 'gabinete', idGenerator: fakeId,
      now: fixedNow('2026-04-18T10:00:00Z'),
    });
    const r2 = applyCorrection(r1.corrections, {
      segment, field: 'workDay', newValue: 3, reason: 'b',
      correctedBy: 'g', correctedByRole: 'gabinete', idGenerator: fakeId,
      now: fixedNow('2026-04-18T11:00:00Z'),
    });
    const rv = revertCorrection(r2.corrections, {
      correctionId: r2.created.id, revertReason: 'rollback', revertedBy: 'g',
    });
    // La primera corrección debe seguir inactiva (NO se reactiva).
    const first = rv.corrections.find((c) => c.id === r1.created.id)!;
    expect(first.active).toBe(false);
    // El consolidado vuelve al ORIGINAL (1), no al valor 2 de la primera corrección.
    expect(getConsolidatedSegment(segment, rv.corrections).workDay).toBe(1);
  });
});

describe('isFieldCorrected', () => {
  it('detecta solo correcciones activas', () => {
    const c1: SegmentCorrection = {
      id: 'c1', segmentId: 'seg-1', field: 'workDay',
      previousValue: 1, newValue: 2, reason: 'r', correctedBy: 'g',
      correctedByRole: 'gabinete', correctedAt: '2026-04-18T10:00:00Z', active: false,
    };
    const c2: SegmentCorrection = { ...c1, id: 'c2', active: true };
    expect(isFieldCorrected('seg-1', 'workDay', [c1])).toBe(false);
    expect(isFieldCorrected('seg-1', 'workDay', [c1, c2])).toBe(true);
    expect(isFieldCorrected('seg-1', 'trackNumber', [c2])).toBe(false);
  });
});
