import type { LatLng } from '@/types/route';
import { haversineMeters } from '@/utils/geo-distance';

// =============================================================================
// Tipos
// =============================================================================

export interface OverpassWay {
  /** Mantiene compatibilidad con el código existente. Igual a osmId. */
  id: number;
  /** Identificador OSM explícito. */
  osmId: number;
  name: string;
  /** Referencia carretera/calle si OSM la define. */
  ref?: string;
  highway: string;
  coordinates: LatLng[];
  oneway: boolean;
  /** oneway=-1 ⇒ sentido inverso al orden de nodos */
  onewayReverse: boolean;
}

export type RoadCategory =
  | 'highway'
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'residential'
  | 'track'
  | 'path';

export const ROAD_CATEGORIES: Record<
  RoadCategory,
  { label: string; osmTypes: string[]; description: string }
> = {
  highway: {
    label: 'Autopistas y autovías',
    osmTypes: ['motorway', 'motorway_link', 'trunk', 'trunk_link'],
    description: 'Vías de alta capacidad',
  },
  primary: {
    label: 'Carreteras nacionales',
    osmTypes: ['primary', 'primary_link'],
    description: 'Carreteras principales',
  },
  secondary: {
    label: 'Carreteras comarcales',
    osmTypes: ['secondary', 'secondary_link'],
    description: 'Carreteras secundarias',
  },
  tertiary: {
    label: 'Carreteras locales',
    osmTypes: ['tertiary', 'tertiary_link'],
    description: 'Carreteras terciarias y enlaces',
  },
  residential: {
    label: 'Calles urbanas',
    // En OSM muchas avenidas urbanas relevantes están como secondary/tertiary,
    // no como residential. Se amplía el filtro.
    // Nota: `service` puede traer accesos internos, parkings y vías de servicio.
    // Aceptado por ahora; código preparado para separarlo como subtipo configurable
    // más adelante (p. ej. excluir service, o separarlo en su propia categoría).
    osmTypes: [
      'residential',
      'living_street',
      'tertiary',
      'tertiary_link',
      'secondary',
      'secondary_link',
      'unclassified',
      'service',
      'pedestrian',
    ],
    description: 'Calles dentro de poblaciones',
  },
  track: {
    label: 'Caminos rurales',
    osmTypes: ['track'],
    description: 'Pistas y caminos agrícolas',
  },
  path: {
    label: 'Sendas y peatonales',
    osmTypes: ['path', 'footway', 'cycleway', 'bridleway'],
    description: 'Senderos y vías no motorizadas',
  },
};

export type OverpassErrorKind =
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'empty'
  | 'query'
  | 'aborted'
  | 'unknown';

export class OverpassError extends Error {
  kind: OverpassErrorKind;
  cause?: unknown;
  constructor(kind: OverpassErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = 'OverpassError';
    this.kind = kind;
    this.cause = cause;
  }
}

export interface OverpassOptions {
  signal?: AbortSignal;
  /** Timeout por petición HTTP individual. Default 35s. */
  timeoutMs?: number;
}

// =============================================================================
// Endpoints
// =============================================================================

/**
 * Mirrors públicos de Overpass.
 *
 * IMPORTANTE: son endpoints comunitarios. Pueden fallar, tener cuota,
 * devolver 429/504 o estar offline. Esto es **resiliencia**, no infraestructura.
 *
 * TODO fase futura: caché local por bbox/radio, throttling, cola de peticiones,
 * y posible backend/proxy propio si el volumen lo justifica.
 */
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const DEFAULT_TIMEOUT_MS = 35_000;
const RETRY_DELAYS_MS = [500, 1500];

// =============================================================================
// Utilidades de query
// =============================================================================

