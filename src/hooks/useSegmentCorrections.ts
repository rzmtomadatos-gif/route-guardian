/**
 * Hook de gabinete: aplica/revierte correcciones auditadas y reversibles
 * sobre los tramos, conectando el engine puro (`utils/gabinete/consolidate`)
 * con el estado real (`useRouteState`) y el event-log persistente.
 *
 * Reglas críticas (ver plan Sub-bloque 2):
 *  1. El dato de campo en `Segment` NO se muta. La consolidación se deriva
 *     en lectura desde `state.segmentCorrections`.
 *  2. La corrección NACE del segmento real del estado (`deps.state.segments`),
 *     no de `req.segment` (que puede ser una foto vieja). Esto garantiza que
 *     `created.previousValue` siempre se calcula contra el estado actual.
 *  3. El cálculo (engine puro) ocurre DENTRO del updater de
 *     `setSegmentCorrections` para garantizar atomicidad real frente a
 *     llamadas concurrentes en el mismo tick.
 *  4. Los eventos `SEGMENT_CORRECTION_APPLIED` / `_REVERTED` se emiten
 *     SOLO después del commit confirmado vía `afterCommit`, leyendo el
 *     `committedSegments` real para calcular `workDay` / `trackNumber`
 *     consolidados (no del `req.segment` de entrada).
 *  5. Solo roles `admin` y `gabinete` pueden aplicar/revertir.
 *
 * NOTA sobre coexistencia:
 *  - `updateSegment` (en useRouteState) es la vía de campo: muta el Segment
 *    directamente y NO debe usarse desde gabinete.
 *  - `applySegmentCorrection` (este hook) es la vía de gabinete: append-only
 *    sobre `segmentCorrections`, no toca el Segment original.
 *  Ambas escriben colecciones distintas; coexisten sin colisión.
 */

import { useRouteStateContext } from '@/context/RouteStateContext';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { logEvent } from '@/utils/persistence';
import {
  applyCorrection as engineApplyCorrection,
  revertCorrection as engineRevertCorrection,
  getActiveCorrections as engineGetActiveCorrections,
  getConsolidatedSegment as engineGetConsolidatedSegment,
  isFieldCorrected as engineIsFieldCorrected,
  type ApplyCorrectionResult,
  type RevertCorrectionResult,
} from '@/utils/gabinete/consolidate';
import type {
  Segment,
  SegmentCorrection,
  CorrectableField,
  AppState,
} from '@/types/route';

export interface ApplyCorrectionRequest {
  segment: Segment;
  field: CorrectableField;
  newValue: unknown;
  reason: string;
}

export interface RevertCorrectionRequest {
  correctionId: string;
  revertReason: string;
}

interface UseSegmentCorrectionsApi {
  applySegmentCorrection: (req: ApplyCorrectionRequest) => Promise<SegmentCorrection>;
  revertSegmentCorrection: (req: RevertCorrectionRequest) => Promise<SegmentCorrection>;
  getSegmentCorrections: (segmentId: string) => SegmentCorrection[];
  getActiveCorrections: (segmentId: string) => SegmentCorrection[];
  getConsolidatedSegment: (segment: Segment) => Segment;
  isFieldCorrected: (segmentId: string, field: CorrectableField) => boolean;
  /** True si el rol actual puede aplicar/revertir correcciones. */
  canCorrect: boolean;
}

/** Snapshot mínimo de estado expuesto al callback `afterCommit`. */
export interface CommittedSnapshot {
  segmentCorrections: SegmentCorrection[];
  segments: Segment[];
}

/**
 * Inyectable: por defecto consume el hook real de estado.
 * Tests pueden pasar un mock con la misma forma para verificar atomicidad
 * y orden commit→evento sin montar React.
 */
