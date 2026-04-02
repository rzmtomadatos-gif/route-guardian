/**
 * Offline Tile Architecture for VialRoute
 *
 * CURRENT STATE:
 * - Leaflet fallback uses remote Carto tiles (requires network)
 * - Google Maps is fully remote (requires network + API key)
 * - When offline, map shows segments/markers but no basemap tiles
 *
 * RECOMMENDED APPROACH: PMTiles + protomaps-leaflet
 *
 * PMTiles is a single-file archive format for map tiles that can be:
 * - Stored in IndexedDB or as a file on the device
 * - Served directly to Leaflet without a tile server
 * - Generated for specific regions (e.g., a province or country)
 *
 * IMPLEMENTATION PLAN:
 * 1. Add `protomaps-leaflet` package (lightweight Leaflet plugin for PMTiles)
 * 2. User downloads a regional PMTiles file (e.g., Spain = ~3GB, province = ~200MB)
 * 3. File is stored via File System API or IndexedDB
 * 4. MapDisplay detects offline + available PMTiles → uses local tiles
 * 5. Online: normal remote tiles. Offline with PMTiles: local vector tiles.
 *    Offline without PMTiles: no basemap (current behavior)
 *
 * TILE SOURCES:
 * - Protomaps: https://protomaps.com/downloads (free OpenStreetMap extracts)
 * - Planetiler: self-generate from OSM PBF files
 * - PMTiles can also be generated per-project from known segment bounding boxes
 *
 * SIZE ESTIMATES (PMTiles, vector, with roads+labels):
 * - Single province: ~50-200 MB
 * - Single country (Spain): ~2-4 GB
 * - Custom extract (project bbox + buffer): ~10-100 MB
 *
 * This module provides the scaffolding for managing offline tile sources.
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

/**
 * Open the IndexedDB store for tile sources metadata.
 */
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
 * List all registered offline tile sources.
 */
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
 * For files > ~50MB, consider using the File System Access API instead.
 */
export async function addOfflineTileSource(
  file: File,
  name: string,
  bounds: [number, number, number, number],
): Promise<OfflineTileSource> {
  const id = `tiles_${Date.now()}`;
  const buffer = await file.arrayBuffer();

  const idb = await openTileIDB();

  // Store the binary
  await new Promise<void>((resolve, reject) => {
    const tx = idb.transaction('files', 'readwrite');
    tx.objectStore('files').put(buffer, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // Store metadata
  const source: OfflineTileSource = {
    id,
    name,
    size: buffer.byteLength,
    bounds,
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

/**
 * Remove an offline tile source and its data.
 */
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

/**
 * Retrieve the PMTiles ArrayBuffer for a given source.
 * Returns null if not found.
 */
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

/**
 * Check if any offline tile source covers a given point.
 */
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
