/**
 * One-time migration from localStorage to SQLite.
 * Safe: if migration fails, localStorage is NOT deleted.
 * 
 * After successful migration, localStorage is never read or written again
 * for app state purposes.
 */

import type { AppState } from '@/types/route';
import { initDatabase, saveStateToDB, loadStateFromDB } from './db';
import { logEvent } from './event-log';
import { LEGACY_STORAGE_KEY, LEGACY_MIGRATION_FLAG } from './types';

function parseAppStateDefaults(parsed: any): AppState {
  if (!('trackSession' in parsed)) parsed.trackSession = null;
  if (!('blockEndPrompt' in parsed))
    parsed.blockEndPrompt = { isOpen: false, trackNumber: null, reason: 'capacity' };
  if (!('workDay' in parsed)) parsed.workDay = 1;
  if (!('acquisitionMode' in parsed)) parsed.acquisitionMode = 'RST';
  return parsed as AppState;
}

const DEFAULT_STATE: AppState = {
  route: null,
  incidents: [],
  activeSegmentId: null,
  navigationActive: false,
  currentPosition: null,
  base: null,
  rstMode: false,
  rstGroupSize: 3,
  trackSession: null,
  blockEndPrompt: { isOpen: false, trackNumber: null, reason: 'capacity' },
  workDay: 1,
  acquisitionMode: 'RST',
};

/**
 * Initialize SQLite, attempt migration from localStorage if needed,
 * and return the loaded AppState.
 * 
 * This is the ONLY entry point for app startup persistence.
 * Returns the state from SQLite (single source of truth).
 */
export async function migrateAndLoad(): Promise<AppState> {
  // 1. Initialize SQLite database
  await initDatabase();

  // 2. Try loading existing state from SQLite
  try {
    const existing = await loadStateFromDB();
    if (existing) {
      return parseAppStateDefaults(existing);
    }
  } catch (e) {
    console.error('Failed to load from SQLite:', e);
  }

  // 3. Check if migration was already done (no data in SQLite = clean state)
  try {
    if (localStorage.getItem(LEGACY_MIGRATION_FLAG) === 'true') {
      return DEFAULT_STATE;
    }
  } catch { /* ignore */ }

  // 4. Attempt legacy migration from localStorage → SQLite
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;

    const parsed = JSON.parse(raw);
    const state = parseAppStateDefaults(parsed);

    // Write to SQLite
    await saveStateToDB(state);

    // Mark migration done (this is the LAST write to localStorage, ever)
    try {
      localStorage.setItem(LEGACY_MIGRATION_FLAG, 'true');
    } catch { /* non-critical */ }

    // Log migration event
    await logEvent('MIGRATION_FROM_LOCALSTORAGE', {
      workDay: state.workDay,
      payload: {
        segmentCount: state.route?.segments?.length ?? 0,
        incidentCount: state.incidents?.length ?? 0,
        hadTrackSession: !!state.trackSession,
      },
    });

    console.info('Migration from localStorage to SQLite complete.');
    return state;
  } catch (e) {
    console.error('Migration from localStorage failed (legacy data preserved):', e);
    // Last resort: try to parse localStorage for this session only
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw) return parseAppStateDefaults(JSON.parse(raw));
    } catch { /* ignore */ }
    return DEFAULT_STATE;
  }
}
