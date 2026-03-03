import type { AppState, Route, Incident } from '@/types/route';

const STORAGE_KEY = 'vialroute_state';

export function saveState(state: Partial<AppState>): void {
  try {
    const existing = loadState();
    const merged = { ...existing, ...state };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
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
  saveState({ route });
}

export function saveIncidents(incidents: Incident[]): void {
  saveState({ incidents });
}

export function clearAll(): void {
  localStorage.removeItem(STORAGE_KEY);
}
