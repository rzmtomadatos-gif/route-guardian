import type { AppState, Route, Incident } from '@/types/route';

const STORAGE_KEY = 'vialroute_state';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedWrite(state: AppState): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('Error saving state:', e);
    }
  }, 400);
}

function immediateWrite(state: AppState): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Error saving state:', e);
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

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
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
  };
}

export function saveRoute(route: Route): void {
  saveState({ route }, true);
}

export function saveIncidents(incidents: Incident[]): void {
  saveState({ incidents }, true);
}

export function clearAll(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  localStorage.removeItem(STORAGE_KEY);
}
