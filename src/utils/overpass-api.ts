import type { LatLng } from '@/types/route';

export interface OverpassWay {
  id: number;
  name: string;
  highway: string;
  coordinates: LatLng[];
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

  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.status}`);
  }

  const data = await response.json();

  // Build node lookup
  const nodes = new Map<number, LatLng>();
  for (const el of data.elements) {
    if (el.type === 'node') {
      nodes.set(el.id, { lat: el.lat, lng: el.lon });
    }
  }

  // Build ways
  const ways: OverpassWay[] = [];
  for (const el of data.elements) {
    if (el.type !== 'way') continue;
    const coords: LatLng[] = [];
    for (const nid of el.nodes) {
      const node = nodes.get(nid);
      if (node) coords.push(node);
    }
    if (coords.length < 2) continue;

    ways.push({
      id: el.id,
      name: el.tags?.name || el.tags?.ref || `Vía ${el.id}`,
      highway: el.tags?.highway || 'unknown',
      coordinates: coords,
    });
  }

  return ways;
}
