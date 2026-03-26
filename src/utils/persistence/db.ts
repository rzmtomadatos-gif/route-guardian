/**
 * IndexedDB persistence layer for VialRoute.
 * Works in browser and Capacitor WebView.
 * Designed so the backing store can be swapped to native SQLite later.
 */

import type { AppState } from '@/types/route';
import {
  DB_NAME,
  DB_VERSION,
  STORE_STATE,
  STORE_EVENTS,
  STATE_KEY,
  type PersistentEvent,
} from './types';

let dbInstance: IDBDatabase | null = null;
let dbReady: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);
  if (dbReady) return dbReady;

  dbReady = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_STATE)) {
        db.createObjectStore(STORE_STATE);
      }
      if (!db.objectStoreNames.contains(STORE_EVENTS)) {
        const evtStore = db.createObjectStore(STORE_EVENTS, { keyPath: 'eventId' });
        evtStore.createIndex('by_timestamp', 'timestamp', { unique: false });
        evtStore.createIndex('by_type', 'eventType', { unique: false });
      }
    };

    req.onsuccess = () => {
      dbInstance = req.result;
      resolve(dbInstance);
    };

    req.onerror = () => {
      console.error('IndexedDB open failed:', req.error);
      reject(req.error);
    };
  });

  return dbReady;
}

// ── State persistence ───────────────────────────────────────────

export async function saveStateToDB(state: AppState): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STATE, 'readwrite');
    tx.objectStore(STORE_STATE).put(state, STATE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadStateFromDB(): Promise<AppState | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STATE, 'readonly');
    const req = tx.objectStore(STORE_STATE).get(STATE_KEY);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function clearStateDB(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STATE, 'readwrite');
    tx.objectStore(STORE_STATE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Event log ───────────────────────────────────────────────────

export async function appendEvent(evt: PersistentEvent): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EVENTS, 'readwrite');
    tx.objectStore(STORE_EVENTS).add(evt);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function appendEvents(events: PersistentEvent[]): Promise<void> {
  if (events.length === 0) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EVENTS, 'readwrite');
    const store = tx.objectStore(STORE_EVENTS);
    events.forEach((e) => store.add(e));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllEvents(): Promise<PersistentEvent[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EVENTS, 'readonly');
    const req = tx.objectStore(STORE_EVENTS).index('by_timestamp').getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function clearEventsDB(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EVENTS, 'readwrite');
    tx.objectStore(STORE_EVENTS).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getEventCount(): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EVENTS, 'readonly');
    const req = tx.objectStore(STORE_EVENTS).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