function uniqueOsmTypes(categories: RoadCategory[]): string[] {
  const set = new Set<string>();
  for (const c of categories) {
    for (const t of ROAD_CATEGORIES[c].osmTypes) set.add(t);
  }
  return [...set];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildPolyQuery(polygon: LatLng[], categories: RoadCategory[]): string {
  const polyStr = polygon.map((p) => `${p.lat} ${p.lng}`).join(' ');
  const types = uniqueOsmTypes(categories).map(escapeRegex);
  const regex = `^(${types.join('|')})$`;
  return `[out:json][timeout:30];
way["highway"~"${regex}"](poly:"${polyStr}");
out body geom;`;
}

function buildAroundQuery(
  center: LatLng,
  radiusMeters: number,
  categories: RoadCategory[],
): string {
  const types = uniqueOsmTypes(categories).map(escapeRegex);
  const regex = `^(${types.join('|')})$`;
  return `[out:json][timeout:30];
way["highway"~"${regex}"](around:${radiusMeters},${center.lat},${center.lng});
out body geom;`;
}

// =============================================================================
// Núcleo: executeOverpassQuery con failover, abort y mapeo de errores
// =============================================================================

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new OverpassError('aborted', 'Cancelado'));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new OverpassError('aborted', 'Cancelado'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

interface FetchAttemptResult {
  ok: true;
  data: any;
}

async function fetchOverpassOnce(
  endpoint: string,
  query: string,
  options: OverpassOptions,
): Promise<FetchAttemptResult> {
  const userSignal = options.signal;
  if (userSignal?.aborted) {
    throw new OverpassError('aborted', 'Cancelado');
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const onUserAbort = () => ctrl.abort();
  userSignal?.addEventListener('abort', onUserAbort, { once: true });

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: ctrl.signal,
    });

    if (!response.ok) {
      if (response.status === 429 || response.status === 504) {
        throw new OverpassError('rate_limit', `HTTP ${response.status}`);
      }
      if (response.status === 400) {
        throw new OverpassError('query', `HTTP 400 (consulta inválida)`);
      }
      throw new OverpassError('unknown', `HTTP ${response.status}`);
    }

    let data: any;
    try {
      data = await response.json();
    } catch (e) {
      throw new OverpassError('unknown', 'Respuesta JSON inválida', e);
    }
    return { ok: true, data };
  } catch (err) {
    if (err instanceof OverpassError) throw err;
    // AbortError
    if ((err as any)?.name === 'AbortError') {
      if (userSignal?.aborted) throw new OverpassError('aborted', 'Cancelado');
      if (timedOut) throw new OverpassError('timeout', 'Tiempo de consulta agotado');
      throw new OverpassError('aborted', 'Cancelado');
    }
    // TypeError típico de fetch sin red
    if (err instanceof TypeError) {
      throw new OverpassError('network', 'Sin conexión o servidor inalcanzable', err);
    }
    throw new OverpassError('unknown', (err as any)?.message ?? 'Error desconocido', err);
  } finally {
    clearTimeout(timer);
    userSignal?.removeEventListener('abort', onUserAbort);
  }
}

/**
 * Ejecuta una query Overpass con failover entre mirrors.
 * Por cada mirror: hasta 3 intentos (inicial + 2 reintentos con backoff)
 * SOLO si el error es transitorio (rate_limit). Otros errores saltan al siguiente mirror.
 */
async function executeOverpassQuery(
  query: string,
  options: OverpassOptions = {},
): Promise<OverpassWay[]> {
  let lastErr: OverpassError | null = null;

  for (const endpoint of OVERPASS_MIRRORS) {
    if (options.signal?.aborted) {
      throw new OverpassError('aborted', 'Cancelado');
    }
    try {
      let attempt = 0;
      // 1 inicial + RETRY_DELAYS_MS.length reintentos
      while (true) {
        try {
          const { data } = await fetchOverpassOnce(endpoint, query, options);
          return parseOverpassResponse(data);
        } catch (err) {
          if (!(err instanceof OverpassError)) throw err;
          if (err.kind === 'aborted') throw err;
          // Solo reintentamos rate_limit dentro del mismo mirror
          if (err.kind === 'rate_limit' && attempt < RETRY_DELAYS_MS.length) {
            await sleep(RETRY_DELAYS_MS[attempt], options.signal);
            attempt += 1;
            continue;
          }
          // Cualquier otro error: pasamos al siguiente mirror
          lastErr = err;
          break;
        }
      }
    } catch (err) {
      if (err instanceof OverpassError && err.kind === 'aborted') throw err;
      lastErr = err instanceof OverpassError
        ? err
        : new OverpassError('unknown', 'Error inesperado', err);
    }
  }

  throw lastErr ?? new OverpassError('unknown', 'Todos los mirrors fallaron');
}

