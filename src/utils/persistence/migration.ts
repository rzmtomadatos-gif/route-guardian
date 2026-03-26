/**
 * One-time migration from localStorage to IndexedDB.
 * Safe: if migration fails, localStorage is NOT deleted.
 */

import type { AppState } from '@/types/route';
import { saveStateToDB, loadStateFromDB } from './db';
import { logEvent } from './event-log';

const LEGACY_KEY = 'vialroute_state';
const MIGRATION_DONE_KEY = 'vialroute_migration_idb_done';

function parseAppStateDefaults(parsed: any): AppState {
  if (!('trackSession' in parsed)) parsed.trackSession = null;
  if (!('blockEndPrompt' in parsed))
    parsed.blockEndPrompt = { isOpen: false, trackNumber: null, reason: 'capacity' };
  if (!('workDay' in parsed)) parsed.workDay = 1;
  if (!('acquisitionMode' in parsed)) parsed.acquisitionMode = 'RST';
  return parsed as AppState;
}

/**
 * Attempt migration from localStorage → IndexedDB.
 * Returns the loaded AppState (from IDB or legacy) or default.
 */
export async function migrateAndLoad(): Promise<AppState> {
  const defaultState: AppState = {
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

  // 1. Try IndexedDB first
  try {
    const existing = await loadStateFromDB();
    if (existing) {
      return parseAppStateDefaults(existing);
    }
  } catch (e) {
    console.error('Failed to load from IndexedDB:', e);
  }

  // 2. Check migration flag
  try {
    if (localStorage.getItem(MIGRATION_DONE_KEY) === 'true') {
      // Migration was done but IDB is empty → return default
      return defaultState;
    }
  } catch { /* ignore */ }

  // 3. Attempt legacy migration
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return defaultState;

    const parsed = JSON.parse(raw);
    const state = parseAppStateDefaults(parsed);

    // Persist to IndexedDB
    await saveStateToDB(state);

    // Mark migration done
    try {
      localStorage.setItem(MIGRATION_DONE_KEY, 'true');
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

    console.info('Migration from localStorage to IndexedDB complete.');
    return state;
  } catch (e) {
    console.error('Migration from localStorage failed (legacy data preserved):', e);
    // Fallback: try to read localStorage directly for this session
    try {
      const raw = localStorage.getItem(LEGACY_KEY);
      if (raw) return parseAppStateDefaults(JSON.parse(raw));
    } catch { /* ignore */ }
    return defaultState;
  }
}
