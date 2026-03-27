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
  return {
    route: null,
    incidents: [],
    activeSegmentId: null,
    navigationActive: false,
    currentPosition: null,
    base: null,
    rstMode: false,
    rstGroupSize: 3,
    trackSession: null,
    blockEndPrompt: { isOpen: false, trackNumber: null, reason: 'capacity' as const },
    workDay: 1,
    acquisitionMode: 'RST' as const,
  };
}

/**
 * Wipe all persisted data (SQLite database).
 */
export function clearAll(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  destroyDatabase().catch(console.error);
}
