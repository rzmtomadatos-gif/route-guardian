/**
 * useRouteState — fuente real del estado operativo de la campaña.
 *
 * IMPORTANTE: este hook crea estado interno con `useState`. Solo debe
 * invocarse UNA VEZ en todo el árbol React, dentro de `AppRoutes`
 * (`src/App.tsx`). El resto del árbol (hooks, diálogos, paneles) debe
 * consumir la instancia compartida vía `useRouteStateContext()`
 * (`src/context/RouteStateContext.tsx`).
 *
 * Llamarlo desde otro componente crea una instancia paralela vacía y
 * provoca errores como "Segmento no encontrado en estado".
 */
import { useState, useCallback } from 'react';
import type { Route, AppState, Segment, Incident, IncidentCategory, IncidentImpact, LatLng, BaseLocation, TrackSession, BlockEndPrompt, SegmentCorrection, TrackGpsPoint } from '@/types/route';
import type {
  CaptureMission,
  CaptureRun,
  SegmentCapture,
  TrimbleFieldStatus,
  TrimbleQaStatus,
  TrimbleIncident,
  TrimbleDeliverable,
  TrimbleGpsPoint,
  TrimbleRecordingSession,
} from '@/types/trimble';
import { findActiveCapture } from '@/types/trimble';
import { analyzeTrimbleGpsCoverage } from '@/utils/trimble/gps-coverage';
import { canChangeAcquisitionMode } from '@/utils/trimble/mode-change-guard';
import { getDefaultState, saveState, createEmptyCampaignState } from '@/utils/storage';
import { clearEventsDB } from '@/utils/persistence';
import { optimizeRoute } from '@/utils/route-optimizer';
import { optimizeWithDirections } from '@/utils/google-directions';
import { logEvent } from '@/utils/persistence';
import { applyReactivation, type ReactivateOptions } from '@/utils/segment-reactivation';
import { applyDuplicate } from '@/utils/segment-duplicate';
import { toast } from 'sonner';

const MAX_SEGMENTS_PER_TRACK = 9;

/** Valid reasons for cancelling segments — closed set for event log traceability */
type CancelReason = 'operator_cancel' | 'recovery_cancel' | 'stop_navigation_cancel' | 'day_change_cancel';

/** Structured result from changeWorkDay validation/execution */
export interface WorkDayChangeResult {
  allowed: boolean;
  reason?: string;
  requiresConfirmation?: boolean;
  hasInProgress?: boolean;
  inProgressCount?: number;
}

/**
 * Pure helper: revert a single en_progreso segment back to pendiente.
 * Does NOT touch trackHistory, activeSegmentId, or emit events.
 */
function revertSegmentToPending(s: AppState, segmentId: string): AppState {
  if (!s.route) return s;
  const seg = s.route.segments.find((seg) => seg.id === segmentId);
  if (!seg || seg.status !== 'en_progreso') return s;

  const segments = s.route.segments.map((seg) => {
    if (seg.id !== segmentId) return seg;
    return {
      ...seg,
      status: 'pendiente' as const,
      trackNumber: null,
      plannedTrackNumber: null,
      plannedBy: undefined,
      segmentOrder: undefined,
      timestampInicio: undefined,
      startedAt: null,
      segmentStartSeconds: null,
    };
  });

  // Clean trackSession
  let trackSession = s.trackSession;
  if (trackSession && trackSession.segmentIds.includes(segmentId)) {
    const newIds = trackSession.segmentIds.filter((id) => id !== segmentId);
    if (newIds.length === 0) {
      // Track is now empty — close it
      trackSession = { ...trackSession, segmentIds: newIds, active: false, endedAt: new Date().toISOString(), closedManually: true };
    } else {
      trackSession = { ...trackSession, segmentIds: newIds };
    }
  }

  return { ...s, route: { ...s.route, segments }, trackSession };
}

/**
 * Pure helper: revert ALL en_progreso segments back to pendiente.
 * Does NOT touch activeSegmentId or emit events.
 */
function revertAllInProgress(s: AppState): { state: AppState; revertedIds: string[] } {
  if (!s.route) return { state: s, revertedIds: [] };
  const inProgressIds = s.route.segments
    .filter((seg) => seg.status === 'en_progreso')
    .map((seg) => seg.id);
  if (inProgressIds.length === 0) return { state: s, revertedIds: [] };

  let result = s;
  for (const id of inProgressIds) {
    result = revertSegmentToPending(result, id);
  }
  return { state: result, revertedIds: inProgressIds };
}

/** Categories that are "Critica NO grabable" by default */
const NON_RECORDABLE_CATEGORIES = new Set<IncidentCategory>([
  'carretera_cortada', 'acceso_imposible', 'inundacion', 'lluvia',
]);

/** Categories that invalidate the entire block */
const BLOCK_INVALIDATING_CATEGORIES = new Set<IncidentCategory>([
  'error_sistema_pc360', 'error_sistema_pc2', 'error_sistema_linux',
]);