export interface SegmentCorrectionsDeps {
  state: {
    segmentCorrections: SegmentCorrection[];
    segments: Segment[];
  };
  setSegmentCorrections: (
    updater: (prev: SegmentCorrection[]) => SegmentCorrection[],
  ) => void;
  identity: {
    correctedBy: string;
    correctedByRole: 'gabinete' | 'admin' | null;
  };
  /**
   * Promete ejecutar `cb` con el estado ya comprometido tras el último
   * setState pendiente. Si se omite (modo test con setter síncrono), el
   * hook resuelve inmediatamente con la lectura sincrónica de `state`.
   */
  afterCommit?: (cb: (s: CommittedSnapshot) => void) => void;
  logEventFn?: typeof logEvent;
}

/**
 * Implementación pura del hook, parametrizada con dependencias.
 * Permite testar el orden commit→evento sin montar React/Auth/Supabase.
 */
export function createSegmentCorrectionsApi(
  deps: SegmentCorrectionsDeps,
): UseSegmentCorrectionsApi {
  const log = deps.logEventFn ?? logEvent;
  const canCorrect =
    deps.identity.correctedByRole === 'admin' ||
    deps.identity.correctedByRole === 'gabinete';

  /**
   * Resuelve el snapshot post-commit. Si `afterCommit` no está disponible
   * (tests con setter síncrono), devuelve la lectura inmediata del estado
   * actualizado (que ya es consistente porque el setter de test mutó en
   * el mismo tick).
   */
  const readCommitted = (): Promise<CommittedSnapshot> =>
    new Promise<CommittedSnapshot>((resolve) => {
      if (deps.afterCommit) {
        deps.afterCommit((s) => resolve(s));
      } else {
        resolve({
          segmentCorrections: deps.state.segmentCorrections ?? [],
          segments: deps.state.segments ?? [],
        });
      }
    });

  const applySegmentCorrection = async (
    req: ApplyCorrectionRequest,
  ): Promise<SegmentCorrection> => {
    if (!canCorrect) {
      throw new Error(
        'Solo los roles "admin" o "gabinete" pueden aplicar correcciones.',
      );
    }

    // 1. Resolver el segmento base REAL desde el estado.
    //    NO usar req.segment: puede ser una foto vieja capturada al abrir
    //    un diálogo. La corrección debe nacer del estado actualizado para
    //    que `previousValue` refleje la realidad.
    const baseSeg = (deps.state.segments ?? []).find(
      (s) => s.id === req.segment.id,
    );
    if (!baseSeg) {
      throw new Error(`Segmento no encontrado en estado: ${req.segment.id}`);
    }

    let committed: ApplyCorrectionResult | null = null;

    // 2. Commit atómico — el engine recibe baseSeg, no la foto vieja.
    deps.setSegmentCorrections((prev) => {
      const result = engineApplyCorrection(prev, {
        segment: baseSeg,
        field: req.field,
        newValue: req.newValue,
        reason: req.reason,
        correctedBy: deps.identity.correctedBy,
        correctedByRole: deps.identity.correctedByRole as 'gabinete' | 'admin',
      });
      committed = result;
      return result.corrections;
    });

    if (!committed) {
      throw new Error('La corrección no se confirmó en el estado.');
    }
    const result = committed as ApplyCorrectionResult;

    // 3. Esperar al commit real y leer el snapshot ya comprometido.
    const snapshot = await readCommitted();

    // 4. Calcular consolidado para el log SIEMPRE desde committedSegments
    //    (no desde req.segment ni desde baseSeg, que es del render anterior).
    const baseSegAfter = snapshot.segments.find((s) => s.id === req.segment.id);
    const consolidatedAfter = baseSegAfter
      ? engineGetConsolidatedSegment(baseSegAfter, snapshot.segmentCorrections)
      : null;

    await log('SEGMENT_CORRECTION_APPLIED', {
      workDay: consolidatedAfter?.workDay,
      trackNumber: consolidatedAfter?.trackNumber ?? undefined,
      segmentId: req.segment.id,
      payload: {
        correctionId: result.created.id,
        field: result.created.field,
        previousValue: result.created.previousValue,
        newValue: result.created.newValue,
        reason: result.created.reason,
        correctedBy: result.created.correctedBy,
        correctedByRole: result.created.correctedByRole,
        supersededCorrectionId: result.superseded[0]?.id,
      },
    });

    return result.created;
  };

  const revertSegmentCorrection = async (
    req: RevertCorrectionRequest,
  ): Promise<SegmentCorrection> => {
    if (!canCorrect) {
      throw new Error(
        'Solo los roles "admin" o "gabinete" pueden revertir correcciones.',
      );
    }

    let committed: RevertCorrectionResult | null = null;

    deps.setSegmentCorrections((prev) => {
      const result = engineRevertCorrection(prev, {
        correctionId: req.correctionId,
        revertReason: req.revertReason,
        revertedBy: deps.identity.correctedBy,
      });
      committed = result;
      return result.corrections;
    });

    if (!committed) {
      throw new Error('La reversión no se confirmó en el estado.');
    }
    const result = committed as RevertCorrectionResult;

    // Snapshot post-commit para calcular el consolidado del log.
    const snapshot = await readCommitted();
    const baseSegAfter = snapshot.segments.find(
      (s) => s.id === result.reverted.segmentId,
    );
    const consolidatedAfter = baseSegAfter
      ? engineGetConsolidatedSegment(baseSegAfter, snapshot.segmentCorrections)
      : null;

    await log('SEGMENT_CORRECTION_REVERTED', {
      workDay: consolidatedAfter?.workDay,
      trackNumber: consolidatedAfter?.trackNumber ?? undefined,
      segmentId: result.reverted.segmentId,
      payload: {
        correctionId: result.reverted.id,
        field: result.reverted.field,
        revertedBy: result.reverted.revertedBy,
        revertReason: result.reverted.revertReason,
        originalPreviousValue: result.reverted.previousValue,
        revertedNewValue: result.reverted.newValue,
      },
    });

    return result.reverted;
  };

  const getSegmentCorrections = (segmentId: string): SegmentCorrection[] =>
    (deps.state.segmentCorrections ?? [])
      .filter((c) => c.segmentId === segmentId)
      .sort((a, b) => a.correctedAt.localeCompare(b.correctedAt));

  const getActiveCorrections = (segmentId: string): SegmentCorrection[] =>
    engineGetActiveCorrections(segmentId, deps.state.segmentCorrections ?? []);

  const getConsolidatedSegment = (segment: Segment): Segment =>
    engineGetConsolidatedSegment(segment, deps.state.segmentCorrections ?? []);

  const isFieldCorrected = (segmentId: string, field: CorrectableField): boolean =>
    engineIsFieldCorrected(segmentId, field, deps.state.segmentCorrections ?? []);

  return {
    applySegmentCorrection,
    revertSegmentCorrection,
    getSegmentCorrections,
    getActiveCorrections,
    getConsolidatedSegment,
    isFieldCorrected,
    canCorrect,
  };
}

/**
 * Hook React: ensambla las dependencias reales (estado, auth, rol) y
 * devuelve la API. Los componentes solo usan esto.
 */
export function useSegmentCorrections(): UseSegmentCorrectionsApi {
  const { state, setSegmentCorrections, readCommittedState } = useRouteStateContext();
  const { user, isOfflineMode } = useAuth();
  const { role } = useUserRole();

  const correctedBy = user?.email ?? (isOfflineMode ? 'offline-cache' : 'desconocido');
  const correctedByRole: 'gabinete' | 'admin' | null =
    role === 'admin' ? 'admin' : role === 'gabinete' ? 'gabinete' : null;

  return createSegmentCorrectionsApi({
    state: {
      segmentCorrections: state.segmentCorrections ?? [],
      segments: state.route?.segments ?? [],
    },
    setSegmentCorrections,
    identity: { correctedBy, correctedByRole },
    afterCommit: (cb) => {
      readCommittedState((s: AppState) => {
        cb({
          segmentCorrections: s.segmentCorrections ?? [],
          segments: s.route?.segments ?? [],
        });
      });
    },
  });
}