function parseOverpassResponse(data: any): OverpassWay[] {
  // Con `out body geom`, cada way trae su propia geometry inline.
  // Aceptamos también el formato clásico con nodes resueltos por aparte (out body; >; out skel qt;)
  // por compatibilidad ante respuestas heterogéneas.
  const nodes = new Map<number, LatLng>();
  const elements: any[] = Array.isArray(data?.elements) ? data.elements : [];
  for (const el of elements) {
    if (el.type === 'node' && typeof el.id === 'number') {
      nodes.set(el.id, { lat: el.lat, lng: el.lon });
    }
  }

  const ways: OverpassWay[] = [];
  for (const el of elements) {
    if (el.type !== 'way') continue;

    let coords: LatLng[] = [];
    if (Array.isArray(el.geometry) && el.geometry.length > 0) {
      coords = el.geometry
        .filter((g: any) => typeof g?.lat === 'number' && typeof g?.lon === 'number')
        .map((g: any) => ({ lat: g.lat, lng: g.lon }));
    } else if (Array.isArray(el.nodes)) {
      for (const nid of el.nodes) {
        const n = nodes.get(nid);
        if (n) coords.push(n);
      }
    }
    if (coords.length < 2) continue;

    const tags = el.tags ?? {};
    const onewayTag = tags.oneway;
    const isOneway = onewayTag === 'yes' || onewayTag === '1' || onewayTag === '-1';
    const isOnewayReverse = onewayTag === '-1';

    const osmId = el.id as number;
    ways.push({
      id: osmId,
      osmId,
      name: tags.name || tags.ref || `Vía ${osmId}`,
      ref: typeof tags.ref === 'string' ? tags.ref : undefined,
      highway: tags.highway || 'unknown',
      coordinates: coords,
      oneway: isOneway,
      onewayReverse: isOnewayReverse,
    });
  }

  return ways;
}

// =============================================================================
// Geometría: bbox, intersección y recorte contra polígono
// =============================================================================

interface BBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

function computeBBox(polygon: LatLng[]): BBox {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of polygon) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}

function bboxAreaKm2(b: BBox): number {
  // Aproximación por equirectangular suficiente para decidir subdivisión
  const meanLat = (b.minLat + b.maxLat) / 2;
  const dLatM = (b.maxLat - b.minLat) * 111_320;
  const dLngM = (b.maxLng - b.minLng) * 111_320 * Math.cos((meanLat * Math.PI) / 180);
  return Math.max(0, (dLatM * dLngM) / 1_000_000);
}

function gridFor(areaKm2: number): number {
  if (areaKm2 <= 25) return 1;
  if (areaKm2 <= 100) return 2;
  if (areaKm2 <= 400) return 3;
  return 4;
}

function splitBBox(b: BBox, n: number): BBox[] {
  if (n <= 1) return [b];
  const out: BBox[] = [];
  const dLat = (b.maxLat - b.minLat) / n;
  const dLng = (b.maxLng - b.minLng) / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      out.push({
        minLat: b.minLat + dLat * i,
        maxLat: b.minLat + dLat * (i + 1),
        minLng: b.minLng + dLng * j,
        maxLng: b.minLng + dLng * (j + 1),
      });
    }
  }
  return out;
}

function bboxToPolygon(b: BBox): LatLng[] {
  return [
    { lat: b.minLat, lng: b.minLng },
    { lat: b.minLat, lng: b.maxLng },
    { lat: b.maxLat, lng: b.maxLng },
    { lat: b.maxLat, lng: b.minLng },
  ];
}

/** Punto en polígono (ray casting). Polígono = lista de vértices, no cerrado. */
export function pointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat;
    const xj = polygon[j].lng, yj = polygon[j].lat;
    const intersect =
      (yi > point.lat) !== (yj > point.lat) &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi + 1e-15) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** ¿Alguno de los nodos de la vía cae dentro del polígono? */
export function intersectsPolygon(coords: LatLng[], polygon: LatLng[]): boolean {
  for (const c of coords) {
    if (pointInPolygon(c, polygon)) return true;
  }
  return false;
}

/**
 * Recorta una vía conservando los nodos dentro del polígono más
 * un nodo de transición a cada lado del cruce de borde, para no
 * cortar la línea bruscamente.
 *
 * Implementación pragmática (no Sutherland-Hodgman completo):
 * para vías que entran y salen varias veces, mantiene runs
 * contiguos de puntos `inside` con su par de bordes adyacentes.
 */
export function clipWayToPolygon(coords: LatLng[], polygon: LatLng[]): LatLng[] {
  if (coords.length === 0) return [];
  const inside = coords.map((c) => pointInPolygon(c, polygon));
  const keep = new Array<boolean>(coords.length).fill(false);
  for (let i = 0; i < coords.length; i++) {
    if (inside[i]) {
      keep[i] = true;
      if (i > 0) keep[i - 1] = true; // vecino anterior (puede estar fuera)
      if (i < coords.length - 1) keep[i + 1] = true; // vecino posterior
    }
  }
  const result: LatLng[] = [];
  for (let i = 0; i < coords.length; i++) {
    if (keep[i]) result.push(coords[i]);
  }
  return result;
}

