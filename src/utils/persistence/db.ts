/**
 * SQLite persistence layer for VialRoute.
 * 
 * ARCHITECTURE NOTE (Phase 1):
 * This is NOT native SQLite via Capacitor. It uses sql.js, a WebAssembly
 * build of SQLite that runs entirely in the browser. The database binary
 * is persisted as an opaque blob in IndexedDB (the browser's only API
 * for large binary storage). IndexedDB is used ONLY as a filesystem
 * substitute to store the .db bytes — all queries run through sql.js.
 * 
 * OFFLINE RESILIENCE:
 * If the WASM binary cannot be loaded (e.g. offline first load without
 * service worker cache), the module falls back to an in-memory-only mode
 * where persistence calls are no-ops. The app renders with defaults and
 * the user sees a warning. On next load with connectivity, full SQLite
 * initializes and picks up any IndexedDB-persisted data.
 * 
 * KNOWN LIMITATION — persist() cost:
 * Every call to persist() exports the ENTIRE database binary and rewrites
 * it to IndexedDB. For Phase 1 this is acceptable because the database is
 * small (state JSON + event log). However, once track points (GPS every
 * 10 m) are added in a future phase, the binary will grow significantly
 * and persist() will need to be replaced with incremental/delta writes
 * or a migration to Capacitor's native SQLite plugin
 * (@capacitor-community/sqlite) which writes directly to the device
 * filesystem without the export/reimport overhead.
 * 
 * MIGRATION PATH to native SQLite (future):
 * 1. Replace sql.js with @capacitor-community/sqlite
 * 2. On first run, detect the IndexedDB blob and import it into native DB
 * 3. Remove IndexedDB blob after successful migration
 * 4. persist() becomes a no-op (native plugin writes to disk directly)
 *
 * This is the SINGLE SOURCE OF TRUTH for app state persistence.
 * localStorage is NOT used for reads or writes — only as a migration source.
 */

// sql.js v1.11 exports CJS, not ESM default — handle both cases
import * as sqlJsModule from 'sql.js';
const initSqlJs: any = (sqlJsModule as any).default ?? sqlJsModule;
type SqlJsDatabase = import('sql.js').Database;
import type { AppState } from '@/types/route';
import {
  DB_NAME,
  SCHEMA_VERSION,
  type PersistentEvent,
} from './types';

// ── Constants ───────────────────────────────────────────────────
const IDB_STORE = 'vialroute_sqlite';
const IDB_KEY = 'db_binary';
const INIT_TIMEOUT_MS = 8000; // Max time to wait for WASM init

// ── Module state ────────────────────────────────────────────────
let db: SqlJsDatabase | null = null;
let initPromise: Promise<SqlJsDatabase | null> | null = null;
/** True when SQLite could not be initialized (offline / WASM failure) */
let degradedMode = false;

/** Returns true if SQLite is NOT available (WASM failed to load) */
export function isDegraded(): boolean {
  return degradedMode;
}

