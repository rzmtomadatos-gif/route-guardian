/**
 * Tests del Sub-bloque 2 — useSegmentCorrections (capa de hook + integración).
 *
 * Cubre los puntos críticos del plan aprobado:
 *  1. FIELD_LABELS cubre todos los CorrectableField (exhaustividad runtime).
 *  2. Atomicidad: dos applySegmentCorrection consecutivos en el mismo tick
 *     persisten ambas con la primera marcada `supersededBy` correctamente
 *     (demuestra que el cálculo vive dentro del updater).
 *  3. Orden commit→evento: logEvent se llama DESPUÉS del cambio efectivo
 *     en `state.segmentCorrections`, nunca dentro del updater.
 *  4. La corrección NACE del segmento real del estado, NO de `req.segment`
 *     (que puede ser una foto vieja). Cubre campo crítico (workDay) y
 *     descriptivo (name).
 *  5. Error claro si el segmento no existe en estado.
 *  6. El log usa workDay/trackNumber consolidados post-commit.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Segment, SegmentCorrection, CorrectableField } from '@/types/route';
import {
  createSegmentCorrectionsApi,
  type SegmentCorrectionsDeps,
  type CommittedSnapshot,
} from '@/hooks/useSegmentCorrections';
import { FIELD_LABELS } from '@/utils/gabinete/field-labels';

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
    kmlMeta: { carretera: 'M-501' },
    workDay: 1,
    ...overrides,
  };
}

/**
 * Mini almacén de estado: simula `useRouteState` con un setter atómico
 * funcional (cálculo dentro del updater). Nunca copia la lectura fuera.
 *
 * `segments` es un array configurable que representa el estado real de
 * los tramos en la app (lo que `applySegmentCorrection` debe usar como
 * fuente de verdad para `previousValue`).
 */
function makeStore(
  initialCorrections: SegmentCorrection[] = [],
  initialSegments: Segment[] = [makeSegment()],
) {
  let corrections = initialCorrections;
  let segments = initialSegments;
  const deps = {
    state: {
      get segmentCorrections() {
        return corrections;
      },
      get segments() {
        return segments;
      },
    } as unknown as { segmentCorrections: SegmentCorrection[]; segments: Segment[] },
    setSegmentCorrections: (
      updater: (prev: SegmentCorrection[]) => SegmentCorrection[],
    ) => {
      corrections = updater(corrections);
    },
  };
  return {
    deps,
    get current() {
      return corrections;
    },
    setSegments(next: Segment[]) {
      segments = next;
    },
  };
}

describe('FIELD_LABELS', () => {
  it('cubre todos los valores de CorrectableField (exhaustividad runtime)', () => {
    const expected: CorrectableField[] = [
      'name', 'notes', 'kmlId', 'companySegmentId', 'direction', 'type',
      'kmlMeta.carretera', 'kmlMeta.identtramo', 'kmlMeta.tipo',
      'kmlMeta.calzada', 'kmlMeta.sentido', 'kmlMeta.pkInicial', 'kmlMeta.pkFinal',
      'workDay', 'trackNumber', 'segmentOrder', 'status',
      'needsRepeat', 'nonRecordable', 'invalidatedByTrack', 'repeatNumber',
    ];
    for (const field of expected) {
      expect(FIELD_LABELS[field]).toBeTruthy();
      expect(typeof FIELD_LABELS[field]).toBe('string');
    }
    expect(Object.keys(FIELD_LABELS).sort()).toEqual([...expected].sort());
  });
});

describe('useSegmentCorrections — gate de roles', () => {
  it('rechaza apply si el rol no es admin ni gabinete', async () => {
    const store = makeStore();
    const logFn = vi.fn().mockResolvedValue(undefined);
    const api = createSegmentCorrectionsApi({
      ...store.deps,
      identity: { correctedBy: 'op@test', correctedByRole: null },
      logEventFn: logFn as unknown as SegmentCorrectionsDeps['logEventFn'],
    });
    expect(api.canCorrect).toBe(false);
    await expect(
      api.applySegmentCorrection({
        segment: makeSegment(),
        field: 'name',
        newValue: 'X',
        reason: '',
      }),
    ).rejects.toThrow(/admin.*gabinete/i);
    expect(logFn).not.toHaveBeenCalled();
    expect(store.current).toHaveLength(0);
  });
});

describe('useSegmentCorrections — atomicidad real del setter', () => {
  it('dos applySegmentCorrection consecutivos en el mismo tick persisten ambas con supersede correcto', async () => {
    const store = makeStore();
    const api = createSegmentCorrectionsApi({
      ...store.deps,
      identity: { correctedBy: 'g@test', correctedByRole: 'gabinete' },
      logEventFn: vi.fn().mockResolvedValue(undefined),
    });
    const seg = makeSegment();

    const [c1, c2] = await Promise.all([
      api.applySegmentCorrection({
        segment: seg, field: 'workDay', newValue: 2, reason: 'a',
      }),
      api.applySegmentCorrection({
        segment: seg, field: 'workDay', newValue: 3, reason: 'b',
      }),
    ]);

    expect(store.current).toHaveLength(2);
    const first = store.current.find((c) => c.id === c1.id)!;
    const second = store.current.find((c) => c.id === c2.id)!;
    expect(first.active).toBe(false);
    expect(first.supersededBy).toBe(second.id);
    expect(second.active).toBe(true);
  });
});

