/**
 * Hook de gabinete: aplica/revierte correcciones auditadas y reversibles
 * sobre los tramos, conectando el engine puro (`utils/gabinete/consolidate`)
 * con el estado real (`useRouteState`) y el event-log persistente.
 *
 * Reglas críticas (ver plan Sub-bloque 2):
 *  1. El dato de campo en `Segment` NO se muta. La consolidación se deriva
 *     en lectura desde `state.segmentCorrections`.
 *  2. El cálculo (engine puro) ocurre DENTRO del updater de
 *     `setSegmentCorrections` para garantizar atomicidad real frente a
 *     llamadas concurrentes en el mismo tick.
 *  3. Los eventos `SEGMENT_CORRECTION_APPLIED` / `_REVERTED` se emiten
 *     SOLO después del commit confirmado, nunca dentro del updater
 *     (evita duplicados por reintentos de React).
 *  4. Solo roles `admin` y `gabinete` pueden aplicar/revertir.
 *
 * NOTA sobre coexistencia:
 *  - `updateSegment` (en useRouteState) es la vía de campo: muta el Segment
 *    directamente y NO debe usarse desde gabinete.
 *  - `applySegmentCorrection` (este hook) es la vía de gabinete: append-only
 *    sobre `segmentCorrections`, no toca el Segment original.
 *  Ambas escriben colecciones distintas; coexisten sin colisión.
 */

import { useCallback } from 'react';
import { useRouteState } from '@/hooks/useRouteState';
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

/**
 * Inyectable: por defecto consume el hook real de estado.
 * Tests pueden pasar un mock con la misma forma para verificar atomicidad
 * y orden commit→evento sin montar React.
 */
export interface SegmentCorrectionsDeps {
  state: { segmentCorrections: SegmentCorrection[] };
  setSegmentCorrections: (
    updater: (prev: SegmentCorrection[]) => SegmentCorrection[],
  ) => void;
  identity: {
    correctedBy: string;
    correctedByRole: 'gabinete' | 'admin' | null;
  };
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

  const applySegmentCorrection = async (
    req: ApplyCorrectionRequest,
  ): Promise<SegmentCorrection> => {
    if (!canCorrect) {
      throw new Error(
        'Solo los roles "admin" o "gabinete" pueden aplicar correcciones.',
      );
    }

    let committed: ApplyCorrectionResult | null = null;

    // Cálculo puro DENTRO del updater → atomicidad real frente a llamadas
    // concurrentes en el mismo tick (la 2ª lee el resultado de la 1ª).
    deps.setSegmentCorrections((prev) => {
      const result = engineApplyCorrection(prev, {
        segment: req.segment,
        field: req.field,
        newValue: req.newValue,
        reason: req.reason,
        correctedBy: deps.identity.correctedBy,
        correctedByRole: deps.identity.correctedByRole as 'gabinete' | 'admin',
      });
      committed = result;
      return result.corrections;
    });

    // Esperar al flush del commit antes de emitir el evento.
    await Promise.resolve();

    if (!committed) {
      throw new Error('La corrección no se confirmó en el estado.');
    }
    const result = committed as ApplyCorrectionResult;

    await log('SEGMENT_CORRECTION_APPLIED', {
      workDay: req.segment.workDay,
      trackNumber: req.segment.trackNumber ?? undefined,
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

    await Promise.resolve();

    if (!committed) {
      throw new Error('La reversión no se confirmó en el estado.');
    }
    const result = committed as RevertCorrectionResult;

    await log('SEGMENT_CORRECTION_REVERTED', {
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
  const { state, setSegmentCorrections } = useRouteState();
  const { user, isOfflineMode } = useAuth();
  const { role } = useUserRole();

  const correctedBy = user?.email ?? (isOfflineMode ? 'offline-cache' : 'desconocido');
  const correctedByRole: 'gabinete' | 'admin' | null =
    role === 'admin' ? 'admin' : role === 'gabinete' ? 'gabinete' : null;

  // Memo de la API según deps; useCallback en cada función sería más ruido
  // que beneficio porque ya estamos creando un objeto por render.
  const api = useCallback(
    () =>
      createSegmentCorrectionsApi({
        state: { segmentCorrections: state.segmentCorrections ?? [] },
        setSegmentCorrections,
        identity: { correctedBy, correctedByRole },
      }),
    [state.segmentCorrections, setSegmentCorrections, correctedBy, correctedByRole],
  );

  return api();
}
