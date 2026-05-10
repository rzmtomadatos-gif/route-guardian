/**
 * Storage layer — backed by SQLite via persistence module.
 * 
 * localStorage is NO LONGER used for reads or writes.
 * The only source of truth is SQLite (via sql.js).
 * 
 * This module provides saveState() for useRouteState to call on every
 * state change, and getDefaultState() for initial React state.
 */

import type { AppState } from '@/types/route';
import { saveStateToDB, destroyDatabase } from '@/utils/persistence';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedWrite(state: AppState): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    saveStateToDB(state).catch((e) => console.error('SQLite save error:', e));
  }, 400);
}

function immediateWrite(state: AppState): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  saveStateToDB(state).catch((e) => console.error('SQLite save error:', e));
}

/**
 * Persist full state to SQLite. Called by useRouteState on every state update.
 * Always receives the FULL state — no merging needed.
 */
export function saveState(state: AppState, immediate = false): void {
  try {
    if (immediate) {
      immediateWrite(state);
    } else {
      debouncedWrite(state);
    }
  } catch (e) {
    console.error('Error saving state:', e);
  }
}

/**
 * Returns hardcoded default state for React useState initialization.
 * The real state is loaded asynchronously from SQLite via migrateAndLoad()
 * in App.tsx before the app renders.
 */
export function getDefaultState(): AppState {
  return createEmptyCampaignState();
}

/**
 * Operator/global preferences that survive a campaign reset.
 * NOTE: el resto de ajustes globales (tema, mapa offline, API keys) viven
 * fuera de AppState — en localStorage o en otros stores — y por tanto NO
 * son afectados por crear nueva campaña.
 */
export interface CampaignResetPreferences {
  rstMode?: boolean;
  rstGroupSize?: number;
  acquisitionMode?: AppState['acquisitionMode'];
  base?: AppState['base'];
}

/**
 * Factory canónico de estado limpio para una NUEVA campaña.
 *
 * Resetea TODO lo operativo:
 *  - route, incidents, activeSegmentId, navigationActive
 *  - currentPosition (se recalcula vía GPS)
 *  - trackSession, blockEndPrompt
 *  - workDay = 1, lastConsumedTrackByDay = {}
 *  - segmentCorrections = []
 *  - trackGpsLogsByDay = {}
 *
 * Preserva SOLO preferencias del operador (RST, modo de adquisición, base
 * configurada). El borrado del event_log SQLite se hace en otra capa
 * (`useRouteState.setRoute`) — este factory es puro.
 */
export function createEmptyCampaignState(prefs: CampaignResetPreferences = {}): AppState {
  return {
    route: null,
    incidents: [],
    activeSegmentId: null,
    navigationActive: false,
    currentPosition: null,
    base: prefs.base ?? null,
    rstMode: prefs.rstMode ?? false,
    rstGroupSize: prefs.rstGroupSize ?? 3,
    trackSession: null,
    blockEndPrompt: { isOpen: false, trackNumber: null, reason: 'capacity' as const },
    workDay: 1,
    acquisitionMode: prefs.acquisitionMode ?? 'RST',
    lastConsumedTrackByDay: {},
    segmentCorrections: [],
    trackGpsLogsByDay: {},
    // Trimble (dominio paralelo): vacío en cualquier modo al crear campaña.
    trimbleMissions: [],
    trimbleRuns: [],
    trimbleSegmentCaptures: [],
    trimbleIncidents: [],
    trimbleDeliverables: [],
    trimbleGpsLogsByRun: {},
    activeMissionId: null,
    activeRunId: null,
    trimbleRecordingSessions: [],
    activeTrimbleRecordingId: null,
  };
}

/**
 * Wipe all persisted data (SQLite database).
 * MUST be awaited — not fire-and-forget.
 */
export async function clearAll(): Promise<void> {
  if (debounceTimer) clearTimeout(debounceTimer);
  await destroyDatabase();
}