// =============================================================================
// API pública: fetchRoadsInArea / fetchRoadsInCircle
// =============================================================================

export async function fetchRoadsInArea(
  polygon: LatLng[],
  categories: RoadCategory[],
  options: OverpassOptions = {},
): Promise<OverpassWay[]> {
  if (polygon.length < 3 || categories.length === 0) return [];

  const bbox = computeBBox(polygon);
  const areaKm2 = bboxAreaKm2(bbox);
  const cells = areaKm2 > 25 ? splitBBox(bbox, gridFor(areaKm2)) : [bbox];

  const all = new Map<number, OverpassWay>();
  for (const cell of cells) {
    if (options.signal?.aborted) {
      throw new OverpassError('aborted', 'Cancelado');
    }
    const cellPoly = bboxToPolygon(cell);
    const ways = await executeOverpassQuery(buildPolyQuery(cellPoly, categories), options);
    for (const w of ways) {
      if (all.has(w.osmId)) continue;
      // Las celdas bbox son superconjunto del polígono real:
      // descartar vías que no intersectan y recortar las que cruzan el borde.
      if (!intersectsPolygon(w.coordinates, polygon)) continue;
      const clipped = clipWayToPolygon(w.coordinates, polygon);
      if (clipped.length < 2) continue;
      all.set(w.osmId, { ...w, coordinates: clipped });
    }
  }

  return [...all.values()];
}

export async function fetchRoadsInCircle(
  center: LatLng,
  radiusMeters: number,
  categories: RoadCategory[],
  options: OverpassOptions = {},
): Promise<OverpassWay[]> {
  if (categories.length === 0) return [];
  const query = buildAroundQuery(center, radiusMeters, categories);
  const ways = await executeOverpassQuery(query, options);

  // Filtrado adicional por radio real (Overpass `around` ya lo hace, pero
  // dedup por osmId queda aquí por consistencia con fetchRoadsInArea).
  const dedup = new Map<number, OverpassWay>();
  for (const w of ways) {
    if (!dedup.has(w.osmId)) dedup.set(w.osmId, w);
  }
  return [...dedup.values()];
}

// =============================================================================
// Compatibilidad: fetchCompleteRoads y mergeWaysByName se mantienen por si
// algún consumidor externo las usa. No se llaman desde el flujo principal.
// =============================================================================

export async function fetchCompleteRoads(
  center: LatLng,
  searchRadiusMeters: number,
  roadNames: string[],
  categories: RoadCategory[],
  options: OverpassOptions = {},
): Promise<OverpassWay[]> {
  if (roadNames.length === 0) return [];
  const types = uniqueOsmTypes(categories).map(escapeRegex);
  const regex = `^(${types.join('|')})$`;
  const extendedRadius = searchRadiusMeters * 3;
  const nameFilter = roadNames
    .map((n) => `"${n.replace(/"/g, '\\"')}"`)
    .join('|');
  const query = `[out:json][timeout:45];
way["highway"~"${regex}"]["name"~"^(${nameFilter})$"](around:${extendedRadius},${center.lat},${center.lng});
out body geom;`;
  return executeOverpassQuery(query, options);
}

export function mergeWaysByName(ways: OverpassWay[]): OverpassWay[] {
  const byName = new Map<string, OverpassWay[]>();
  for (const w of ways) {
    const key = w.name;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(w);
  }

  const merged: OverpassWay[] = [];
  for (const [name, group] of byName) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }
    const ordered = chainWays(group);
    const allCoords = ordered.flatMap((w, i) =>
      i === 0 ? w.coordinates : w.coordinates.slice(1),
    );
    const isOneway = group.some((w) => w.oneway);
    const isReverse = group.some((w) => w.onewayReverse);
    merged.push({
      id: group[0].id,
      osmId: group[0].osmId,
      name,
      ref: group[0].ref,
      highway: group[0].highway,
      coordinates: allCoords,
      oneway: isOneway,
      onewayReverse: isReverse,
    });
  }
  return merged;
}

