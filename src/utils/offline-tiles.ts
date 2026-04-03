/**
 * Offline Tile Management for VialRoute
 *
 * Manages PMTiles files stored in IndexedDB for true offline cartography.
 * PMTiles is a single-file archive format for map tiles that can be
 * served directly to Leaflet via protomaps-leaflet without a tile server.
 */

export interface OfflineTileSource {
  id: string;
  name: string;
  /** File size in bytes */
  size: number;
  /** Bounding box [west, south, east, north] */
  bounds: [number, number, number, number];
  /** When was this source added */
  addedAt: string;
  /** Storage type */
  storage: 'indexeddb' | 'filesystem';
}

const IDB_STORE_NAME = 'vialroute_tiles';
export const ACTIVE_OFFLINE_MAP_KEY = 'vialroute_active_offline_map';
export const OFFLINE_MAP_MODE_KEY = 'vialroute_offline_map_mode';

/** Custom event name for same-tab offline map changes */
export const OFFLINE_MAP_CHANGED_EVENT = 'vialroute:offline-map-changed';

export type OfflineMapMode = 'auto' | 'offline';

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // ignore storage failures
  }
}

/** Dispatch a same-tab event when offline map selection changes */
export function notifyOfflineMapChanged() {
  window.dispatchEvent(new CustomEvent(OFFLINE_MAP_CHANGED_EVENT));
}

export function getActiveOfflineMapId(): string | null {
  return readStorage(ACTIVE_OFFLINE_MAP_KEY);
}

export function setActiveOfflineMapId(id: string | null) {
  writeStorage(ACTIVE_OFFLINE_MAP_KEY, id);
  notifyOfflineMapChanged();
}

export function getOfflineMapMode(): OfflineMapMode {
  return readStorage(OFFLINE_MAP_MODE_KEY) === 'offline' ? 'offline' : 'auto';
}

export function setOfflineMapMode(mode: OfflineMapMode) {
  writeStorage(OFFLINE_MAP_MODE_KEY, mode);
  notifyOfflineMapChanged();
}

export function clearOfflineMapSelection() {
  writeStorage(ACTIVE_OFFLINE_MAP_KEY, null);
  writeStorage(OFFLINE_MAP_MODE_KEY, 'auto');
  notifyOfflineMapChanged();
}

export function shouldUseOfflineMap(isOnline = navigator.onLine): boolean {
  const activeId = getActiveOfflineMapId();
  if (!activeId) return false;
  return getOfflineMapMode() === 'offline' || !isOnline;
}

function openTileIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_STORE_NAME, 1);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains('sources')) {
        idb.createObjectStore('sources', { keyPath: 'id' });
      }
      if (!idb.objectStoreNames.contains('files')) {
        idb.createObjectStore('files');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Read bounds from a PMTiles header.
 * Returns [west, south, east, north] or null if unreadable.
 */
async function readPMTilesBounds(
  buffer: ArrayBuffer,
): Promise<[number, number, number, number] | null> {
  try {
    const { PMTiles } = await import('pmtiles');

    const source = {
      getBytes: async (offset: number, length: number) => {
        const slice = buffer.slice(offset, offset + length);
        return { data: new Uint8Array(slice) };
      },
      getKey: () => 'memory',
    };

    const pm = new PMTiles(source as any);
    const header = await pm.getHeader();

    if (
      header.minLon !== undefined &&
      header.minLat !== undefined &&
      header.maxLon !== undefined &&
      header.maxLat !== undefined &&
      !(header.minLon === 0 && header.minLat === 0 && header.maxLon === 0 && header.maxLat === 0)
    ) {
      return [header.minLon, header.minLat, header.maxLon, header.maxLat];
    }
    return null;
  } catch (e) {
    console.warn('Could not read PMTiles header bounds:', e);
    return null;
  }
}

export async function listOfflineTileSources(): Promise<OfflineTileSource[]> {
  try {
    const idb = await openTileIDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction('sources', 'readonly');
      const req = tx.objectStore('sources').getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

/**
 * Store a PMTiles file in IndexedDB and register it as a source.
 * Reads real bounds from the PMTiles header when possible.
 */
export async function addOfflineTileSource(
  file: File,
  name: string,
): Promise<OfflineTileSource> {
  const id = `tiles_${Date.now()}`;
  const buffer = await file.arrayBuffer();
  const realBounds = await readPMTilesBounds(buffer);
  const idb = await openTileIDB();

  await new Promise<void>((resolve, reject) => {
    const tx = idb.transaction('files', 'readwrite');
    tx.objectStore('files').put(buffer, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  const source: OfflineTileSource = {
    id,
    name,
    size: buffer.byteLength,
    bounds: realBounds ?? [-180, -90, 180, 90],
    addedAt: new Date().toISOString(),
    storage: 'indexeddb',
  };

  await new Promise<void>((resolve, reject) => {
    const tx = idb.transaction('sources', 'readwrite');
    tx.objectStore('sources').put(source);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return source;
}

export async function removeOfflineTileSource(id: string): Promise<void> {
  const idb = await openTileIDB();
  await new Promise<void>((resolve, reject) => {
    const tx = idb.transaction(['sources', 'files'], 'readwrite');
    tx.objectStore('sources').delete(id);
    tx.objectStore('files').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getOfflineTileData(id: string): Promise<ArrayBuffer | null> {
  try {
    const idb = await openTileIDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction('files', 'readonly');
      const req = tx.objectStore('files').get(id);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export function findSourceForPoint(
  sources: OfflineTileSource[],
  lat: number,
  lng: number,
): OfflineTileSource | null {
  return sources.find((s) => {
    const [west, south, east, north] = s.bounds;
    return lng >= west && lng <= east && lat >= south && lat <= north;
  }) ?? null;
}