// ── IndexedDB binary storage (opaque backing store) ─────────────

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_STORE, 1);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains('blobs')) {
        idb.createObjectStore('blobs');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadDbBinary(): Promise<Uint8Array | null> {
  const idb = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction('blobs', 'readonly');
    const req = tx.objectStore('blobs').get(IDB_KEY);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function saveDbBinary(data: Uint8Array): Promise<void> {
  const idb = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction('blobs', 'readwrite');
    tx.objectStore('blobs').put(data, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function clearDbBinary(): Promise<void> {
  const idb = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction('blobs', 'readwrite');
    tx.objectStore('blobs').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Schema setup ────────────────────────────────────────────────

function setupSchema(database: SqlJsDatabase): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS event_log (
      event_id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      event_type TEXT NOT NULL,
      work_day INTEGER,
      track_number INTEGER,
      segment_id TEXT,
      payload TEXT
    );
  `);

  database.run(`
    CREATE INDEX IF NOT EXISTS idx_event_timestamp ON event_log(timestamp);
  `);
  database.run(`
    CREATE INDEX IF NOT EXISTS idx_event_type ON event_log(event_type);
  `);

  // Store schema version
  database.run(
    `INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?);`,
    [String(SCHEMA_VERSION)]
  );
}

// ── Persistence helper: flush to IndexedDB ──────────────────────

async function persist(): Promise<void> {
  if (!db) return;
  const data = db.export();
  const buffer = new Uint8Array(data);
  await saveDbBinary(buffer);
}

// ── Timeout utility ─────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${label} (${ms}ms)`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

// ── Init ────────────────────────────────────────────────────────

export async function initDatabase(): Promise<SqlJsDatabase | null> {
  if (db) return db;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      // Load WASM binary from local public/ — NO external CDN dependency.
      // Wrapped in timeout to prevent indefinite hang when offline without cache.
      const SQL: any = await withTimeout(
        initSqlJs({ locateFile: (file: string) => `/${file}` }), INIT_TIMEOUT_MS, 'sql.js WASM init');

      const existing = await loadDbBinary();
      if (existing) {
        db = new SQL.Database(existing);
        // Ensure schema is up to date (safe: CREATE IF NOT EXISTS)
        setupSchema(db);
      } else {
        db = new SQL.Database();
        setupSchema(db);
        await persist();
      }

      degradedMode = false;
      return db;
    } catch (e) {
      console.error('SQLite initialization failed — entering degraded mode:', e);
      degradedMode = true;
      db = null;
      return null;
    }
  })();

  return initPromise;
}

/** Get the initialized database, or null if degraded. */
function getDb(): SqlJsDatabase | null {
  if (degradedMode) return null;
  return db;
}

// ── State persistence ───────────────────────────────────────────

export async function saveStateToDB(state: AppState): Promise<void> {
  const database = getDb();
  if (!database) return; // degraded mode — skip silently
  const json = JSON.stringify(state);
  const now = new Date().toISOString();
  database.run(
    `INSERT OR REPLACE INTO app_state (key, data, updated_at) VALUES ('current', ?, ?);`,
    [json, now]
  );
  await persist();
}

export async function loadStateFromDB(): Promise<AppState | null> {
  const database = getDb();
  if (!database) return null; // degraded mode
  const result = database.exec(`SELECT data FROM app_state WHERE key = 'current';`);
  if (result.length === 0 || result[0].values.length === 0) return null;
  const json = result[0].values[0][0] as string;
  try {
    return JSON.parse(json);
  } catch {
    console.error('Failed to parse state from SQLite');
    return null;
  }
}

export async function clearStateDB(): Promise<void> {
  const database = getDb();
  if (!database) return;
  database.run(`DELETE FROM app_state;`);
  await persist();
}

// ── Event log ───────────────────────────────────────────────────

export async function appendEvent(evt: PersistentEvent): Promise<void> {
  const database = getDb();
  if (!database) return; // degraded mode — event is lost (acceptable for Phase 1)
  database.run(
    `INSERT INTO event_log (event_id, timestamp, event_type, work_day, track_number, segment_id, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?);`,
    [
      evt.eventId,
      evt.timestamp,
      evt.eventType,
      evt.workDay ?? null,
      evt.trackNumber ?? null,
      evt.segmentId ?? null,
      evt.payload ? JSON.stringify(evt.payload) : null,
    ]
  );
  await persist();
}

export async function appendEvents(events: PersistentEvent[]): Promise<void> {
  if (events.length === 0) return;
  const database = getDb();
  if (!database) return;
  const stmt = database.prepare(
    `INSERT INTO event_log (event_id, timestamp, event_type, work_day, track_number, segment_id, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?);`
  );
  for (const evt of events) {
    stmt.run([
      evt.eventId,
      evt.timestamp,
      evt.eventType,
      evt.workDay ?? null,
      evt.trackNumber ?? null,
      evt.segmentId ?? null,
      evt.payload ? JSON.stringify(evt.payload) : null,
    ]);
  }
  stmt.free();
  await persist();
}

export async function getAllEvents(): Promise<PersistentEvent[]> {
  const database = getDb();
  if (!database) return [];
  const result = database.exec(
    `SELECT event_id, timestamp, event_type, work_day, track_number, segment_id, payload
     FROM event_log ORDER BY timestamp ASC;`
  );
  if (result.length === 0) return [];
  return result[0].values.map((row) => ({
    eventId: row[0] as string,
    timestamp: row[1] as string,
    eventType: row[2] as string,
    workDay: row[3] as number | undefined,
    trackNumber: row[4] as number | undefined,
    segmentId: row[5] as string | undefined,
    payload: row[6] ? JSON.parse(row[6] as string) : undefined,
  })) as PersistentEvent[];
}

export async function clearEventsDB(): Promise<void> {
  const database = getDb();
  if (!database) return;
  database.run(`DELETE FROM event_log;`);
  await persist();
}

export async function getEventCount(): Promise<number> {
  const database = getDb();
  if (!database) return 0;
  const result = database.exec(`SELECT COUNT(*) FROM event_log;`);
  if (result.length === 0) return 0;
  return result[0].values[0][0] as number;
}

/**
 * Wipe the entire database (state + events + meta). Used by clearAll.
 * This is AWAITABLE — callers must await to guarantee cleanup before
 * navigating or changing state.
 */
export async function destroyDatabase(): Promise<void> {
  if (db) {
    db.close();
    db = null;
    initPromise = null;
  }
  degradedMode = false;
  await clearDbBinary();
}
