import type { LatLng } from '@/types/route';

export interface OverpassWay {
  id: number;
  name: string;
  highway: string;
  coordinates: LatLng[];
  oneway: boolean;
  onewayReverse: boolean; // oneway=-1 means reverse direction
}

export type RoadCategory = 'highway' | 'primary' | 'secondary' | 'tertiary' | 'residential' | 'track' | 'path';

export const ROAD_CATEGORIES: Record<RoadCategory, { label: string; osmTypes: string[]; description: string }> = {
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
    osmTypes: ['residential', 'living_street', 'unclassified', 'service'],
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

function buildOverpassQuery(polygon: LatLng[], categories: RoadCategory[]): string {
  // Build poly string for Overpass: "lat1 lng1 lat2 lng2 ..."
  const polyStr = polygon.map((p) => `${p.lat} ${p.lng}`).join(' ');

  const osmTypes = categories.flatMap((c) => ROAD_CATEGORIES[c].osmTypes);
  const highwayFilter = osmTypes.map((t) => `["highway"="${t}"]`).join('');

  // Use a union of queries for each highway type
  const wayQueries = osmTypes
    .map((t) => `way["highway"="${t}"](poly:"${polyStr}");`)
    .join('\n  ');

  return `[out:json][timeout:30];
(
  ${wayQueries}
);
out body;
>;
out skel qt;`;
}

export async function fetchRoadsInArea(
  polygon: LatLng[],
  categories: RoadCategory[]
): Promise<OverpassWay[]> {
  if (polygon.length < 3 || categories.length === 0) return [];

  const query = buildOverpassQuery(polygon, categories);
  return executeOverpassQuery(query);
}

/** Fetch roads within a circle defined by center + radius in meters */
export async function fetchRoadsInCircle(
  center: LatLng,
  radiusMeters: number,
  categories: RoadCategory[]
): Promise<OverpassWay[]> {
  if (categories.length === 0) return [];

  const osmTypes = categories.flatMap((c) => ROAD_CATEGORIES[c].osmTypes);
  const wayQueries = osmTypes
    .map((t) => `way["highway"="${t}"](around:${radiusMeters},${center.lat},${center.lng});`)
    .join('\n  ');

  const query = `[out:json][timeout:30];
(
  ${wayQueries}
);
out body;
>;
out skel qt;`;

  return executeOverpassQuery(query);
}

/** Given road names found in initial query, fetch complete roads in a larger bbox */
export async function fetchCompleteRoads(
  center: LatLng,
  searchRadiusMeters: number,
  roadNames: string[],
  categories: RoadCategory[]
): Promise<OverpassWay[]> {
  if (roadNames.length === 0) return [];

  const osmTypes = categories.flatMap((c) => ROAD_CATEGORIES[c].osmTypes);
  // Search in a larger radius (3x) to find complete roads
  const extendedRadius = searchRadiusMeters * 3;

  const nameFilters = roadNames.map((n) => `["name"="${n.replace(/"/g, '\\"')}"]`);
  const wayQueries: string[] = [];
  for (const nameFilter of nameFilters) {
    for (const t of osmTypes) {
      wayQueries.push(`way["highway"="${t}"]${nameFilter}(around:${extendedRadius},${center.lat},${center.lng});`);
    }
  }

  const query = `[out:json][timeout:45];
(
  ${wayQueries.join('\n  ')}
);
out body;
>;
out skel qt;`;

  return executeOverpassQuery(query);
}

/** Merge multiple ways with the same name into continuous segments */
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

    // Try to chain ways by matching end/start nodes
    const ordered = chainWays(group);
    const allCoords = ordered.flatMap((w, i) => i === 0 ? w.coordinates : w.coordinates.slice(1));
    const isOneway = group.some((w) => w.oneway);
    const isReverse = group.some((w) => w.onewayReverse);

    merged.push({
      id: group[0].id,
      name,
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
      const chainEnd = chain[chain.length - 1].coordinates[chain[chain.length - 1].coordinates.length - 1];
      const wStart = w.coordinates[0];
      const wEnd = w.coordinates[w.coordinates.length - 1];

      const threshold = 0.0001; // ~11m
      if (Math.abs(chainEnd.lat - wStart.lat) < threshold && Math.abs(chainEnd.lng - wStart.lng) < threshold) {
        chain.push(w);
        remaining.splice(i, 1);
        changed = true;
        break;
      } else if (Math.abs(chainEnd.lat - wEnd.lat) < threshold && Math.abs(chainEnd.lng - wEnd.lng) < threshold) {
        chain.push({ ...w, coordinates: [...w.coordinates].reverse() });
        remaining.splice(i, 1);
        changed = true;
        break;
      } else if (Math.abs(chainStart.lat - wEnd.lat) < threshold && Math.abs(chainStart.lng - wEnd.lng) < threshold) {
        chain.unshift(w);
        remaining.splice(i, 1);
        changed = true;
        break;
      } else if (Math.abs(chainStart.lat - wStart.lat) < threshold && Math.abs(chainStart.lng - wStart.lng) < threshold) {
        chain.unshift({ ...w, coordinates: [...w.coordinates].reverse() });
        remaining.splice(i, 1);
        changed = true;
        break;
      }
    }
  }

  // Add any unchained ways at the end
  chain.push(...remaining);
  return chain;
}

async function executeOverpassQuery(query: string): Promise<OverpassWay[]> {
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.status}`);
  }

  const data = await response.json();

  const nodes = new Map<number, LatLng>();
  for (const el of data.elements) {
    if (el.type === 'node') {
      nodes.set(el.id, { lat: el.lat, lng: el.lon });
    }
  }

  const ways: OverpassWay[] = [];
  for (const el of data.elements) {
    if (el.type !== 'way') continue;
    const coords: LatLng[] = [];
    for (const nid of el.nodes) {
      const node = nodes.get(nid);
      if (node) coords.push(node);
    }
    if (coords.length < 2) continue;

    const onewayTag = el.tags?.oneway;
    const isOneway = onewayTag === 'yes' || onewayTag === '1' || onewayTag === '-1';
    const isOnewayReverse = onewayTag === '-1';

    ways.push({
      id: el.id,
      name: el.tags?.name || el.tags?.ref || `Vía ${el.id}`,
      highway: el.tags?.highway || 'unknown',
      coordinates: coords,
      oneway: isOneway,
      onewayReverse: isOnewayReverse,
    });
  }

  return ways;
}

/** Fetch the nearest road to a point using Overpass around query */
export async function fetchNearestRoad(
  point: LatLng,
  radiusMeters: number = 50
): Promise<{ name: string; highway: string; oneway: boolean } | null> {
  const query = `[out:json][timeout:10];
way(around:${radiusMeters},${point.lat},${point.lng})["highway"];
out tags 1;`;

  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  if (!response.ok) return null;

  const data = await response.json();
  const way = data.elements?.[0];
  if (!way?.tags) return null;

  const onewayTag = way.tags.oneway;
  return {
    name: way.tags.name || way.tags.ref || `Vía ${way.id}`,
    highway: way.tags.highway || 'unknown',
    oneway: onewayTag === 'yes' || onewayTag === '1' || onewayTag === '-1',
  };
}