function chainWays(ways: OverpassWay[]): OverpassWay[] {
  if (ways.length <= 1) return ways;
  const remaining = [...ways];
  const chain: OverpassWay[] = [remaining.shift()!];
  let changed = true;
  while (changed && remaining.length > 0) {
    changed = false;
    for (let i = 0; i < remaining.length; i++) {
      const w = remaining[i];
      const chainStart = chain[0].coordinates[0];
      const chainEnd =
        chain[chain.length - 1].coordinates[chain[chain.length - 1].coordinates.length - 1];
      const wStart = w.coordinates[0];
      const wEnd = w.coordinates[w.coordinates.length - 1];
      const t = 0.0001;
      if (Math.abs(chainEnd.lat - wStart.lat) < t && Math.abs(chainEnd.lng - wStart.lng) < t) {
        chain.push(w); remaining.splice(i, 1); changed = true; break;
      } else if (Math.abs(chainEnd.lat - wEnd.lat) < t && Math.abs(chainEnd.lng - wEnd.lng) < t) {
        chain.push({ ...w, coordinates: [...w.coordinates].reverse() });
        remaining.splice(i, 1); changed = true; break;
      } else if (Math.abs(chainStart.lat - wEnd.lat) < t && Math.abs(chainStart.lng - wEnd.lng) < t) {
        chain.unshift(w); remaining.splice(i, 1); changed = true; break;
      } else if (Math.abs(chainStart.lat - wStart.lat) < t && Math.abs(chainStart.lng - wStart.lng) < t) {
        chain.unshift({ ...w, coordinates: [...w.coordinates].reverse() });
        remaining.splice(i, 1); changed = true; break;
      }
    }
  }
  chain.push(...remaining);
  return chain;
}

// =============================================================================
// fetchNearestRoad — geometría real + distancia perpendicular
// =============================================================================

export interface NearestRoadInfo {
  name: string;
  highway: string;
  oneway: boolean;
  osmId: number;
  ref?: string;
}

/**
 * Distancia mínima del punto `p` al polilínea `coords` (en metros).
 * Aproximación local plana (suficiente a escala de calle).
 */
function distancePointToPolyline(p: LatLng, coords: LatLng[]): number {
  if (coords.length === 0) return Infinity;
  if (coords.length === 1) return haversineMeters(p, coords[0]);

  const refLat = (p.lat * Math.PI) / 180;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos(refLat);
  const px = p.lng * mPerDegLng;
  const py = p.lat * mPerDegLat;

  let best = Infinity;
  for (let i = 1; i < coords.length; i++) {
    const ax = coords[i - 1].lng * mPerDegLng;
    const ay = coords[i - 1].lat * mPerDegLat;
    const bx = coords[i].lng * mPerDegLng;
    const by = coords[i].lat * mPerDegLat;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const ex = px - cx;
    const ey = py - cy;
    const d = Math.sqrt(ex * ex + ey * ey);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Devuelve la vía más cercana al punto, calculando distancia perpendicular
 * real contra la geometría de cada candidata (no la primera que devuelva Overpass).
 *
 * Estrategia escalada de radio: 50m → 150m si no hay candidatas.
 */
export async function fetchNearestRoad(
  point: LatLng,
  options: OverpassOptions & { radiusMeters?: number } = {},
): Promise<NearestRoadInfo | null> {
  const radii = options.radiusMeters
    ? [options.radiusMeters]
    : [50, 150];

  for (const radius of radii) {
    if (options.signal?.aborted) {
      throw new OverpassError('aborted', 'Cancelado');
    }
    const query = `[out:json][timeout:10];
way(around:${radius},${point.lat},${point.lng})["highway"];
out body geom;`;
    let ways: OverpassWay[];
    try {
      ways = await executeOverpassQuery(query, { ...options, timeoutMs: options.timeoutMs ?? 15_000 });
    } catch (err) {
      // Para enriquecimiento manual no romper el flujo ante errores transitorios.
      if (err instanceof OverpassError && err.kind === 'aborted') throw err;
      return null;
    }
    if (ways.length === 0) continue;

    let best: { way: OverpassWay; d: number } | null = null;
    for (const w of ways) {
      const d = distancePointToPolyline(point, w.coordinates);
      if (!best || d < best.d) best = { way: w, d };
    }
    if (!best) continue;
    const w = best.way;
    return {
      name: w.name,
      highway: w.highway,
      oneway: w.oneway,
      osmId: w.osmId,
      ref: w.ref,
    };
  }
  return null;
}

// Exportado solo para tests
export const __test__ = {
  buildPolyQuery,
  buildAroundQuery,
  computeBBox,
  bboxAreaKm2,
  splitBBox,
  bboxToPolygon,
  parseOverpassResponse,
  distancePointToPolyline,
  OVERPASS_MIRRORS,
};