describe('useSegmentCorrections — orden commit → evento', () => {
  let store: ReturnType<typeof makeStore>;
  let logSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = makeStore();
    logSpy = vi.fn((_type, _opts) => {
      (logSpy as unknown as { snapshotLen?: number }).snapshotLen =
        store.current.length;
      return Promise.resolve(undefined);
    });
  });

  it('apply: logEvent se llama DESPUÉS de que segmentCorrections refleja el cambio', async () => {
    const api = createSegmentCorrectionsApi({
      ...store.deps,
      identity: { correctedBy: 'g@test', correctedByRole: 'gabinete' },
      logEventFn: logSpy as unknown as SegmentCorrectionsDeps['logEventFn'],
    });

    expect(store.current).toHaveLength(0);
    await api.applySegmentCorrection({
      segment: makeSegment(), field: 'name', newValue: 'X', reason: '',
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toBe('SEGMENT_CORRECTION_APPLIED');
    expect((logSpy as unknown as { snapshotLen: number }).snapshotLen).toBe(1);
  });

  it('revert: logEvent se llama DESPUÉS de que la corrección quedó inactiva', async () => {
    const api = createSegmentCorrectionsApi({
      ...store.deps,
      identity: { correctedBy: 'g@test', correctedByRole: 'gabinete' },
      logEventFn: logSpy as unknown as SegmentCorrectionsDeps['logEventFn'],
    });
    const created = await api.applySegmentCorrection({
      segment: makeSegment(), field: 'workDay', newValue: 2, reason: 'x',
    });

    logSpy.mockClear();
    let snapshotActiveAtLog = -1;
    logSpy.mockImplementation((_type) => {
      snapshotActiveAtLog = store.current.find((c) => c.id === created.id)?.active
        ? 1
        : 0;
      return Promise.resolve(undefined);
    });

    await api.revertSegmentCorrection({
      correctionId: created.id,
      revertReason: 'rollback',
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toBe('SEGMENT_CORRECTION_REVERTED');
    expect(snapshotActiveAtLog).toBe(0);
  });
});

describe('useSegmentCorrections — payload completo', () => {
  it('apply emite payload con correctionId, field, valores, motivo y autor', async () => {
    const store = makeStore();
    const logSpy = vi.fn().mockResolvedValue(undefined);
    const api = createSegmentCorrectionsApi({
      ...store.deps,
      identity: { correctedBy: 'maria@gabinete', correctedByRole: 'gabinete' },
      logEventFn: logSpy as unknown as SegmentCorrectionsDeps['logEventFn'],
    });
    await api.applySegmentCorrection({
      segment: makeSegment(),
      field: 'trackNumber',
      newValue: 5,
      reason: 'desincronización con captura',
    });
    const [, opts] = logSpy.mock.calls[0];
    expect(opts.segmentId).toBe('seg-1');
    expect(opts.payload).toMatchObject({
      field: 'trackNumber',
      previousValue: 2,
      newValue: 5,
      reason: 'desincronización con captura',
      correctedBy: 'maria@gabinete',
      correctedByRole: 'gabinete',
    });
    expect(opts.payload.correctionId).toBeTruthy();
  });

  it('apply incluye supersededCorrectionId si re-corrige el mismo campo', async () => {
    const store = makeStore();
    const logSpy = vi.fn().mockResolvedValue(undefined);
    const api = createSegmentCorrectionsApi({
      ...store.deps,
      identity: { correctedBy: 'g', correctedByRole: 'gabinete' },
      logEventFn: logSpy as unknown as SegmentCorrectionsDeps['logEventFn'],
    });
    const seg = makeSegment();
    const first = await api.applySegmentCorrection({
      segment: seg, field: 'workDay', newValue: 2, reason: 'a',
    });
    await api.applySegmentCorrection({
      segment: seg, field: 'workDay', newValue: 3, reason: 'b',
    });
    const [, secondOpts] = logSpy.mock.calls[1];
    expect(secondOpts.payload.supersededCorrectionId).toBe(first.id);
  });
});

/**
 * Tests añadidos en la revisión final del Sub-bloque 2:
 * la corrección debe nacer del segmento real del estado, no de `req.segment`.
 */
describe('useSegmentCorrections — previousValue desde el ESTADO real', () => {
  it('apply (workDay): previousValue se calcula desde el segmento del estado, NO desde req.segment', async () => {
    // Estado real: workDay=10, trackNumber=7
    const segmentInState = makeSegment({
      id: 'seg-1', workDay: 10, trackNumber: 7, name: 'Tramo actualizado',
    });
    // req.segment es una foto VIEJA: workDay=1, trackNumber=2
    const staleReqSegment = makeSegment({
      id: 'seg-1', workDay: 1, trackNumber: 2, name: 'Tramo viejo',
    });

    const store = makeStore([], [segmentInState]);
    const logSpy = vi.fn().mockResolvedValue(undefined);

    const api = createSegmentCorrectionsApi({
      ...store.deps,
      identity: { correctedBy: 'g@x', correctedByRole: 'gabinete' },
      // afterCommit lee el estado actualizado (segmentInState sigue siendo el real)
      afterCommit: (cb) =>
        cb({
          segmentCorrections: store.current,
          segments: [segmentInState],
        } as CommittedSnapshot),
      logEventFn: logSpy as unknown as SegmentCorrectionsDeps['logEventFn'],
    });

    const created = await api.applySegmentCorrection({
      segment: staleReqSegment,            // ← foto vieja
      field: 'workDay',
      newValue: 20,
      reason: 'reasignación',
    });

    // previousValue = 10 (estado real), NO 1 (req.segment)
    expect(created.previousValue).toBe(10);
    expect(created.newValue).toBe(20);

    // El evento debe loguear el consolidado post-commit:
    // workDay=20 (corregido), trackNumber=7 (del estado real, NO 2 de req)
    expect(logSpy).toHaveBeenCalledWith(
      'SEGMENT_CORRECTION_APPLIED',
      expect.objectContaining({
        workDay: 20,
        trackNumber: 7,
        segmentId: 'seg-1',
      }),
    );
  });

  it('apply (name, campo descriptivo): previousValue se calcula desde el segmento del estado', async () => {
    const segmentInState = makeSegment({ id: 'seg-1', name: 'Real' });
    const staleReqSegment = makeSegment({ id: 'seg-1', name: 'Viejo' });

    const store = makeStore([], [segmentInState]);
    const logSpy = vi.fn().mockResolvedValue(undefined);

    const api = createSegmentCorrectionsApi({
      ...store.deps,
      identity: { correctedBy: 'g@x', correctedByRole: 'gabinete' },
      afterCommit: (cb) =>
        cb({
          segmentCorrections: store.current,
          segments: [segmentInState],
        } as CommittedSnapshot),
      logEventFn: logSpy as unknown as SegmentCorrectionsDeps['logEventFn'],
    });

    const created = await api.applySegmentCorrection({
      segment: staleReqSegment,
      field: 'name',
      newValue: 'Nuevo',
      reason: 'normalización',
    });

    expect(created.previousValue).toBe('Real');
    expect(created.newValue).toBe('Nuevo');
  });

  it('apply: lanza error claro si el segmento no existe en estado', async () => {
    const store = makeStore([], []); // estado vacío
    const api = createSegmentCorrectionsApi({
      ...store.deps,
      identity: { correctedBy: 'g@x', correctedByRole: 'gabinete' },
    });

    await expect(
      api.applySegmentCorrection({
        segment: makeSegment({ id: 'fantasma' }),
        field: 'name',
        newValue: 'X',
        reason: '',
      }),
    ).rejects.toThrow(/Segmento no encontrado en estado: fantasma/);
  });

  it('revert: el log emite workDay/trackNumber consolidados post-reversión desde committedSegments', async () => {
    const segmentInState = makeSegment({ id: 'seg-1', workDay: 10, trackNumber: 7 });
    const store = makeStore([], [segmentInState]);
    const logSpy = vi.fn().mockResolvedValue(undefined);

    const api = createSegmentCorrectionsApi({
      ...store.deps,
      identity: { correctedBy: 'g@x', correctedByRole: 'gabinete' },
      afterCommit: (cb) =>
        cb({
          segmentCorrections: store.current,
          segments: [segmentInState],
        } as CommittedSnapshot),
      logEventFn: logSpy as unknown as SegmentCorrectionsDeps['logEventFn'],
    });

    // Aplicar corrección workDay 10 → 20
    const created = await api.applySegmentCorrection({
      segment: segmentInState,
      field: 'workDay',
      newValue: 20,
      reason: 'reasignación',
    });

    logSpy.mockClear();

    // Revertir
    await api.revertSegmentCorrection({
      correctionId: created.id,
      revertReason: 'rollback',
    });

    // Tras revertir, el consolidado vuelve al base (workDay=10, trackNumber=7)
    expect(logSpy).toHaveBeenCalledWith(
      'SEGMENT_CORRECTION_REVERTED',
      expect.objectContaining({
        workDay: 10,
        trackNumber: 7,
        segmentId: 'seg-1',
      }),
    );
  });
});
