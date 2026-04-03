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

/** Max file size for IndexedDB storage (2 GB) */
export const MAX_TILE_FILE_SIZE = 2 * 1024 * 1024 * 1024;

/** Regional extract catalog with bounding boxes for CLI extraction */
export interface RegionExtract {
  id: string;
  name: string;
  /** Approximate size at maxzoom 15 */
  approxSize: string;
  /** Bounding box for pmtiles extract CLI: west,south,east,north */
  bbox: string;
  /** Flag emoji */
  flag: string;
}

export const REGION_CATALOG: RegionExtract[] = [
  { id: 'spain', name: 'España', approxSize: '~600 MB', bbox: '-9.39,36.00,3.35,43.79', flag: '🇪🇸' },
  { id: 'portugal', name: 'Portugal', approxSize: '~100 MB', bbox: '-9.52,36.96,-6.19,42.15', flag: '🇵🇹' },
  { id: 'france', name: 'Francia', approxSize: '~800 MB', bbox: '-5.14,41.33,9.56,51.09', flag: '🇫🇷' },
  { id: 'iberia', name: 'Península Ibérica', approxSize: '~700 MB', bbox: '-9.52,36.00,3.35,43.79', flag: '🇪🇸🇵🇹' },
  { id: 'italy', name: 'Italia', approxSize: '~500 MB', bbox: '6.63,36.62,18.52,47.09', flag: '🇮🇹' },
  { id: 'germany', name: 'Alemania', approxSize: '~700 MB', bbox: '5.87,47.27,15.04,55.06', flag: '🇩🇪' },
];

/**
 * Get the pmtiles extract CLI command for a region.
 * Uses the latest daily build from Protomaps.
 */
export function getExtractCommand(region: RegionExtract): string {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  return `pmtiles extract https://build.protomaps.com/${dateStr}.pmtiles ${region.id}.pmtiles --bbox=${region.bbox}`;
}

export type OfflineMapMode = 'auto' | 'offline';

const IDB_STORE_NAME = 'vialroute_tiles';
export const ACTIVE_OFFLINE_MAP_KEY = 'vialroute_active_offline_map';
export const OFFLINE_MAP_MODE_KEY = 'vialroute_offline_map_mode';

/** Custom event name for same-tab offline map changes */
export const OFFLINE_MAP_CHANGED_EVENT = 'vialroute:offline-map-changed';

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
/**
 * Store a PMTiles file in IndexedDB and register it as a source.
 * Validates file size before loading into memory.
 * Reads real bounds from the PMTiles header when possible.
 */
export async function addOfflineTileSource(
  file: File,
  name: string,
): Promise<OfflineTileSource> {
  if (file.size > MAX_TILE_FILE_SIZE) {
    throw new Error(
      `El archivo (${(file.size / (1024 * 1024 * 1024)).toFixed(1)} GB) supera el límite de 2 GB para almacenamiento offline. Usa un extracto regional más pequeño.`
    );
  }

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

/** Info about the tile cache */
export interface TileCacheInfo {
  tileCount: number;
  /** Estimated size is unavailable from Cache API, so we just count */
}

/** Get real stats about the runtime tile cache */
export async function getTileCacheInfo(): Promise<TileCacheInfo | null> {
  try {
    if (!('caches' in window)) return null;
    const cache = await caches.open('map-tiles');
    const keys = await cache.keys();
    return { tileCount: keys.length };
  } catch {
    return null;
  }
}

/** Clear the runtime tile cache */
export async function clearTileCache(): Promise<void> {
  try {
    if (!('caches' in window)) return;
    await caches.delete('map-tiles');
  } catch {
    // ignore
  }
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
