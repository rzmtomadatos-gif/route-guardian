/**
 * Storage layer — now backed by IndexedDB via persistence module.
 * localStorage is kept ONLY as synchronous fallback for initial render
 * (React useState needs synchronous init). Async persistence is primary.
 */

import type { AppState } from '@/types/route';
import { saveStateToDB } from '@/utils/persistence';

const STORAGE_KEY = 'vialroute_state';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedWrite(state: AppState): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    // Write to IndexedDB (primary)
    saveStateToDB(state).catch((e) => console.error('IDB save error:', e));
    // Write to localStorage (sync fallback for next cold start)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('localStorage save error:', e);
    }
  }, 400);
}

function immediateWrite(state: AppState): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  // Write to IndexedDB (primary)
  saveStateToDB(state).catch((e) => console.error('IDB save error:', e));
  // Write to localStorage (sync fallback)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('localStorage save error:', e);
  }
}

export function saveState(state: Partial<AppState>, immediate = false): void {
  try {
    const existing = loadState();
    const merged = { ...existing, ...state } as AppState;
    if (immediate) {
      immediateWrite(merged);
    } else {
      debouncedWrite(merged);
    }
  } catch (e) {
    console.error('Error saving state:', e);
  }
}

/**
 * Synchronous load from localStorage — used ONLY for React useState init.
 * The async IndexedDB load happens in App via migrateAndLoad().
 */
export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!('trackSession' in parsed)) parsed.trackSession = null;
      if (!('blockEndPrompt' in parsed)) parsed.blockEndPrompt = { isOpen: false, trackNumber: null, reason: 'capacity' };
      if (!('workDay' in parsed)) parsed.workDay = 1;
      if (!('acquisitionMode' in parsed)) parsed.acquisitionMode = 'RST';
      return parsed;
    }
  } catch (e) {
    console.error('Error loading state:', e);
  }
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

export function saveRoute(route: import('@/types/route').Route): void {
  saveState({ route }, true);
}

export function saveIncidents(incidents: import('@/types/route').Incident[]): void {
  saveState({ incidents }, true);
}

export function clearAll(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  localStorage.removeItem(STORAGE_KEY);
  // Also clear IndexedDB
  import('@/utils/persistence').then(({ clearStateDB, clearEventsDB }) => {
    clearStateDB().catch(console.error);
    clearEventsDB().catch(console.error);
  });
}
