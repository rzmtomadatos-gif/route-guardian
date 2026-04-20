/**
 * Tests del Sub-bloque 2 — useSegmentCorrections (capa de hook + integración).
 *
 * Cubre los tres puntos críticos del plan aprobado:
 *  1. FIELD_LABELS cubre todos los CorrectableField (exhaustividad runtime).
 *  2. Atomicidad: dos applySegmentCorrection consecutivos en el mismo tick
 *     persisten ambas con la primera marcada `supersededBy` correctamente
 *     (demuestra que el cálculo vive dentro del updater).
 *  3. Orden commit→evento: logEvent se llama DESPUÉS del cambio efectivo
 *     en `state.segmentCorrections`, nunca dentro del updater.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Segment, SegmentCorrection, CorrectableField } from '@/types/route';
import {
  createSegmentCorrectionsApi,
  type SegmentCorrectionsDeps,
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
 */
function makeStore(initial: SegmentCorrection[] = []) {
  let corrections = initial;
  const deps = {
    state: {
      get segmentCorrections() {
        return corrections;
      },
    } as unknown as { segmentCorrections: SegmentCorrection[] },
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
  };
}

describe('FIELD_LABELS', () => {
  it('cubre todos los valores de CorrectableField (exhaustividad runtime)', () => {
    // Lista canónica de campos del modelo (debe sincronizarse con types/route.ts).
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
    // No hay claves extra que no pertenezcan a CorrectableField
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

    // Lanzar ambas en paralelo en el mismo tick (sin await entre ellas)
    const [c1, c2] = await Promise.all([
      api.applySegmentCorrection({
        segment: seg, field: 'workDay', newValue: 2, reason: 'a',
      }),
      api.applySegmentCorrection({
        segment: seg, field: 'workDay', newValue: 3, reason: 'b',
      }),
    ]);

    expect(store.current).toHaveLength(2);
    // La primera DEBE quedar marcada como superseded por la segunda
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
    // Snapshot del estado en el momento de logEvent → debe ver ya el commit
    logSpy = vi.fn((_type, _opts) => {
      // Capturar la longitud del array en el momento exacto de la emisión
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
    // El estado YA tiene la corrección cuando se invocó logEvent
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

    // Reset spy para aislar el revert
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
    // Cuando se emitió el evento, la corrección ya estaba inactiva
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