export function useRouteState() {
  const [state, setStateRaw] = useState<AppState>(getDefaultState);
  
  const [isDirty, setIsDirty] = useState(false);
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState<string | null>(null);

  const setState = useCallback((updater: (prev: AppState) => AppState, immediate = false) => {
    setStateRaw((prev) => {
      const next = updater(prev);
      saveState(next, immediate);
      setIsDirty(true);
      return next;
    });
  }, []);

  /**
   * Setter atómico para correcciones de gabinete.
   * - Append-only: el cálculo del resultado vive DENTRO del updater para
   *   garantizar atomicidad real (dos llamadas en el mismo tick ven el
   *   resultado de la anterior, no el snapshot inicial).
   * - immediate=true: las correcciones son críticas auditables y no deben
   *   quedar a merced del debounce de persistencia.
   */
  const setSegmentCorrections = useCallback(
    (updater: (prev: SegmentCorrection[]) => SegmentCorrection[]) => {
      setState((s) => ({
        ...s,
        segmentCorrections: updater(s.segmentCorrections ?? []),
      }), true);
    },
    [setState],
  );

  /**
   * Append atómico y append-only al log GPS del track.
   * - Escribe únicamente en `trackGpsLogsByDay[workDay][trackNumber]`.
   * - Nunca reescribe puntos previos.
   * - Las claves `workDay` y `trackNumber` se toman del PROPIO punto, no del
   *   estado al ejecutar (evita carreras si `workDay` cambió entre cálculo
   *   y commit).
   * - No emite logEvent: la traza GPS es un dato denso que se persiste en
   *   estado, no en event_log.
   */
  const appendTrackGpsPoint = useCallback((point: TrackGpsPoint) => {
    setState((s) => {
      const byDay = s.trackGpsLogsByDay ?? {};
      const byTrack = byDay[point.workDay] ?? {};
      const prev = byTrack[point.trackNumber] ?? [];
      return {
        ...s,
        trackGpsLogsByDay: {
          ...byDay,
          [point.workDay]: {
            ...byTrack,
            [point.trackNumber]: [...prev, point],
          },
        },
      };
    });
  }, [setState]);

  /**
   * Lee el estado YA comprometido por React tras el último setState pendiente.
   * Solo lectura: el callback recibe el estado pero no debe mutarlo. Se devuelve
   * la misma referencia desde el updater interno, así que React no programa otro
   * render. Útil para emitir eventos de auditoría con datos consolidados
   * post-commit (ej. SEGMENT_CORRECTION_APPLIED tras append en setSegmentCorrections).
   *
   * IMPORTANTE: para escribir, usar setState/setSegmentCorrections. Esta función
   * NO es una vía de escritura.
   */
  const readCommittedState = useCallback((cb: (s: AppState) => void) => {
    setStateRaw((current) => {
      cb(current);
      return current; // misma referencia → no triggerea re-render
    });
  }, []);

  /** Get current max track number for a given work day across segments + track session */
  const getMaxTrack = (segments: Segment[], trackSession: TrackSession | null, workDay?: number): number => {
    const daySegments = workDay != null
      ? segments.filter((seg) => seg.workDay === workDay)
      : segments;
    const all = daySegments.flatMap((seg) => [
      ...(seg.trackNumber !== null ? [seg.trackNumber] : []),
      ...seg.trackHistory,
    ]);
    if (trackSession) all.push(trackSession.trackNumber);
    return all.length > 0 ? Math.max(...all) : 0;
  };

  /** Count how many segments are assigned to a given track number (real, valid — only completed) */
  const countSegmentsInTrack = (segments: Segment[], trackNum: number): number => {
    return segments.filter((seg) => seg.trackNumber === trackNum && seg.status === 'completado').length;
  };

  /**
   * Carga una NUEVA campaña (desde KML/KMZ o "Crear proyecto nuevo").
   *
   * AISLAMIENTO ESTRICTO: parte de `createEmptyCampaignState()` con las
   * preferencias del operador, descarta TODO lo operativo de la campaña
   * anterior (días, tracks consumidos, correcciones de gabinete, GPS log,
   * incidencias, segmentos previos, base, prompts) y borra el event_log
   * SQLite. Después emite CAMPAIGN_CREATED y ROUTE_LOADED como primeros
   * eventos de la nueva campaña.
   *
   * NO se llama desde "Importar campaña existente": ese flujo usa
   * restoreState para conservar Día, eventos y trazabilidad propios del
   * archivo importado.
   */
  const setRoute = useCallback(async (route: Route) => {
    const fallbackOrder = optimizeRoute(route.segments);

    // 1) Limpiar event_log SQLite ANTES de escribir el nuevo estado para que
    //    gabinete/Excel no pueda mezclar eventos de la campaña anterior con
    //    los de la nueva ni siquiera durante una ventana mínima.
    try {
      await clearEventsDB();
    } catch (e) {
      console.error('Failed to clear event log on new campaign:', e);
    }

    setState((s) => {
      const fresh = createEmptyCampaignState({
        rstMode: s.rstMode,
        rstGroupSize: s.rstGroupSize,
        acquisitionMode: s.acquisitionMode,
        // base intencionalmente NO se preserva: cada campaña define su base
        // operativa propia.
      });
      return {
        ...fresh,
        route: { ...route, optimizedOrder: fallbackOrder },
      };
    }, true);

    logEvent('CAMPAIGN_CREATED', {
      workDay: 1,
      payload: {
        routeId: route.id,
        routeName: route.name,
        projectCode: route.projectCode ?? null,
        segmentCount: route.segments.length,
      },
    });
    logEvent('ROUTE_LOADED', {
      workDay: 1,
      payload: {
        routeId: route.id,
        routeName: route.name,
        segmentCount: route.segments.length,
        layerCount: route.availableLayers?.length ?? 0,
      },
    });

    try {
      const endpoints = route.segments.map((seg) => ({
        id: seg.id,
        start: seg.coordinates[0],
        end: seg.coordinates[seg.coordinates.length - 1],
      }));
      const directionsOrder = await optimizeWithDirections(endpoints);
      if (directionsOrder) {
        setState((s) => {
          if (!s.route || s.route.id !== route.id) return s;
          return { ...s, route: { ...s.route, optimizedOrder: directionsOrder } };
        });
      }
    } catch (e) {
      console.warn('Google Directions optimization failed, using local algorithm:', e);
    }
  }, [setState]);

  /**
   * Calcula el siguiente número de track para el día activo.
   * Triple guardia:
   *  - getMaxTrack: tracks con tramos ya completados/históricos.
   *  - blockEndPrompt.trackNumber: track recién cerrado pendiente de confirmar prompt.
   *  - lastConsumedTrackByDay[workDay]: tracks ya abiertos en este día (incluso vacíos).
   */
  const computeNextTrackNumber = (s: AppState): number => {
    const segments = s.route?.segments ?? [];
    return Math.max(
      getMaxTrack(segments, s.trackSession, s.workDay),
      s.blockEndPrompt.trackNumber ?? 0,
      s.lastConsumedTrackByDay[s.workDay] ?? 0,
    ) + 1;
  };

  /**
   * Preview no mutante para iniciar navegación.
   * Devuelve si está permitido y los datos para mostrar el diálogo de confirmación.
   * NO toca estado, NO emite eventos, NO ejecuta side effects.
   */
  const prepareNavigationStart = useCallback((hiddenLayers?: Set<string>): {
    allowed: boolean;
    reason?: string;
    workDay: number;
    trackNumber: number;
  } => {
    let snapshot: AppState | null = null;
    setStateRaw((s) => { snapshot = s; return s; });
    const s = snapshot as AppState | null;
    if (!s) return { allowed: false, reason: 'Estado no disponible', workDay: 1, trackNumber: 1 };

    if (!s.route) {
      return { allowed: false, reason: 'No hay ruta cargada', workDay: s.workDay, trackNumber: 1 };
    }
    if (s.navigationActive) {
      return { allowed: false, reason: 'La navegación ya está activa', workDay: s.workDay, trackNumber: s.trackSession?.trackNumber ?? 1 };
    }
    if (s.blockEndPrompt.isOpen) {
      return { allowed: false, reason: 'Confirma primero el cierre del track anterior', workDay: s.workDay, trackNumber: 1 };
    }

    const visiblePending = s.route.optimizedOrder.filter((id) => {
      const seg = s.route!.segments.find((seg) => seg.id === id);
      if (!seg || seg.status !== 'pendiente') return false;
      if (seg.nonRecordable) return false;
      if (hiddenLayers && seg.layer && hiddenLayers.has(seg.layer)) return false;
      return true;
    });
    if (visiblePending.length === 0) {
      return { allowed: false, reason: 'No hay tramos pendientes visibles', workDay: s.workDay, trackNumber: 1 };
    }

    const trackNumber = computeNextTrackNumber(s);
    return { allowed: true, workDay: s.workDay, trackNumber };
  }, [setStateRaw]);

  /**
   * Ejecución real: activa navegación, abre track y emite eventos.
   * Solo debe invocarse tras confirmación del operador en TrackStartDialog.
   * Revalida atómicamente que el track/día esperados siguen siendo correctos.
   */
  const confirmNavigationStart = useCallback((
    expectedTrackNumber: number,
    expectedWorkDay: number,
    hiddenLayers?: Set<string>,
  ): { ok: boolean; reason?: string; trackNumber?: number; workDay?: number } => {
    let result: { ok: boolean; reason?: string; trackNumber?: number; workDay?: number } = { ok: false };

    setState((s) => {
      if (!s.route) {
        result = { ok: false, reason: 'No hay ruta cargada' };
        return s;
      }
      if (s.navigationActive) {
        result = { ok: false, reason: 'La navegación ya está activa' };
        return s;
      }
      if (s.blockEndPrompt.isOpen) {
        result = { ok: false, reason: 'Cierre pendiente de un track anterior' };
        return s;
      }
      if (s.workDay !== expectedWorkDay) {
        result = { ok: false, reason: 'El día ha cambiado, vuelve a iniciar' };
        return s;
      }

      // Revalidación atómica del número de track
      const recomputed = computeNextTrackNumber(s);
      if (recomputed !== expectedTrackNumber) {
        result = { ok: false, reason: `Track recalculado a ${recomputed}, vuelve a iniciar` };
        return s;
      }

      const groupLimit = s.rstMode && s.rstGroupSize > 0 ? s.rstGroupSize : 1;
      const now = new Date().toISOString();

      // Primer pendiente visible para activar
      const visiblePending = s.route.optimizedOrder.filter((id) => {
        const seg = s.route!.segments.find((seg) => seg.id === id);
        if (!seg || seg.status !== 'pendiente') return false;
        if (seg.nonRecordable) return false;
        if (hiddenLayers && seg.layer && hiddenLayers.has(seg.layer)) return false;
        return true;
      });

      const newTrackSession: TrackSession = {
        active: true,
        trackNumber: expectedTrackNumber,
        capacity: groupLimit,
        segmentIds: [],
        startedAt: now,
        endedAt: null,
        closedManually: false,
        trackStartTime: s.acquisitionMode === 'GARMIN' ? Date.now() : null,
      };

      result = { ok: true, trackNumber: expectedTrackNumber, workDay: s.workDay };

      return {
        ...s,
        navigationActive: true,
        activeSegmentId: visiblePending[0] ?? null,
        trackSession: newTrackSession,
        // Marcar el track como consumido por el día — aunque se cierre vacío contará
        lastConsumedTrackByDay: {
          ...s.lastConsumedTrackByDay,
          [s.workDay]: Math.max(s.lastConsumedTrackByDay[s.workDay] ?? 0, expectedTrackNumber),
        },
      };
    }, true);

    if (result.ok) {
      // Emisión única de TRACK_OPENED + NAV_STARTED
      setStateRaw((current) => {
        logEvent('TRACK_OPENED', {
          workDay: current.workDay,
          trackNumber: expectedTrackNumber,
          payload: { capacity: current.trackSession?.capacity ?? null },
        });
        logEvent('NAV_STARTED', {
          workDay: current.workDay,
          trackNumber: expectedTrackNumber,
          payload: { mode: 'navigation' },
        });
        toast(`Día ${current.workDay} · Track ${expectedTrackNumber} iniciado`, {
          duration: 8000,
          position: 'top-center',
        });
        return current;
      });
    }

    return result;
  }, [setState, setStateRaw]);

  /**
   * Wrapper legacy. Mantiene firma anterior pero ya NO abre track ni emite TRACK_OPENED
   * directamente: solo activa navigation flag para callers internos que no pasan por UI.
   * La UI debe usar prepareNavigationStart + TrackStartDialog + confirmNavigationStart.
   */
  const startNavigation = useCallback((hiddenLayers?: Set<string>) => {
    setState((s) => {
      if (!s.route) return s;
      if (s.navigationActive) return s;
      if (s.blockEndPrompt.isOpen) return s;
      const pendingSegments = s.route.optimizedOrder.filter((id) => {
        const seg = s.route!.segments.find((seg) => seg.id === id);
        if (!seg || seg.status !== 'pendiente') return false;
        if (seg.nonRecordable) return false;
        if (hiddenLayers && seg.layer && hiddenLayers.has(seg.layer)) return false;
        return true;
      });
      return {
        ...s,
        navigationActive: true,
        activeSegmentId: pendingSegments[0] || null,
      };
    });
    logEvent('NAV_STARTED', { payload: { mode: 'navigation_legacy' } });
  }, [setState]);

  /**
   * Preview no mutante para detener navegación.
   * Devuelve si requiere confirmación (porque hay track activo o tramos en_progreso)
   * y los datos para mostrar al operador en el diálogo.
   */
  const prepareStopNavigation = useCallback((): {
    needsConfirmation: boolean;
    workDay: number;
    trackNumber: number | null;
    inProgressCount: number;
  } => {
    let snapshot: AppState | null = null;
    setStateRaw((s) => { snapshot = s; return s; });
    const s = snapshot as AppState | null;
    if (!s) return { needsConfirmation: false, workDay: 1, trackNumber: null, inProgressCount: 0 };

    const inProgressCount = s.route
      ? s.route.segments.filter((seg) => seg.status === 'en_progreso').length
      : 0;
    const trackNumber = s.trackSession?.active ? s.trackSession.trackNumber : null;
    const needsConfirmation = trackNumber !== null || inProgressCount > 0;

    return {
      needsConfirmation,
      workDay: s.workDay,
      trackNumber,
      inProgressCount,
    };
  }, [setStateRaw]);

  /**
   * Ejecución real del cierre de navegación.
   * Si hay track activo lo cierra y abre blockEndPrompt (reason 'manual').
   * Si hay tramos en_progreso los revierte a pendiente.
   * Solo debe llamarse tras confirmación del operador (o desde el wrapper cuando no hay nada destructivo).
   */
  const confirmStopNavigation = useCallback(() => {
    let trackClosed: number | null = null;
    let defensiveCleaned: string[] = [];

    setState((s) => {
      if (!s.navigationActive) return s;
      const now = new Date().toISOString();
      let newState: AppState = {
        ...s,
        navigationActive: false,
        activeSegmentId: null,
      };

      // Cerrar track activo (si existe) — siempre lo consumimos
      if (newState.trackSession && newState.trackSession.active) {
        trackClosed = newState.trackSession.trackNumber;
        newState = {
          ...newState,
          trackSession: { ...newState.trackSession, active: false, endedAt: now, closedManually: true },
          blockEndPrompt: { isOpen: true, trackNumber: trackClosed, reason: 'manual' },
        };
      } else if (newState.trackSession) {
        newState = {
          ...newState,
          trackSession: { ...newState.trackSession, trackStartTime: null },
        };
      }

      // Revertir tramos en_progreso residuales
      if (newState.route) {
        const residual = newState.route.segments.filter((seg) => seg.status === 'en_progreso');
        if (residual.length > 0) {
          const result = revertAllInProgress(newState);
          newState = { ...result.state, activeSegmentId: null };
          defensiveCleaned = result.revertedIds;
        }
      }

      return newState;
    }, true);

    // Emitir eventos fuera del updater
    setStateRaw((current) => {
      if (trackClosed !== null) {
        logEvent('TRACK_CLOSED', {
          workDay: current.workDay,
          trackNumber: trackClosed,
          payload: { reason: 'manual_via_stop_navigation' },
        });
      }
      logEvent('NAV_STOPPED', {
        payload: {
          reason: trackClosed !== null ? 'track_closed_manual' : 'manual',
          trackNumber: trackClosed ?? undefined,
          ...(defensiveCleaned.length > 0 ? { defensiveCleaned } : {}),
        },
      });
      return current;
    });
  }, [setState, setStateRaw]);

  /**
   * Wrapper legacy: para llamadas internas que no pasan por UI.
   * Si necesita confirmación (track activo o tramos en_progreso), NO ejecuta:
   * la UI debe usar prepareStopNavigation + confirmStopNavigation.
   * Solo ejecuta directo cuando no hay nada destructivo que confirmar.
   */
  const stopNavigation = useCallback(() => {
    const preview = prepareStopNavigation();
    if (preview.needsConfirmation) {
      // No ejecutar: la UI debe pedir confirmación explícita.
      return;
    }
    confirmStopNavigation();
  }, [prepareStopNavigation, confirmStopNavigation]);

  /** Allocate the next track number based on mode. Resets per workDay. */
  const allocateTrackNumber = (segments: Segment[], rstMode: boolean, groupLimit: number, trackSession: TrackSession | null, workDay?: number): number => {
    if (!rstMode) {
      // RST OFF: every segment gets a unique track = max + 1
      const maxTrack = getMaxTrack(segments, trackSession, workDay);
      return maxTrack + 1;
    }
    // RST ON: reuse current track if session active and has room (count only completed)
    if (trackSession && trackSession.active) {
      const completedInSession = segments.filter(
        (seg) => trackSession!.segmentIds.includes(seg.id) && seg.status === 'completado'
      ).length;
      if (completedInSession < trackSession.capacity) {
        return trackSession.trackNumber;
      }
    }
    // Otherwise new track
    const maxTrack = getMaxTrack(segments, trackSession, workDay);
    return maxTrack + 1;
  };

  /** Skip segment: leave as pendiente and move to next */
  const skipSegment = useCallback((segmentId: string, hiddenLayers?: Set<string>) => {
    setState((s) => {
      if (!s.route) return s;
      if (s.blockEndPrompt.isOpen) return s;
      const segments = s.route.segments;
      const remaining = s.route.optimizedOrder.filter((id) => {
        if (id === segmentId) return false;
        const seg = segments.find((seg) => seg.id === id);
        return seg?.status === 'pendiente' && !seg.nonRecordable &&
          !(hiddenLayers && seg.layer && hiddenLayers.has(seg.layer));
      });
      return { ...s, activeSegmentId: remaining[0] || null };
    });
    logEvent('SEGMENT_SKIPPED', { segmentId });
  }, [setState]);

  /**
   * Asocia un tramo al track YA ABIERTO. Neutralizado:
   *  - NO abre track
   *  - NO cierra track
   *  - NO emite TRACK_OPENED
   *  - NO decide capacidad
   *  - NO lanza toast de inicio
   *
   * El cierre por capacidad vive únicamente en `completeSegment`,
   * usando el conteo de completados válidos.
   * Si el estado es anómalo (sin track activo), aborta con warning defensivo.
   */
  const confirmStartSegment = useCallback((segmentId: string, hiddenLayers?: Set<string>) => {
    let startedPayload: Record<string, unknown> | null = null;
    setState((s) => {
      if (!s.route) return s;
      if (s.blockEndPrompt.isOpen) return s;
      if (!s.navigationActive) return s;

      const seg = s.route.segments.find((seg) => seg.id === segmentId);
      if (!seg) return s;

      // Fallback defensivo: requiere track activo abierto por confirmNavigationStart
      if (!s.trackSession || !s.trackSession.active) {
        console.warn('[confirmStartSegment] Estado anómalo: no hay track activo. Aborta sin abrir track.');
        return s;
      }

      const trackNum = s.trackSession.trackNumber;
      const groupLimit = s.rstMode && s.rstGroupSize > 0 ? s.rstGroupSize : 1;
      const now = new Date().toISOString();

      // segmentOrder provisional — definitivo en completeSegment
      const existingCompletedInTrack = s.route.segments.filter(
        (sg) =>
          sg.id !== segmentId &&
          sg.workDay === s.workDay &&
          sg.trackNumber === trackNum &&
          sg.status === 'completado' &&
          !sg.nonRecordable,
      ).length;
      const segmentOrder = existingCompletedInTrack + 1;

      if (s.rstMode && segmentOrder > groupLimit) {
        console.warn('Invalid segmentOrder detected', {
          workDay: s.workDay, trackNumber: trackNum, segmentOrder, groupLimit, segmentId,
        });
        return s;
      }

      const garminStart = s.acquisitionMode === 'GARMIN' && s.trackSession.trackStartTime
        ? Math.round((Date.now() - s.trackSession.trackStartTime) / 1000)
        : null;

      let segments = s.route.segments.map((sg) =>
        sg.id === segmentId
          ? {
              ...sg,
              status: 'en_progreso' as const,
              trackNumber: trackNum,
              plannedTrackNumber: null,
              plannedBy: undefined,
              timestampInicio: now,
              startedAt: now,
              workDay: s.workDay,
              segmentOrder,
              segmentStartSeconds: garminStart,
            }
          : sg
      );

      // RST: pre-asignar plannedTrackNumber a hermanos pendientes (preview, no abre nada)
      const currentIdx = s.route.optimizedOrder.indexOf(segmentId);
      if (s.rstMode && s.rstGroupSize > 1 && currentIdx >= 0) {
        let assigned = 0;
        const alreadyAssociated = s.trackSession.segmentIds.length;
        const maxToAssign = s.rstGroupSize - 1 - alreadyAssociated;
        for (let i = currentIdx + 1; i < s.route.optimizedOrder.length && assigned < maxToAssign; i++) {
          const sibId = s.route.optimizedOrder[i];
          const sib = segments.find((sg) => sg.id === sibId);
          if (!sib || sib.status !== 'pendiente') continue;
          if (sib.nonRecordable) continue;
          if (hiddenLayers && sib.layer && hiddenLayers.has(sib.layer)) continue;
          if (sib.trackNumber === null && (sib.plannedTrackNumber === null || sib.plannedTrackNumber === undefined)) {
            segments = segments.map((sg) =>
              sg.id === sibId ? { ...sg, plannedTrackNumber: trackNum, plannedBy: 'rst' as const } : sg
            );
            assigned++;
          }
        }
      }

      // Asociar el tramo al track ya abierto (sin duplicados)
      const newSegmentIds = s.trackSession.segmentIds.includes(segmentId)
        ? s.trackSession.segmentIds
        : [...s.trackSession.segmentIds, segmentId];

      // Capturar datos para event-log enriquecido (HISTORIAL_INTENTOS).
      startedPayload = {
        segmentName: seg.name,
        workDay: s.workDay,
        trackNumber: trackNum,
        segmentOrder,
        startedAt: now,
        acquisitionMode: s.acquisitionMode,
        segmentStartSeconds: garminStart,
      };

      return {
        ...s,
        route: { ...s.route, segments },
        activeSegmentId: segmentId,
        trackSession: { ...s.trackSession, segmentIds: newSegmentIds },
      };
    }, true);
    if (startedPayload) {
      logEvent('SEGMENT_STARTED', {
        segmentId,
        workDay: startedPayload.workDay as number,
        trackNumber: startedPayload.trackNumber as number,
        payload: startedPayload,
      });
    }
  }, [setState]);

  const completeSegment = useCallback((segmentId: string, hiddenLayers?: Set<string>) => {
    let completedPayload: Record<string, unknown> | null = null;
    setState((s) => {
      if (!s.route) return s;
      // Guard: block if end-of-video prompt is open
      if (s.blockEndPrompt.isOpen) return s;

      const now = new Date().toISOString();
      const groupLimit = s.rstMode && s.rstGroupSize > 0 ? s.rstGroupSize : 1;

      // Auto-assign track if missing (invariant: completed must have trackNumber)
      let autoTrack: number | null = null;
      const seg = s.route.segments.find((seg) => seg.id === segmentId);
      if (seg && seg.trackNumber === null) {
        autoTrack = allocateTrackNumber(s.route.segments, s.rstMode, groupLimit, s.trackSession && s.trackSession.active ? s.trackSession : null, s.workDay);
      }

      // Garmin mode: compute segmentEndSeconds relative to track start
      const garminEnd = s.acquisitionMode === 'GARMIN' && s.trackSession?.trackStartTime
        ? Math.round((Date.now() - s.trackSession.trackStartTime) / 1000)
        : null;

      // Only complete THIS segment with invariants enforced
      const segments = s.route.segments.map((seg) => {
        if (seg.id !== segmentId) return seg;
        // Safety: nonRecordable cannot be Completado
        if (seg.nonRecordable) {
          return { ...seg, status: 'posible_repetir' as const, trackNumber: null, endedAt: null };
        }
        const finalTrack = autoTrack !== null ? autoTrack : seg.trackNumber;
        return {
          ...seg,
          status: 'completado' as const,
          trackNumber: finalTrack,
          timestampFin: now,
          timestampInicio: seg.timestampInicio || now,
          endedAt: now,
          startedAt: seg.startedAt || now,
          // Clear repeat flags on successful completion
          needsRepeat: false,
          repeatRequested: false,
          invalidatedByTrack: null,
          repeatNumber: (seg.repeatNumber || 0) + 1,
          segmentEndSeconds: garminEnd ?? seg.segmentEndSeconds ?? null,
        };
      });

      // Close track session if full
      let trackSession = s.trackSession;
      let blockEndPrompt = s.blockEndPrompt;
      if (!s.rstMode && trackSession && trackSession.active) {
        // RST OFF: close after each segment (1:1)
        trackSession = { ...trackSession, active: false, endedAt: now };
      } else if (s.rstMode && trackSession && trackSession.active) {
        // RST ON: count valid completed segments in this track
        const validInTrack = segments.filter(
          (seg) =>
            seg.workDay === s.workDay &&
            seg.trackNumber === trackSession!.trackNumber &&
            seg.status === 'completado' &&
            !seg.nonRecordable &&
            !seg.needsRepeat
        ).length;
        if (validInTrack >= trackSession.capacity) {
          // Auto-close: capacity reached → trigger blocking prompt
          trackSession = { ...trackSession, active: false, endedAt: now };
          blockEndPrompt = { isOpen: true, trackNumber: trackSession.trackNumber, reason: 'capacity' };
        }
      }

      // Next pending according to optimizedOrder, respecting hidden layers and nonRecordable
      const remaining = s.route.optimizedOrder.filter((id) => {
        const seg = segments.find((seg) => seg.id === id);
        if (!seg || seg.status !== 'pendiente') return false;
        if (seg.nonRecordable) return false;
        if (hiddenLayers && seg.layer && hiddenLayers.has(seg.layer)) return false;
        return true;
      });

      // Snapshot enriquecido para HISTORIAL_INTENTOS (solo si efectivamente completado).
      const completed = segments.find((sg) => sg.id === segmentId);
      if (completed && completed.status === 'completado') {
        completedPayload = {
          workDay: completed.workDay,
          trackNumber: completed.trackNumber,
          segmentOrder: completed.segmentOrder,
          startedAt: completed.startedAt,
          endedAt: completed.endedAt,
          acquisitionMode: s.acquisitionMode,
          segmentStartSeconds: completed.segmentStartSeconds,
          segmentEndSeconds: completed.segmentEndSeconds,
        };
      }

      return {
        ...s,
        route: { ...s.route, segments },
        activeSegmentId: blockEndPrompt.isOpen ? null : (remaining[0] || null),
        navigationActive: blockEndPrompt.isOpen ? false : s.navigationActive,
        trackSession,
        blockEndPrompt,
      };
    }, true);
    if (completedPayload) {
      logEvent('SEGMENT_COMPLETED', {
        segmentId,
        workDay: completedPayload.workDay as number | undefined,
        trackNumber: completedPayload.trackNumber as number | undefined,
        payload: completedPayload,
      });
    } else {
      logEvent('SEGMENT_COMPLETED', { segmentId });
    }
    // Emit TRACK_CLOSED if auto-close happened (capacity reached)
    setStateRaw((current) => {
      if (current.trackSession && !current.trackSession.active && current.trackSession.endedAt) {
        if (current.blockEndPrompt.isOpen) {
          logEvent('TRACK_CLOSED', {
            workDay: current.workDay,
            trackNumber: current.trackSession.trackNumber,
            payload: { reason: current.blockEndPrompt.reason },
          });
        }
      }
      return current;
    });
    // Emit NAV_STOPPED if navigation was auto-stopped due to track closure
    setStateRaw((current) => {
      if (!current.navigationActive && current.blockEndPrompt.isOpen && current.blockEndPrompt.reason === 'capacity') {
        logEvent('NAV_STOPPED', {
          payload: {
            reason: 'track_closed_capacity',
            trackNumber: current.blockEndPrompt.trackNumber ?? undefined,
          },
        });
      }
      return current;
    });
  }, [setState]);

  /** Finalize the current track session (close early) */
  const finalizeTrack = useCallback(() => {
    setState((s) => {
      if (!s.trackSession || !s.trackSession.active) return s;
      const now = new Date().toISOString();
      const trackNum = s.trackSession.trackNumber;

      // Clear planned track numbers for the current track
      let segments = s.route?.segments || [];
      segments = segments.map((seg) => {
        if (seg.plannedTrackNumber === trackNum && seg.status === 'pendiente') {
          return { ...seg, plannedTrackNumber: null, plannedBy: undefined };
        }
        return seg;
      });

      return {
        ...s,
        route: s.route ? { ...s.route, segments } : null,
        navigationActive: false,
        activeSegmentId: null,
        trackSession: {
          ...s.trackSession,
          active: false,
          endedAt: now,
          closedManually: true,
        },
        blockEndPrompt: { isOpen: true, trackNumber: trackNum, reason: 'manual' },
      };
    }, true);
    logEvent('TRACK_CLOSED', { payload: { reason: 'manual' } });
    // Emit NAV_STOPPED after manual track closure
    setStateRaw((current) => {
      if (!current.navigationActive && current.blockEndPrompt.isOpen && current.blockEndPrompt.reason === 'manual') {
        logEvent('NAV_STOPPED', {
          payload: {
            reason: 'track_closed_manual',
            trackNumber: current.blockEndPrompt.trackNumber ?? undefined,
          },
        });
      }
      return current;
    });
  }, [setState]);

  /** Mark segment as posible_repetir (called when adding an incident) */
  const markPosibleRepetir = useCallback((segmentId: string) => {
    setState((s) => {
      if (!s.route) return s;
      const segments = s.route.segments.map((seg) => {
        if (seg.id !== segmentId) return seg;
        const newHistory = seg.trackNumber !== null
          ? [...seg.trackHistory, seg.trackNumber]
          : seg.trackHistory;
        return {
          ...seg,
          status: 'posible_repetir' as const,
          trackNumber: null,
          trackHistory: newHistory,
          timestampFin: new Date().toISOString(),
        };
      });

      // Remove from track session if present
      let trackSession = s.trackSession;
      if (trackSession && trackSession.segmentIds.includes(segmentId)) {
        trackSession = {
          ...trackSession,
          segmentIds: trackSession.segmentIds.filter((id) => id !== segmentId),
        };
      }

      const remaining = s.route.optimizedOrder.filter((id) => {
        const seg = segments.find((seg) => seg.id === id);
        return seg?.status === 'pendiente' && !seg.nonRecordable;
      });

      return {
        ...s,
        route: { ...s.route, segments },
        activeSegmentId: remaining[0] || null,
        trackSession,
      };
    }, true);
  }, [setState]);

  /** Explicit repeat: reset posible_repetir segment to pendiente */
  const repeatSegment = useCallback((segmentId: string) => {
    setState((s) => {
      if (!s.route) return s;
      if (s.blockEndPrompt.isOpen) return s;
      const segments = s.route.segments.map((seg) => {
        if (seg.id !== segmentId) return seg;
        return {
          ...seg,
          status: 'pendiente' as const,
          trackNumber: null,
          plannedTrackNumber: null,
          plannedBy: undefined,
          timestampInicio: undefined,
          timestampFin: undefined,
          startedAt: null,
          endedAt: null,
          failedAt: null,
          nonRecordable: false,
          needsRepeat: false,
          repeatRequested: false,
          invalidatedByTrack: null,
        };
      });
      return { ...s, route: { ...s.route, segments } };
    }, true);
    logEvent('SEGMENT_REPEATED', { segmentId });
  }, [setState]);

  const addIncident = useCallback((segmentId: string, category: IncidentCategory, impact: IncidentImpact, note?: string, location?: LatLng, currentSegmentNonRecordable?: boolean) => {
    setState((s) => {
      if (!s.route) return { ...s };

      const seg = s.route.segments.find((seg) => seg.id === segmentId);
      const now = new Date().toISOString();

      const newIncident: Incident = {
        id: Math.random().toString(36).substring(2, 10),
        segmentId,
        category,
        impact,
        note,
        timestamp: now,
        location,
        trackAtIncident: seg?.trackNumber ?? null,
        workDayAtIncident: s.workDay ?? null,
        invalidatedBlock: impact === 'critica_invalida_bloque',
      };

      let segments = [...s.route.segments];
      let trackSession = s.trackSession;

      if (impact === 'informativa') {
        // No changes to track/status
      } else if (impact === 'critica_no_grabable') {
        // Mark segment as physically non-recordable
        segments = segments.map((seg) => {
          if (seg.id !== segmentId) return seg;
          const newHistory = seg.trackNumber !== null
            ? [...seg.trackHistory, seg.trackNumber]
            : seg.trackHistory;
          return {
            ...seg,
            status: 'posible_repetir' as const,
            nonRecordable: true,
            needsRepeat: false,
            trackNumber: null,
            trackHistory: newHistory,
            failedAt: now,
            endedAt: null,
            plannedTrackNumber: null,
            plannedBy: undefined,
          };
        });

        // Remove from track session
        if (trackSession && trackSession.segmentIds.includes(segmentId)) {
          trackSession = {
            ...trackSession,
            segmentIds: trackSession.segmentIds.filter((id) => id !== segmentId),
          };
        }
      } else if (impact === 'critica_invalida_bloque') {
        // 2.1 Previous segments in the track → needsRepeat, back to itinerary
        const previousIds = new Set(
          (trackSession?.segmentIds || []).filter((id) => id !== segmentId)
        );
        const invalidatedTrackNum = trackSession?.trackNumber ?? null;

        segments = segments.map((seg) => {
          // 2.1 Previous segments in the same track
          if (previousIds.has(seg.id)) {
            const newHistory = seg.trackNumber !== null
              ? [...seg.trackHistory, seg.trackNumber]
              : seg.trackHistory;
            return {
              ...seg,
              status: 'pendiente' as const,
              needsRepeat: true,
              nonRecordable: false,
              repeatRequested: false,
              invalidatedByTrack: invalidatedTrackNum,
              trackNumber: null,
              trackHistory: newHistory,
              startedAt: null,
              endedAt: null,
              failedAt: now,
              plannedTrackNumber: null,
              plannedBy: undefined,
            };
          }

          // 2.2 Current segment where the incident occurred
          if (seg.id === segmentId) {
            const newHistory = seg.trackNumber !== null
              ? [...seg.trackHistory, seg.trackNumber]
              : seg.trackHistory;

            if (currentSegmentNonRecordable) {
              // INVALIDATE_BLOCK + NON_RECORDABLE: current segment is non-recordable, excluded from itinerary
              return {
                ...seg,
                status: 'posible_repetir' as const,
                nonRecordable: true,
                needsRepeat: false,
                invalidatedByTrack: invalidatedTrackNum,
                trackNumber: null,
                trackHistory: newHistory,
                startedAt: null,
                endedAt: null,
                failedAt: now,
                plannedTrackNumber: null,
                plannedBy: undefined,
              };
            } else {
              // INVALIDATE_BLOCK only: current segment is recordable, goes back for repeat
              return {
                ...seg,
                status: 'pendiente' as const,
                needsRepeat: true,
                nonRecordable: false,
                repeatRequested: false,
                invalidatedByTrack: invalidatedTrackNum,
                trackNumber: null,
                trackHistory: newHistory,
                startedAt: null,
                endedAt: null,
                failedAt: now,
                plannedTrackNumber: null,
                plannedBy: undefined,
              };
            }
          }

          return seg;
        });

        // Close the track session and force next track increment
        if (trackSession) {
          trackSession = {
            ...trackSession,
            active: false,
            endedAt: now,
            segmentIds: [],
          };
        }
      }

      // Find next valid segment
      const remaining = s.route.optimizedOrder.filter((id) => {
        const seg = segments.find((seg) => seg.id === id);
        return seg?.status === 'pendiente' && !seg.nonRecordable;
      });

      // If block was invalidated, open blockEndPrompt to force track change
      if (impact === 'critica_invalida_bloque' && trackSession) {
        const invalidatedTrackNum = trackSession.trackNumber;
        return {
          ...s,
          route: { ...s.route, segments },
          incidents: [...s.incidents, newIncident],
          activeSegmentId: null,
          navigationActive: false,
          trackSession,
          blockEndPrompt: {
            isOpen: true,
            trackNumber: invalidatedTrackNum,
            reason: 'invalidated',
          },
        };
      }

      return {
        ...s,
        route: { ...s.route, segments },
        incidents: [...s.incidents, newIncident],
        activeSegmentId: impact !== 'informativa' ? (remaining[0] || null) : s.activeSegmentId,
        trackSession,
      };
    }, true);
    logEvent('INCIDENT_RECORDED', { segmentId, payload: { category, impact, note: note || '' } });
    // Emit TRACK_CLOSED if block was invalidated (side effect outside updater)
    setStateRaw((current) => {
      if (current.blockEndPrompt.isOpen && current.blockEndPrompt.reason === 'invalidated') {
        logEvent('TRACK_CLOSED', {
          workDay: current.workDay,
          trackNumber: current.blockEndPrompt.trackNumber ?? undefined,
          payload: { reason: 'invalidated' },
        });
      }
      return current;
    });
    // Emit NAV_STOPPED after invalidation track closure
    setStateRaw((current) => {
      if (!current.navigationActive && current.blockEndPrompt.isOpen && current.blockEndPrompt.reason === 'invalidated') {
        logEvent('NAV_STOPPED', {
          payload: {
            reason: 'track_closed_invalidated',
            trackNumber: current.blockEndPrompt.trackNumber ?? undefined,
          },
        });
      }
      return current;
    });
  }, [setState]);

  const reoptimize = useCallback((currentPos?: LatLng | null, hiddenLayers?: Set<string>) => {
    setState((s) => {
      if (!s.route) return s;
      const basePos = currentPos || s.base?.position || null;
      const hidden = hiddenLayers || new Set<string>();

      // Only optimize visible, valid segments
      const isVisible = (seg: Segment) => !seg.layer || !hidden.has(seg.layer);
      const isPending = (seg: Segment) =>
        (seg.status === 'pendiente' || (seg.status === 'posible_repetir' && seg.needsRepeat));

      const visiblePending = s.route.segments.filter((seg) => isVisible(seg) && isPending(seg) && !seg.nonRecordable);
      const visibleNonRecordable = s.route.segments.filter((seg) => isVisible(seg) && isPending(seg) && seg.nonRecordable);
      const rest = s.route.segments.filter((seg) => !isVisible(seg) || !isPending(seg));

      if (visiblePending.length === 0 && visibleNonRecordable.length === 0) {
        return s; // Nothing visible to optimize
      }

      const newOrder = [
        ...rest.map((seg) => seg.id),
        ...optimizeRoute(visiblePending, basePos),
        ...visibleNonRecordable.map((seg) => seg.id),
      ];
      return { ...s, route: { ...s.route, optimizedOrder: newOrder } };
    });
  }, [setState]);

  /** Apply a specific candidate route order as the active operative route */
  const applyRouteOrder = useCallback((segmentIds: string[], hiddenLayers?: Set<string>) => {
    setState((s) => {
      if (!s.route) return s;
      const hidden = hiddenLayers || new Set<string>();
      const isVisible = (seg: Segment) => !seg.layer || !hidden.has(seg.layer);
      const isPending = (seg: Segment) =>
        (seg.status === 'pendiente' || (seg.status === 'posible_repetir' && seg.needsRepeat));

      // Keep non-pending and hidden segments in their original position
      const rest = s.route.segments.filter((seg) => !isVisible(seg) || !isPending(seg));
      const visibleNonRecordable = s.route.segments.filter(
        (seg) => isVisible(seg) && isPending(seg) && seg.nonRecordable,
      );

      const newOrder = [
        ...rest.map((seg) => seg.id),
        ...segmentIds,
        ...visibleNonRecordable.map((seg) => seg.id),
      ];
      return { ...s, route: { ...s.route, optimizedOrder: newOrder } };
    });
  }, [setState]);

  const resetSegment = useCallback((segmentId: string) => {
    setState((s) => {
      if (!s.route) return s;
      const segments = s.route.segments.map((seg) => {
        if (seg.id !== segmentId) return seg;
        const newHistory = seg.trackNumber !== null
          ? [...seg.trackHistory, seg.trackNumber]
          : seg.trackHistory;
        return {
          ...seg,
          status: 'pendiente' as const,
          trackNumber: null,
          plannedTrackNumber: null,
          plannedBy: undefined,
          trackHistory: newHistory,
          timestampInicio: undefined,
          timestampFin: undefined,
          startedAt: null,
          endedAt: null,
          failedAt: null,
          nonRecordable: false,
          needsRepeat: false,
          repeatRequested: false,
          invalidatedByTrack: null,
        };
      });
      // Clean segmentId from trackSession if present
      let trackSession = s.trackSession;
      if (trackSession && trackSession.segmentIds.includes(segmentId)) {
        const newIds = trackSession.segmentIds.filter((id) => id !== segmentId);
        trackSession = newIds.length === 0 && trackSession.active
          ? { ...trackSession, segmentIds: newIds, active: false, endedAt: new Date().toISOString(), closedManually: true }
          : { ...trackSession, segmentIds: newIds };
      }
      return { ...s, route: { ...s.route, segments }, trackSession };
    }, true);
    logEvent('SEGMENT_RESET', { segmentId });
  }, [setState]);

  /** Close the block-end prompt. Deja `trackSession: null`: el siguiente track
   *  se calculará al iniciar navegación con la triple guardia
   *  (lastConsumedTrackByDay protege contra reutilización de tracks consumidos vacíos). */
  const closeBlockEndPrompt = useCallback(() => {
    setState((s) => ({
      ...s,
      blockEndPrompt: { isOpen: false, trackNumber: null, reason: 'capacity' },
      trackSession: null,
    }));
  }, [setState]);

  const clearRoute = useCallback(() => {
    // Reset operativo total: equivalente a "no hay campaña". Preserva
    // únicamente preferencias del operador. Limpia también el event_log
    // SQLite para que gabinete y exportes no muestren datos huérfanos.
    clearEventsDB().catch((e) => console.error('Failed to clear event log on clearRoute:', e));
    setState((s) => createEmptyCampaignState({
      rstMode: s.rstMode,
      rstGroupSize: s.rstGroupSize,
      acquisitionMode: s.acquisitionMode,
      base: s.base,
    }), true);
  }, [setState]);

  const setActiveSegment = useCallback((segmentId: string) => {
    setState((s) => ({ ...s, activeSegmentId: segmentId }));
  }, [setState]);

  const setBase = useCallback((base: BaseLocation) => {
    setState((s) => ({ ...s, base }));
  }, [setState]);

  const updateSegment = useCallback((segmentId: string, updates: Partial<Segment>) => {
    setState((s) => {
      if (!s.route) return s;
      const segments = s.route.segments.map((seg) =>
        seg.id === segmentId ? { ...seg, ...updates } : seg
      );
      return { ...s, route: { ...s.route, segments } };
    });
  }, [setState]);

  const updateIncident = useCallback((incidentId: string, updates: Partial<Incident>) => {
    setState((s) => ({
      ...s,
      incidents: s.incidents.map((inc) =>
        inc.id === incidentId ? { ...inc, ...updates } : inc
      ),
    }));
  }, [setState]);

  const deleteIncident = useCallback((incidentId: string) => {
    setState((s) => ({
      ...s,
      incidents: s.incidents.filter((inc) => inc.id !== incidentId),
    }));
  }, [setState]);

  const addLayer = useCallback((layerName: string) => {
    setState((s) => {
      if (!s.route) return s;
      const exists = s.route.segments.some((seg) => seg.layer === layerName);
      if (exists) return s;
      const availableLayers = [...(s.route.availableLayers || []), layerName];
      return { ...s, route: { ...s.route, availableLayers } };
    });
  }, [setState]);

  const renameLayer = useCallback((oldName: string, newName: string) => {
    setState((s) => {
      if (!s.route) return s;
      const segments = s.route.segments.map((seg) =>
        seg.layer === oldName ? { ...seg, layer: newName } : seg
      );
      return { ...s, route: { ...s.route, segments } };
    });
  }, [setState]);

  const deleteLayer = useCallback((layerName: string) => {
    setState((s) => {
      if (!s.route) return s;
      const segments = s.route.segments.map((seg) =>
        seg.layer === layerName ? { ...seg, layer: undefined } : seg
      );
      const availableLayers = (s.route.availableLayers || []).filter((l) => l !== layerName);
      return { ...s, route: { ...s.route, segments, availableLayers } };
    });
  }, [setState]);

  const moveSegmentToLayer = useCallback((segmentId: string, layerName: string | undefined) => {
    setState((s) => {
      if (!s.route) return s;
      const segments = s.route.segments.map((seg) =>
        seg.id === segmentId ? { ...seg, layer: layerName } : seg
      );
      return { ...s, route: { ...s.route, segments } };
    });
  }, [setState]);

  const mergeSegments = useCallback((segmentIds: string[]) => {
    setState((s) => {
      if (!s.route || segmentIds.length < 2) return s;
      const toMerge = segmentIds
        .map((id) => s.route!.segments.find((seg) => seg.id === id))
        .filter(Boolean) as Segment[];
      if (toMerge.length < 2) return s;

      const mergedCoords = toMerge.flatMap((seg) => seg.coordinates);
      const first = toMerge[0];
      const merged: Segment = {
        ...first,
        id: Math.random().toString(36).substring(2, 10),
        name: toMerge.map((s) => s.name).join(' + '),
        coordinates: mergedCoords,
        notes: toMerge.map((s) => s.notes).filter(Boolean).join(' | '),
        trackNumber: null,
        trackHistory: [],
        status: 'pendiente',
      };

      const mergeSet = new Set(segmentIds);
      const segments = s.route.segments.filter((seg) => !mergeSet.has(seg.id));
      const insertIdx = s.route.segments.findIndex((seg) => seg.id === segmentIds[0]);
      segments.splice(Math.max(0, insertIdx), 0, merged);

      const optimizedOrder = s.route.optimizedOrder
        .filter((id) => !mergeSet.has(id))
        .concat(merged.id);

      return {
        ...s,
        route: { ...s.route, segments, optimizedOrder },
        incidents: s.incidents.map((inc) =>
          mergeSet.has(inc.segmentId) ? { ...inc, segmentId: merged.id } : inc
        ),
      };
    });
  }, [setState]);

  const addSegment = useCallback((segment: Segment) => {
    setState((s) => {
      if (!s.route) return s;
      return {
        ...s,
        route: {
          ...s.route,
          segments: [...s.route.segments, segment],
          optimizedOrder: [...s.route.optimizedOrder, segment.id],
        },
      };
    });
  }, [setState]);

  const deleteSegment = useCallback((segmentId: string) => {
    setState((s) => {
      if (!s.route) return s;
      return {
        ...s,
        route: {
          ...s.route,
          segments: s.route.segments.filter((seg) => seg.id !== segmentId),
          optimizedOrder: s.route.optimizedOrder.filter((id) => id !== segmentId),
        },
        incidents: s.incidents.filter((inc) => inc.segmentId !== segmentId),
        activeSegmentId: s.activeSegmentId === segmentId ? null : s.activeSegmentId,
      };
    });
  }, [setState]);

  const bulkDeleteSegments = useCallback((segmentIds: string[]) => {
    setState((s) => {
      if (!s.route) return s;
      const idSet = new Set(segmentIds);
      return {
        ...s,
        route: {
          ...s.route,
          segments: s.route.segments.filter((seg) => !idSet.has(seg.id)),
          optimizedOrder: s.route.optimizedOrder.filter((id) => !idSet.has(id)),
        },
        incidents: s.incidents.filter((inc) => !idSet.has(inc.segmentId)),
        activeSegmentId: s.activeSegmentId && idSet.has(s.activeSegmentId) ? null : s.activeSegmentId,
      };
    });
  }, [setState]);

  const bulkMoveToLayer = useCallback((segmentIds: string[], layerName: string | undefined) => {
    setState((s) => {
      if (!s.route) return s;
      const idSet = new Set(segmentIds);
      const segments = s.route.segments.map((seg) =>
        idSet.has(seg.id) ? { ...seg, layer: layerName } : seg
      );
      return { ...s, route: { ...s.route, segments } };
    });
  }, [setState]);

  const bulkSetColor = useCallback((segmentIds: string[], color: string) => {
    setState((s) => {
      if (!s.route) return s;
      const idSet = new Set(segmentIds);
      const segments = s.route.segments.map((seg) =>
        idSet.has(seg.id) ? { ...seg, color } : seg
      );
      return { ...s, route: { ...s.route, segments } };
    });
  }, [setState]);

  const duplicateSegments = useCallback((segmentIds: string[]) => {
    let records: ReturnType<typeof applyDuplicate>['records'] = [];
    setState((s) => {
      const result = applyDuplicate(s, segmentIds);
      records = result.records;
      return result.state;
    }, true);
    // Patrón post-commit: usar readCommittedState para garantizar que el
    // estado con los duplicados ya está comprometido antes de auditar.
    readCommittedState(() => {
      for (const rec of records) {
        logEvent('SEGMENT_DUPLICATED', {
          segmentId: rec.newSegmentId,
          payload: {
            sourceSegmentId: rec.sourceSegmentId,
            sourceCompanySegmentId: rec.sourceCompanySegmentId,
          },
        });
      }
    });
  }, [setState, readCommittedState]);

  /**
   * Reactiva un tramo para campo (operación operativa, NO corrección reversible).
   *
   * Uso: gabinete decide que un tramo `nonRecordable` o `completado` debe
   * volver a navegarse en otro día. La función deja el tramo como pendiente
   * en `targetWorkDay`, conservando trackHistory, companySegmentId, eventos
   * e incidencias previas. Emite `SEGMENT_REACTIVATED_FOR_FIELD` con snapshot
   * anterior para que `HISTORIAL_INTENTOS` pueda fusionarlo con el siguiente
   * SEGMENT_STARTED real.
   */
  const reactivateSegmentForField = useCallback(
    (segmentId: string, opts: ReactivateOptions) => {
      let snapshot: ReturnType<typeof applyReactivation>['previousSnapshot'] = null;
      let changed = false;
      setState((s) => {
        const result = applyReactivation(s, segmentId, opts);
        snapshot = result.previousSnapshot;
        changed = result.changed;
        return result.state;
      }, true);
      if (changed && snapshot) {
        logEvent('SEGMENT_REACTIVATED_FOR_FIELD', {
          segmentId,
          workDay: opts.targetWorkDay,
          payload: {
            targetWorkDay: opts.targetWorkDay,
            reason: opts.reason,
            mode: opts.mode ?? 'repeat_existing_segment',
            previousStatus: snapshot.previousStatus,
            previousWorkDay: snapshot.previousWorkDay,
            previousTrackNumber: snapshot.previousTrackNumber,
            previousSegmentOrder: snapshot.previousSegmentOrder,
            previousNonRecordable: snapshot.previousNonRecordable,
            previousNeedsRepeat: snapshot.previousNeedsRepeat,
          },
        });
      }
    },
    [setState],
  );

  const reorderSegment = useCallback((segmentId: string, direction: 'up' | 'down') => {
    setState((s) => {
      if (!s.route) return s;
      // Swap in optimizedOrder (source of truth for route numbering)
      const order = [...s.route.optimizedOrder];
      const idx = order.indexOf(segmentId);
      if (idx < 0) return s;
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= order.length) return s;
      [order[idx], order[newIdx]] = [order[newIdx], order[idx]];
      // Also swap in segments array to keep visual order consistent
      const segs = [...s.route.segments];
      const segIdx = segs.findIndex((seg) => seg.id === segmentId);
      if (segIdx >= 0) {
        const segNewIdx = direction === 'up' ? segIdx - 1 : segIdx + 1;
        if (segNewIdx >= 0 && segNewIdx < segs.length) {
          [segs[segIdx], segs[segNewIdx]] = [segs[segNewIdx], segs[segIdx]];
        }
      }
      return { ...s, route: { ...s.route, segments: segs, optimizedOrder: order } };
    });
  }, [setState]);

  /** Reverse a segment's coordinates (flip start/end). Allowed for any segment — field correction takes priority. */
  const reverseSegment = useCallback((segmentId: string) => {
    setState((s) => {
      if (!s.route) return s;
      const segments = s.route.segments.map((seg) => {
        if (seg.id !== segmentId) return seg;
        return {
          ...seg,
          coordinates: [...seg.coordinates].reverse(),
        };
      });
      return { ...s, route: { ...s.route, segments } };
    });
  }, [setState]);

  const simplifySegments = useCallback(() => {
    setState((s) => {
      if (!s.route) return s;
      const groups = new Map<string, Segment[]>();
      for (const seg of s.route.segments) {
        const key = `${seg.name}|||${seg.direction}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(seg);
      }

      const newSegments: Segment[] = [];
      const removedIds = new Set<string>();

      for (const [, group] of groups) {
        if (group.length < 2) {
          newSegments.push(group[0]);
          continue;
        }
        const first = group[0];
        const mergedCoords = group.flatMap((seg) => seg.coordinates);
        const merged: Segment = {
          ...first,
          id: Math.random().toString(36).substring(2, 10),
          coordinates: mergedCoords,
          notes: group.map((s) => s.notes).filter(Boolean).join(' | '),
          trackNumber: null,
          trackHistory: [],
          status: 'pendiente',
        };
        newSegments.push(merged);
        group.forEach((seg) => removedIds.add(seg.id));
      }

      const optimizedOrder = s.route.optimizedOrder
        .filter((id) => !removedIds.has(id))
        .concat(newSegments.filter((seg) => !s.route!.optimizedOrder.includes(seg.id)).map((seg) => seg.id));

      return {
        ...s,
        route: { ...s.route, segments: newSegments, optimizedOrder },
        incidents: s.incidents.map((inc) => {
          if (!removedIds.has(inc.segmentId)) return inc;
          const orig = s.route!.segments.find((seg) => seg.id === inc.segmentId);
          if (!orig) return inc;
          const replacement = newSegments.find(
            (seg) => seg.name === orig.name && seg.direction === orig.direction && !s.route!.segments.some((o) => o.id === seg.id)
          );
          return replacement ? { ...inc, segmentId: replacement.id } : inc;
        }),
      };
    });
  }, [setState]);

  const markClean = useCallback(() => {
    setIsDirty(false);
  }, []);

  const setRstMode = useCallback((enabled: boolean) => {
    setState((s) => {
      // When switching RST off, reset track session so next segment gets a fresh unique track
      if (!enabled && s.trackSession && s.trackSession.active) {
        const now = new Date().toISOString();
        // Also clear planned track numbers from RST planning
        let segments = s.route?.segments || [];
        const trackNum = s.trackSession.trackNumber;
        segments = segments.map((seg) => {
          if (seg.plannedTrackNumber === trackNum && seg.status === 'pendiente') {
            return { ...seg, plannedTrackNumber: null, plannedBy: undefined };
          }
          return seg;
        });
        return {
          ...s,
          rstMode: enabled,
          route: s.route ? { ...s.route, segments } : null,
          trackSession: { ...s.trackSession, active: false, endedAt: now, closedManually: true },
        };
      }
      return { ...s, rstMode: enabled };
    });
  }, [setState]);

  const setRstGroupSize = useCallback((size: number) => {
    setState((s) => {
      // Guard: block if active track already has completed segments
      if (s.trackSession && s.trackSession.active && s.route) {
        const completedInTrack = s.route.segments.filter(
          (seg) => seg.trackNumber === s.trackSession!.trackNumber &&
            seg.status === 'completado' && !seg.nonRecordable
        ).length;
        if (completedInTrack > 0) {
          // Cannot change — toast will be triggered by caller
          return s;
        }
      }
      return { ...s, rstGroupSize: size };
    });
  }, [setState]);

  /**
   * Controlled work day change — Opción A.
   * Without force: validates only, returns structured result, NO state mutation.
   * With force: true: executes the change (closes track, resets blockEndPrompt).
   * Caller must handle cancelAllInProgress('day_change_cancel') BEFORE calling with force.
   */
  const changeWorkDay = useCallback((targetDay: number, options?: { force?: boolean }): WorkDayChangeResult => {
    // Read current state synchronously
    let currentState: AppState | null = null;
    setStateRaw((s) => { currentState = s; return s; });
    if (!currentState) return { allowed: false, reason: 'Estado no disponible' };

    const s = currentState as AppState;
    const current = s.workDay;

    // Same day — no-op
    if (targetDay === current) return { allowed: true };

    // Only allow ±1
    if (targetDay !== current + 1 && targetDay !== current - 1) {
      return { allowed: false, reason: `Solo se permite cambiar ±1 día (actual: ${current})` };
    }

    // Count completed and in-progress for current day
    const completedInDay = s.route?.segments.filter(
      (seg) => seg.workDay === current && seg.status === 'completado'
    ).length ?? 0;

    const inProgressInDay = s.route?.segments.filter(
      (seg) => seg.status === 'en_progreso'
    ) ?? [];

    // Advance: N → N+1
    if (targetDay === current + 1) {
      if (completedInDay === 0) {
        return { allowed: false, reason: 'No hay trabajo completado en el día actual' };
      }
      if (inProgressInDay.length > 0 && !options?.force) {
        return {
          allowed: true,
          requiresConfirmation: true,
          hasInProgress: true,
          inProgressCount: inProgressInDay.length,
        };
      }
      // Confirm without in-progress still needs confirmation
      if (!options?.force) {
        return { allowed: true, requiresConfirmation: true, hasInProgress: false };
      }
    }

    // Regress: N → N-1
    if (targetDay === current - 1) {
      if (completedInDay > 0) {
        return { allowed: false, reason: 'Ya hay tramos completados en el día actual — no se puede retroceder' };
      }
      if (inProgressInDay.length > 0) {
        return { allowed: false, reason: 'Hay tramos en progreso — cancélalos antes de retroceder' };
      }
      if (!options?.force) {
        return { allowed: true, requiresConfirmation: true, hasInProgress: false };
      }
    }

    // Force execution — mutate state
    setState((s) => {
      let trackSession = s.trackSession;
      if (trackSession && trackSession.active) {
        trackSession = { ...trackSession, active: false, endedAt: new Date().toISOString(), closedManually: true };
      }
      return {
        ...s,
        workDay: targetDay,
        trackSession: null,
        blockEndPrompt: { isOpen: false, trackNumber: null, reason: 'capacity' as const },
      };
    }, true);
    logEvent('WORK_DAY_CHANGED', { workDay: targetDay, payload: { from: current, to: targetDay } });
    return { allowed: true };
  }, [setState, setStateRaw]);

  /** Update route context fields (operator, vehicle, weather, client, company, driver) */
  const updateRouteContext = useCallback((updates: { operator?: string; vehicle?: string; weather?: string; client?: string; company?: string; driver?: string }) => {
    setState((s) => {
      if (!s.route) return s;
      return { ...s, route: { ...s.route, ...updates } };
    });
  }, [setState]);

  /** Apply companySegmentId retroactively to segments missing it */
  const applyRetroactiveIds = useCallback((code: string, projectName: string) => {
    setState((s) => {
      if (!s.route) return s;
      // Find max existing index
      let maxIndex = -1;
      for (const seg of s.route.segments) {
        if (seg.companySegmentId) {
          const parts = seg.companySegmentId.split('_');
          const num = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(num) && num > maxIndex) maxIndex = num;
        }
      }
      let nextIndex = maxIndex + 1;
      const segments = s.route.segments.map((seg) => {
        if (seg.companySegmentId) return seg;
        const id = `${code}_${String(nextIndex).padStart(5, '0')}`;
        nextIndex++;
        return { ...seg, companySegmentId: id };
      });
      return {
        ...s,
        route: { ...s.route, segments, projectCode: code, projectName: projectName || code },
      };
    }, true);
  }, [setState]);

  /** Set acquisition mode (RST or GARMIN) */
  const setAcquisitionMode = useCallback((mode: import('@/types/route').AcquisitionMode): { ok: boolean; reason?: string } => {
    let result: { ok: boolean; reason?: string } = { ok: true };
    setState((s) => {
      if (s.acquisitionMode === mode) {
        result = { ok: true };
        return s;
      }
      const check = canChangeAcquisitionMode(s);
      if (!check.ok) {
        result = check;
        return s;
      }
      result = { ok: true };
      return { ...s, acquisitionMode: mode };
    });
    if (result.ok) {
      if (mode === 'TRIMBLE_LIDAR') {
        logEvent('TRIMBLE_MODE_ACTIVATED', { payload: { mode } });
      }
    }
    return result;
  }, [setState]);

  // ── TRIMBLE_LIDAR actions ───────────────────────────────────────────────
  /** Sólo permitido en modo TRIMBLE_LIDAR. Si ya hay misión abierta, falla. */
  const startTrimbleMission = useCallback((data: Omit<CaptureMission, 'id' | 'startedAt' | 'endedAt' | 'workDay'> & { workDay?: number }): { ok: boolean; reason?: string; missionId?: string } => {
    let outcome: { ok: boolean; reason?: string; missionId?: string } = { ok: false };
    setState((s) => {
      if (s.acquisitionMode !== 'TRIMBLE_LIDAR') {
        outcome = { ok: false, reason: 'Modo Trimble inactivo' };
        return s;
      }
      if (s.activeMissionId) {
        outcome = { ok: false, reason: 'Ya hay una misión Trimble abierta' };
        return s;
      }
      if ((s.trimbleMissions?.length ?? 0) >= 5_000) {
        outcome = { ok: false, reason: 'Límite de misiones alcanzado' };
        return s;
      }
      const id = `tm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const mission: CaptureMission = {
        id,
        workDay: data.workDay ?? s.workDay,
        startedAt: new Date().toISOString(),
        endedAt: null,
        vehicle: data.vehicle,
        sensorRig: data.sensorRig,
        operator: data.operator,
        weather: data.weather,
        notes: data.notes,
      };
      outcome = { ok: true, missionId: id };
      return {
        ...s,
        trimbleMissions: [...(s.trimbleMissions ?? []), mission],
        activeMissionId: id,
      };
    }, true);
    if (outcome.ok && outcome.missionId) {
      logEvent('TRIMBLE_MISSION_STARTED', { payload: { missionId: outcome.missionId } });
    }
    return outcome;
  }, [setState]);

  /** Cierra la misión activa: cierra runs y capturas abiertas en cascada. */
  const closeTrimbleMission = useCallback((closedReason: CaptureMission['closedReason'] = 'manual'): { ok: boolean; reason?: string } => {
    let outcome: { ok: boolean; reason?: string } = { ok: false };
    let closedMissionId: string | null = null;
    setState((s) => {
      const missionId = s.activeMissionId;
      if (!missionId) { outcome = { ok: false, reason: 'No hay misión Trimble abierta' }; return s; }
      const now = new Date().toISOString();
      // Cerrar capturas abiertas de runs de esta misión.
      // Cualquier captura aún `en_captura` debe consolidarse como
      // `capturado_pendiente_proceso`: una captura cerrada NUNCA puede
      // quedar marcada como en curso.
      const captures = (s.trimbleSegmentCaptures ?? []).map((c) => {
        if (c.missionId === missionId && c.endedAt === null) {
          const consolidated: TrimbleFieldStatus =
            c.fieldStatus === 'en_captura' ? 'capturado_pendiente_proceso' : c.fieldStatus;
          return { ...c, endedAt: now, fieldStatus: consolidated };
        }
        return c;
      });
      const runs = (s.trimbleRuns ?? []).map((r) =>
        r.missionId === missionId && r.endedAt === null ? { ...r, endedAt: now } : r,
      );
      const missions = (s.trimbleMissions ?? []).map((m) =>
        m.id === missionId ? { ...m, endedAt: now, closedReason } : m,
      );
      closedMissionId = missionId;
      outcome = { ok: true };
      return {
        ...s,
        trimbleSegmentCaptures: captures,
        trimbleRuns: runs,
        trimbleMissions: missions,
        activeMissionId: null,
        activeRunId: null,
      };
    }, true);
    if (outcome.ok && closedMissionId) {
      logEvent('TRIMBLE_MISSION_CLOSED', { payload: { missionId: closedMissionId, closedReason } });
    }
    return outcome;
  }, [setState]);

  const startTrimbleRun = useCallback((opts: { direction?: CaptureRun['direction']; startPosition?: LatLng; notes?: string } = {}): { ok: boolean; reason?: string; runId?: string } => {
    let outcome: { ok: boolean; reason?: string; runId?: string } = { ok: false };
    setState((s) => {
      if (s.acquisitionMode !== 'TRIMBLE_LIDAR') { outcome = { ok: false, reason: 'Modo Trimble inactivo' }; return s; }
      if (!s.activeMissionId) { outcome = { ok: false, reason: 'No hay misión Trimble abierta' }; return s; }
      if (s.activeRunId) { outcome = { ok: false, reason: 'Ya hay una pasada abierta' }; return s; }
      if ((s.trimbleRuns?.length ?? 0) >= 50_000) { outcome = { ok: false, reason: 'Límite de pasadas alcanzado' }; return s; }
      const missionRuns = (s.trimbleRuns ?? []).filter((r) => r.missionId === s.activeMissionId);
      const id = `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const run: CaptureRun = {
        id,
        missionId: s.activeMissionId,
        index: missionRuns.length + 1,
        direction: opts.direction,
        startedAt: new Date().toISOString(),
        endedAt: null,
        startPosition: opts.startPosition,
        notes: opts.notes,
      };
      outcome = { ok: true, runId: id };
      return { ...s, trimbleRuns: [...(s.trimbleRuns ?? []), run], activeRunId: id };
    }, true);
    if (outcome.ok && outcome.runId) {
      logEvent('TRIMBLE_RUN_STARTED', { payload: { runId: outcome.runId } });
    }
    return outcome;
  }, [setState]);

  /** Cierra la pasada activa. Auto-cierra capturas abiertas con fieldStatus dado. */
  const closeTrimbleRun = useCallback((opts: { autoCloseFieldStatus?: TrimbleFieldStatus; endPosition?: LatLng } = {}): { ok: boolean; reason?: string } => {
    let outcome: { ok: boolean; reason?: string } = { ok: false };
    let closedRunId: string | null = null;
    setState((s) => {
      const runId = s.activeRunId;
      if (!runId) { outcome = { ok: false, reason: 'No hay pasada abierta' }; return s; }
      const now = new Date().toISOString();
      const autoStatus: TrimbleFieldStatus = opts.autoCloseFieldStatus ?? 'capturado_pendiente_proceso';
      const captures = (s.trimbleSegmentCaptures ?? []).map((c) => {
        if (c.runId === runId && c.endedAt === null) {
          return { ...c, endedAt: now, fieldStatus: autoStatus };
        }
        return c;
      });
      const runs = (s.trimbleRuns ?? []).map((r) =>
        r.id === runId ? { ...r, endedAt: now, endPosition: opts.endPosition ?? r.endPosition } : r,
      );
      closedRunId = runId;
      outcome = { ok: true };
      return { ...s, trimbleSegmentCaptures: captures, trimbleRuns: runs, activeRunId: null };
    }, true);
    if (outcome.ok && closedRunId) {
      logEvent('TRIMBLE_RUN_CLOSED', { payload: { runId: closedRunId } });
    }
    return outcome;
  }, [setState]);

  const invalidateTrimbleRun = useCallback((reason: string): { ok: boolean; reason?: string } => {
    let outcome: { ok: boolean; reason?: string } = { ok: false };
    let runId: string | null = null;
    setState((s) => {
      runId = s.activeRunId;
      if (!runId) { outcome = { ok: false, reason: 'No hay pasada abierta' }; return s; }
      const now = new Date().toISOString();
      const captures = (s.trimbleSegmentCaptures ?? []).map((c) =>
        c.runId === runId && c.endedAt === null ? { ...c, endedAt: now, fieldStatus: 'repetir' as TrimbleFieldStatus } : c,
      );
      const runs = (s.trimbleRuns ?? []).map((r) =>
        r.id === runId ? { ...r, endedAt: now, invalidated: true } : r,
      );
      outcome = { ok: true };
      return { ...s, trimbleSegmentCaptures: captures, trimbleRuns: runs, activeRunId: null };
    }, true);
    if (outcome.ok && runId) {
      logEvent('TRIMBLE_RUN_INVALIDATED', { payload: { runId, reason } });
    }
    return outcome;
  }, [setState]);

  /**
   * Abre una captura para un tramo. Falla si ya hay otra captura abierta en
   * el run activo (invariante de única captura abierta por run).
   */
  const startTrimbleCapture = useCallback((segmentId: string, opts: { startPosition?: LatLng; notes?: string } = {}): { ok: boolean; reason?: string; captureId?: string } => {
    let outcome: { ok: boolean; reason?: string; captureId?: string } = { ok: false };
    setState((s) => {
      if (s.acquisitionMode !== 'TRIMBLE_LIDAR') { outcome = { ok: false, reason: 'Modo Trimble inactivo' }; return s; }
      if (!s.activeMissionId || !s.activeRunId) { outcome = { ok: false, reason: 'Necesitas una misión y pasada abiertas' }; return s; }
      const open = findActiveCapture(s.trimbleSegmentCaptures ?? [], s.activeRunId);
      if (open) { outcome = { ok: false, reason: 'Hay una captura abierta. Ciérrala antes de abrir otra.' }; return s; }
      if ((s.trimbleSegmentCaptures?.length ?? 0) >= 100_000) { outcome = { ok: false, reason: 'Límite de capturas alcanzado' }; return s; }
      const id = `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const capture: SegmentCapture = {
        id,
        segmentId,
        runId: s.activeRunId,
        missionId: s.activeMissionId,
        startedAt: new Date().toISOString(),
        endedAt: null,
        startPosition: opts.startPosition,
        fieldStatus: 'en_captura',
        fieldNotes: opts.notes,
        qaStatus: null,
      };
      outcome = { ok: true, captureId: id };
      return { ...s, trimbleSegmentCaptures: [...(s.trimbleSegmentCaptures ?? []), capture] };
    }, true);
    if (outcome.ok && outcome.captureId) {
      logEvent('TRIMBLE_CAPTURE_STARTED', { segmentId, payload: { captureId: outcome.captureId } });
    }
    return outcome;
  }, [setState]);

  /** Cierra la captura abierta del run activo con un fieldStatus dado. */
  const closeTrimbleCapture = useCallback((fieldStatus: TrimbleFieldStatus, opts: { endPosition?: LatLng; notes?: string } = {}): { ok: boolean; reason?: string } => {
    let outcome: { ok: boolean; reason?: string } = { ok: false };
    let closed: { id: string; segmentId: string; status: TrimbleFieldStatus } | null = null;
    setState((s) => {
      if (!s.activeRunId) { outcome = { ok: false, reason: 'No hay pasada abierta' }; return s; }
      const open = findActiveCapture(s.trimbleSegmentCaptures ?? [], s.activeRunId);
      if (!open) { outcome = { ok: false, reason: 'No hay captura abierta' }; return s; }
      const now = new Date().toISOString();
      const captures = (s.trimbleSegmentCaptures ?? []).map((c) =>
        c.id === open.id
          ? { ...c, endedAt: now, fieldStatus, endPosition: opts.endPosition ?? c.endPosition, fieldNotes: opts.notes ?? c.fieldNotes }
          : c,
      );
      closed = { id: open.id, segmentId: open.segmentId, status: fieldStatus };
      outcome = { ok: true };
      return { ...s, trimbleSegmentCaptures: captures };
    }, true);
    if (outcome.ok && closed) {
      logEvent('TRIMBLE_CAPTURE_CLOSED', { segmentId: closed.segmentId, payload: { captureId: closed.id, fieldStatus: closed.status } });
      const evtMap: Record<TrimbleFieldStatus, import('@/utils/persistence/types').EventType> = {
        en_captura: 'TRIMBLE_CAPTURE_CLOSED',
        capturado_pendiente_proceso: 'TRIMBLE_CAPTURE_MARKED_PENDING_PROCESS',
        repetir: 'TRIMBLE_CAPTURE_MARKED_REPEAT',
        no_capturable: 'TRIMBLE_CAPTURE_MARKED_NON_CAPTURABLE',
      };
      const tail = evtMap[closed.status];
      if (tail && tail !== 'TRIMBLE_CAPTURE_CLOSED') {
        logEvent(tail, { segmentId: closed.segmentId, payload: { captureId: closed.id } });
      }
    }
    return outcome;
  }, [setState]);

  /** SOLO gabinete. Fija qaStatus sobre una captura existente (no del campo). */
  const setTrimbleQaStatus = useCallback((captureId: string, qa: TrimbleQaStatus, meta: { reviewedBy: string; notes?: string }): { ok: boolean; reason?: string } => {
    let outcome: { ok: boolean; reason?: string } = { ok: false };
    let segmentIdForLog: string | null = null;
    setState((s) => {
      const idx = (s.trimbleSegmentCaptures ?? []).findIndex((c) => c.id === captureId);
      if (idx < 0) { outcome = { ok: false, reason: 'Captura no encontrada' }; return s; }
      const cap = s.trimbleSegmentCaptures[idx];
      const updated: SegmentCapture = {
        ...cap,
        qaStatus: qa,
        qaNotes: meta.notes ?? cap.qaNotes,
        qaReviewedBy: meta.reviewedBy,
        qaReviewedAt: new Date().toISOString(),
      };
      const next = [...s.trimbleSegmentCaptures];
      next[idx] = updated;
      segmentIdForLog = cap.segmentId;
      outcome = { ok: true };
      return { ...s, trimbleSegmentCaptures: next };
    }, true);
    if (outcome.ok && segmentIdForLog) {
      logEvent('TRIMBLE_QA_STATUS_SET', { segmentId: segmentIdForLog, payload: { captureId, qa, reviewedBy: meta.reviewedBy } });
    }
    return outcome;
  }, [setState]);

  const recordTrimbleIncident = useCallback((data: Omit<TrimbleIncident, 'id' | 'timestamp' | 'missionId'>): { ok: boolean; reason?: string; incidentId?: string } => {
    let outcome: { ok: boolean; reason?: string; incidentId?: string } = { ok: false };
    setState((s) => {
      if (!s.activeMissionId) { outcome = { ok: false, reason: 'No hay misión Trimble abierta' }; return s; }
      if ((s.trimbleIncidents?.length ?? 0) >= 10_000) { outcome = { ok: false, reason: 'Límite de incidencias Trimble alcanzado' }; return s; }
      const id = `ti_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const inc: TrimbleIncident = {
        ...data,
        id,
        missionId: s.activeMissionId,
        timestamp: new Date().toISOString(),
      };
      outcome = { ok: true, incidentId: id };
      return { ...s, trimbleIncidents: [...(s.trimbleIncidents ?? []), inc] };
    }, true);
    if (outcome.ok && outcome.incidentId) {
      logEvent('TRIMBLE_INCIDENT_RECORDED', { payload: { incidentId: outcome.incidentId } });
    }
    return outcome;
  }, [setState]);

  const linkTrimbleDeliverable = useCallback((data: Omit<TrimbleDeliverable, 'id' | 'uploadedAt'>): { ok: boolean; reason?: string; deliverableId?: string } => {
    let outcome: { ok: boolean; reason?: string; deliverableId?: string } = { ok: false };
    setState((s) => {
      if ((s.trimbleDeliverables?.length ?? 0) >= 50_000) { outcome = { ok: false, reason: 'Límite de entregables alcanzado' }; return s; }
      const id = `td_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const deliverable: TrimbleDeliverable = { ...data, id, uploadedAt: new Date().toISOString() };
      outcome = { ok: true, deliverableId: id };
      return { ...s, trimbleDeliverables: [...(s.trimbleDeliverables ?? []), deliverable] };
    }, true);
    if (outcome.ok && outcome.deliverableId) {
      logEvent('TRIMBLE_DELIVERABLE_LINKED', { payload: { deliverableId: outcome.deliverableId } });
    }
    return outcome;
  }, [setState]);

  const unlinkTrimbleDeliverable = useCallback((deliverableId: string): { ok: boolean; reason?: string } => {
    let outcome: { ok: boolean; reason?: string } = { ok: false };
    setState((s) => {
      const exists = (s.trimbleDeliverables ?? []).some((d) => d.id === deliverableId);
      if (!exists) { outcome = { ok: false, reason: 'Entregable no encontrado' }; return s; }
      outcome = { ok: true };
      return { ...s, trimbleDeliverables: (s.trimbleDeliverables ?? []).filter((d) => d.id !== deliverableId) };
    }, true);
    if (outcome.ok) {
      logEvent('TRIMBLE_DELIVERABLE_UNLINKED', { payload: { deliverableId } });
    }
    return outcome;
  }, [setState]);

  /** Append-only de punto GPS Trimble. Aviso/bloqueo a 100k por run. */
  const appendTrimbleGpsPoint = useCallback((point: TrimbleGpsPoint): { ok: boolean; reason?: string } => {
    let outcome: { ok: boolean; reason?: string } = { ok: false };
    setState((s) => {
      const byRun = s.trimbleGpsLogsByRun ?? {};
      const prev = byRun[point.runId] ?? [];
      if (prev.length >= 100_000) { outcome = { ok: false, reason: 'Límite GPS Trimble del run alcanzado' }; return s; }
      outcome = { ok: true };
      return { ...s, trimbleGpsLogsByRun: { ...byRun, [point.runId]: [...prev, point] } };
    });
    return outcome;
  }, [setState]);

  /**
   * Inicia una sesión de grabación continua Trimble. Requiere modo Trimble,
   * misión y pasada activas. NO valida estado del GPS — eso lo hace la UI
   * antes de invocar.
   */
  const startTrimbleRecording = useCallback(
    (opts: { startPosition?: LatLng; notes?: string } = {}): { ok: boolean; reason?: string; recordingId?: string } => {
      let outcome: { ok: boolean; reason?: string; recordingId?: string } = { ok: false };
      setState((s) => {
        if (s.acquisitionMode !== 'TRIMBLE_LIDAR') { outcome = { ok: false, reason: 'Modo Trimble inactivo' }; return s; }
        if (!s.activeMissionId || !s.activeRunId) { outcome = { ok: false, reason: 'Necesitas misión y pasada abiertas' }; return s; }
        if (s.activeTrimbleRecordingId) { outcome = { ok: false, reason: 'Ya hay una grabación activa' }; return s; }
        const id = `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const session: TrimbleRecordingSession = {
          id,
          missionId: s.activeMissionId,
          runId: s.activeRunId,
          startedAt: new Date().toISOString(),
          endedAt: null,
          startPosition: opts.startPosition,
          notes: opts.notes,
          status: 'active',
          invalidatedAt: null,
          invalidatedReason: null,
        };
        outcome = { ok: true, recordingId: id };
        return {
          ...s,
          trimbleRecordingSessions: [...(s.trimbleRecordingSessions ?? []), session],
          activeTrimbleRecordingId: id,
        };
      }, true);
      if (outcome.ok && outcome.recordingId) {
        logEvent('TRIMBLE_RECORDING_STARTED', {
          payload: { recordingSessionId: outcome.recordingId, startPosition: opts.startPosition ?? null },
        });
      }
      return outcome;
    },
    [setState],
  );

  /**
   * Cierra la grabación activa, analiza cobertura GPS sobre los tramos
   * candidatos (capas activas, estado pendiente/repetir) y genera capturas
   * automáticas para los tramos que cumplen las reglas de cobertura.
   */
  const closeTrimbleRecording = useCallback(
    (opts: { endPosition?: LatLng; eligibleSegmentIds?: ReadonlySet<string> } = {}): {
      ok: boolean;
      reason?: string;
      autoCapturedCount?: number;
      partialCount?: number;
      pointsAnalyzed?: number;
    } => {
      let outcome: ReturnType<typeof closeTrimbleRecording> = { ok: false };
      let captured: ReturnType<typeof analyzeTrimbleGpsCoverage>['captured'] = [];
      let partials: ReturnType<typeof analyzeTrimbleGpsCoverage>['partial'] = [];
      let recordingIdCommitted: string | null = null;
      let pointsAnalyzed = 0;

      setState((s) => {
        const recordingId = s.activeTrimbleRecordingId;
        if (!recordingId) { outcome = { ok: false, reason: 'No hay grabación activa' }; return s; }
        const session = (s.trimbleRecordingSessions ?? []).find((r) => r.id === recordingId);
        if (!session) { outcome = { ok: false, reason: 'Sesión no encontrada' }; return s; }
        if (!s.route) { outcome = { ok: false, reason: 'Sin ruta' }; return s; }

        const now = new Date().toISOString();
        const allPoints = (s.trimbleGpsLogsByRun?.[session.runId] ?? []).filter(
          (p) => p.recordingSessionId === recordingId && p.phase === 'capture',
        );
        pointsAnalyzed = allPoints.length;

        const elig = opts.eligibleSegmentIds ?? null;
        // Solo se admiten tramos en estado operativo 'pendiente' o 'repetir'.
        // Se excluyen capturados, procesados, descartados, no_capturable,
        // tramos con incidencia bloqueante y tramos marcados nonRecordable.
        const TERMINAL_FIELD: ReadonlySet<TrimbleFieldStatus> = new Set([
          'capturado_pendiente_proceso', 'no_capturable', 'en_captura',
        ]);
        const capturesByseg = new Map<string, SegmentCapture[]>();
        for (const c of (s.trimbleSegmentCaptures ?? [])) {
          const arr = capturesByseg.get(c.segmentId) ?? [];
          arr.push(c);
          capturesByseg.set(c.segmentId, arr);
        }
        const blockedBySegmentIncident = new Set<string>();
        for (const inc of (s.trimbleIncidents ?? [])) {
          if (!inc.segmentId) continue;
          if (inc.severity === 'bloqueante' || inc.invalidatesRun) {
            blockedBySegmentIncident.add(inc.segmentId);
          }
        }
        const isEligibleField = (segId: string): boolean => {
          const arr = capturesByseg.get(segId) ?? [];
          if (arr.length === 0) return true; // pendiente
          for (const c of arr) {
            if (TERMINAL_FIELD.has(c.fieldStatus)) return false;
            if (c.qaStatus === 'procesado_ok' || c.qaStatus === 'descartado_por_calidad') return false;
          }
          return arr.every((c) => c.fieldStatus === 'repetir');
        };

        const candidates = s.route.segments.filter((seg) => {
          if (elig && !elig.has(seg.id)) return false;
          if (seg.nonRecordable) return false;
          if (blockedBySegmentIncident.has(seg.id)) return false;
          if (!isEligibleField(seg.id)) return false;
          return true;
        });

        const report = analyzeTrimbleGpsCoverage(allPoints, candidates);
        captured = report.captured;
        partials = report.partial;
        recordingIdCommitted = recordingId;

        const newCaptures: SegmentCapture[] = captured.map((c) => ({
          id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          segmentId: c.segmentId,
          runId: session.runId,
          missionId: session.missionId,
          startedAt: c.startedAt,
          endedAt: c.endedAt,
          startPosition: c.startPosition,
          endPosition: c.endPosition,
          fieldStatus: 'capturado_pendiente_proceso',
          fieldNotes: 'Auto-detectado por cobertura GPS Trimble',
          qaStatus: null,
          captureSource: 'gps_auto',
          recordingSessionId: recordingId,
          coverageRatio: c.coverageRatio,
          matchedPoints: c.matchedPoints,
        }));

        const sessions = (s.trimbleRecordingSessions ?? []).map((r) =>
          r.id === recordingId
            ? { ...r, endedAt: now, endPosition: opts.endPosition ?? r.endPosition, status: 'closed' as const }
            : r,
        );

        outcome = {
          ok: true,
          autoCapturedCount: captured.length,
          partialCount: partials.length,
          pointsAnalyzed,
        };

        return {
          ...s,
          trimbleRecordingSessions: sessions,
          activeTrimbleRecordingId: null,
          trimbleSegmentCaptures: [...(s.trimbleSegmentCaptures ?? []), ...newCaptures],
        };
      }, true);

      if (outcome.ok && recordingIdCommitted) {
        logEvent('TRIMBLE_RECORDING_CLOSED', {
          payload: {
            recordingSessionId: recordingIdCommitted,
            pointsAnalyzed,
            autoCapturedCount: captured.length,
            partialCount: partials.length,
          },
        });
        for (const c of captured) {
          logEvent('TRIMBLE_SEGMENT_AUTO_CAPTURED', {
            segmentId: c.segmentId,
            payload: {
              recordingSessionId: recordingIdCommitted,
              coverageRatio: c.coverageRatio,
              startProgress: c.startProgress,
              endProgress: c.endProgress,
              matchedPoints: c.matchedPoints,
            },
          });
        }
        for (const p of partials) {
          logEvent('TRIMBLE_SEGMENT_PARTIAL_COVERAGE', {
            segmentId: p.segmentId,
            payload: {
              recordingSessionId: recordingIdCommitted,
              coverageRatio: p.coverageRatio,
              reason: p.reason,
            },
          });
        }
      }
      return outcome;
    },
    [setState],
  );

  /**
   * Invalida la grabación activa: NO genera SegmentCapture, NO consolida
   * cobertura. Marca la sesión como 'invalidated' y limpia el id activo.
   * Los colores live desaparecen automáticamente al perderse la sesión activa.
   */
  const invalidateTrimbleRecording = useCallback(
    (reason: string): { ok: boolean; reason?: string; recordingId?: string } => {
      let outcome: { ok: boolean; reason?: string; recordingId?: string } = { ok: false };
      let invalidatedId: string | null = null;
      setState((s) => {
        const recordingId = s.activeTrimbleRecordingId;
        if (!recordingId) { outcome = { ok: false, reason: 'No hay grabación activa' }; return s; }
        const now = new Date().toISOString();
        const sessions = (s.trimbleRecordingSessions ?? []).map((r) =>
          r.id === recordingId
            ? { ...r, status: 'invalidated' as const, invalidatedAt: now, invalidatedReason: reason, endedAt: r.endedAt ?? now }
            : r,
        );
        invalidatedId = recordingId;
        outcome = { ok: true, recordingId };
        return { ...s, trimbleRecordingSessions: sessions, activeTrimbleRecordingId: null };
      }, true);
      if (outcome.ok && invalidatedId) {
        logEvent('TRIMBLE_RECORDING_INVALIDATED', {
          payload: { recordingSessionId: invalidatedId, reason },
        });
      }
      return outcome;
    },
    [setState],
  );
  const restoreState = useCallback((restored: AppState) => {
    // R3: Always start with navigation off — operator must re-enable explicitly
    const sanitized: AppState = {
      ...restored,
      navigationActive: false,
      activeSegmentId: null,
      // Close any active track session — will be re-opened on next segment start
      trackSession: restored.trackSession && restored.trackSession.active
        ? { ...restored.trackSession, active: false, endedAt: new Date().toISOString() }
        : restored.trackSession,
    };
    setStateRaw(sanitized);
    if (restored.navigationActive) {
      logEvent('NAV_STATE_CHANGED', { payload: { recovery: true, reason: 'app_restart' } });
    }
  }, []);

  /** Cancel a segment that was started by error — clean revert to pendiente */
  const cancelStartSegment = useCallback((segmentId: string) => {
    setState((s) => {
      let newState = revertSegmentToPending(s, segmentId);
      if (newState === s) return s; // no-op if segment wasn't en_progreso

      // Recalculate activeSegmentId to next pending (navigation stays active)
      if (newState.route) {
        const remaining = newState.route.optimizedOrder.filter((id) => {
          const seg = newState.route!.segments.find((seg) => seg.id === id);
          return seg?.status === 'pendiente' && !seg.nonRecordable;
        });
        newState = { ...newState, activeSegmentId: remaining[0] || null };
      }

      return newState;
    }, true);
    logEvent('SEGMENT_CANCELLED', { segmentId, payload: { reason: 'operator_cancel' } });
  }, [setState]);

  /** Cancel ALL en_progreso segments in a single setState — batch operation */
  const cancelAllInProgress = useCallback((reason: CancelReason) => {
    let revertedIds: string[] = [];
    setState((s) => {
      const result = revertAllInProgress(s);
      revertedIds = result.revertedIds;
      if (revertedIds.length === 0) return s;
      return { ...result.state, activeSegmentId: null };
    }, true);
    // Emit one event per reverted segment (after setState)
    setTimeout(() => {
      for (const id of revertedIds) {
        logEvent('SEGMENT_CANCELLED', { segmentId: id, payload: { reason } });
      }
    }, 0);
  }, [setState]);

  return {
    state,
    isDirty,
    markClean,
    setRoute,
    startNavigation,
    prepareNavigationStart,
    confirmNavigationStart,
    stopNavigation,
    prepareStopNavigation,
    confirmStopNavigation,
    confirmStartSegment,
    completeSegment,
    addIncident,
    reoptimize,
    resetSegment,
    clearRoute,
    setActiveSegment,
    setBase,
    updateSegment,
    updateIncident,
    deleteIncident,
    addLayer,
    renameLayer,
    deleteLayer,
    moveSegmentToLayer,
    mergeSegments,
    addSegment,
    deleteSegment,
    bulkDeleteSegments,
    bulkMoveToLayer,
    bulkSetColor,
    duplicateSegments,
    reorderSegment,
    reverseSegment,
    simplifySegments,
    setRstMode,
    setRstGroupSize,
    markPosibleRepetir,
    repeatSegment,
    finalizeTrack,
    skipSegment,
    closeBlockEndPrompt,
    changeWorkDay,
    updateRouteContext,
    applyRetroactiveIds,
    setAcquisitionMode,
    applyRouteOrder,
    restoreState,
    cancelStartSegment,
    cancelAllInProgress,
    reactivateSegmentForField,
    setSegmentCorrections,
    readCommittedState,
    appendTrackGpsPoint,
    // Trimble (fase 1)
    startTrimbleMission,
    closeTrimbleMission,
    startTrimbleRun,
    closeTrimbleRun,
    invalidateTrimbleRun,
    startTrimbleCapture,
    closeTrimbleCapture,
    setTrimbleQaStatus,
    recordTrimbleIncident,
    linkTrimbleDeliverable,
    unlinkTrimbleDeliverable,
    appendTrimbleGpsPoint,
    startTrimbleRecording,
    closeTrimbleRecording,
  };
}
