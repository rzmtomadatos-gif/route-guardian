import { kml } from '@tmcw/togeojson';
import JSZip from 'jszip';
import type { Segment, LatLng, Route, SegmentKmlMeta } from '@/types/route';

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function extractCoordinates(geometry: GeoJSON.Geometry): LatLng[] {
  if (geometry.type === 'LineString') {
    return (geometry as GeoJSON.LineString).coordinates.map(([lng, lat]) => ({ lat, lng }));
  }
  if (geometry.type === 'MultiLineString') {
    return (geometry as GeoJSON.MultiLineString).coordinates.flat().map(([lng, lat]) => ({ lat, lng }));
  }
  if (geometry.type === 'Point') {
    const [lng, lat] = (geometry as GeoJSON.Point).coordinates;
    return [{ lat, lng }];
  }
  if (geometry.type === 'Polygon') {
    return (geometry as GeoJSON.Polygon).coordinates[0].map(([lng, lat]) => ({ lat, lng }));
  }
  return [];
}

/** Case-insensitive property lookup */
function getProp(props: Record<string, unknown>, key: string): string | undefined {
  const lowerKey = key.toLowerCase();
  for (const k of Object.keys(props)) {
    if (k.toLowerCase() === lowerKey) {
      const v = props[k];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
  }
  return undefined;
}

function extractDescriptionFields(descriptionHtml: string): Record<string, string> {
  const fields: Record<string, string> = {};
  // Match table rows like <td>KEY</td><td>VALUE</td>
  const rowRegex = /<td[^>]*>\s*(.*?)\s*<\/td>\s*<td[^>]*>\s*(.*?)\s*<\/td>/gi;
  let match;
  while ((match = rowRegex.exec(descriptionHtml)) !== null) {
    const key = match[1].replace(/<[^>]*>/g, '').trim();
    const value = match[2].replace(/<[^>]*>/g, '').trim();
    if (key && value) fields[key.toLowerCase()] = value;
  }
  return fields;
}

function extractKmlMeta(props: Record<string, unknown>): SegmentKmlMeta {
  // First try direct properties (ExtendedData)
  let carretera = getProp(props, 'carretera');
  let identtramo = getProp(props, 'identtramo');
  let tipo = getProp(props, 'tipo');
  let calzada = getProp(props, 'calzada');
  let sentido = getProp(props, 'sentido');
  let pkInicial = getProp(props, 'pkinicial');
  let pkFinal = getProp(props, 'pkfinal');

  // Fallback: parse HTML description table
  const desc = getProp(props, 'description');
  if (desc) {
    const descFields = extractDescriptionFields(desc);
    carretera = carretera || descFields['carretera'];
    identtramo = identtramo || descFields['identtramo'];
    tipo = tipo || descFields['tipo'];
    calzada = calzada || descFields['calzada'];
    sentido = sentido || descFields['sentido'];
    pkInicial = pkInicial || descFields['pkinicial'];
    pkFinal = pkFinal || descFields['pkfinal'];
  }

  return { carretera, identtramo, tipo, calzada, sentido, pkInicial, pkFinal };
}

async function readKMLFromFile(file: File): Promise<Document> {
  const ext = file.name.toLowerCase().split('.').pop();

  if (ext === 'kmz') {
    const zip = new JSZip();
    const contents = await zip.loadAsync(file);
    const kmlFile = Object.keys(contents.files).find(
      (name) => name.toLowerCase().endsWith('.kml')
    );
    if (!kmlFile) throw new Error('No se encontró archivo KML dentro del KMZ');
    const kmlText = await contents.files[kmlFile].async('text');
    return new DOMParser().parseFromString(kmlText, 'text/xml');
  }

  const text = await file.text();
  return new DOMParser().parseFromString(text, 'text/xml');
}

export interface ParsedKmlResult {
  route: Route;
  hasBothNamingFields: boolean;
  sampleCarretera: string;
  sampleIdenttramo: string;
}

export async function parseKMLFile(file: File): Promise<ParsedKmlResult> {
  const xmlDoc = await readKMLFromFile(file);
  const geojson = kml(xmlDoc);

  const routeId = generateId();
  const segments: Segment[] = [];

  for (const feature of geojson.features) {
    if (!feature.geometry) continue;
    const coords = extractCoordinates(feature.geometry);
    if (coords.length < 2) continue;

    const props = (feature.properties || {}) as Record<string, unknown>;
    const meta = extractKmlMeta(props);

    const kmlId =
      (feature.properties?.name as string) ||
      (feature.properties?.Name as string) ||
      '';
    const name = meta.identtramo || meta.carretera || kmlId || `Tramo ${segments.length + 1}`;

    segments.push({
      id: generateId(),
      routeId,
      trackNumber: null,
      trackHistory: [],
      kmlId,
      name,
      notes: '',
      coordinates: coords,
      direction: 'ambos',
      type: 'tramo',
      status: 'pendiente',
      kmlMeta: meta,
    });
  }

  if (segments.length === 0) {
    throw new Error('No se encontraron tramos válidos en el archivo');
  }

  // Check if both naming fields exist in any segment
  const hasBothNamingFields = segments.some(
    (s) => s.kmlMeta.carretera && s.kmlMeta.identtramo
  );
  const sampleCarretera = segments.find((s) => s.kmlMeta.carretera)?.kmlMeta.carretera || '';
  const sampleIdenttramo = segments.find((s) => s.kmlMeta.identtramo)?.kmlMeta.identtramo || '';

  const route: Route = {
    id: routeId,
    name: file.name.replace(/\.(kml|kmz)$/i, ''),
    loadedAt: new Date().toISOString(),
    fileName: file.name,
    segments,
    optimizedOrder: segments.map((s) => s.id),
  };

  return { route, hasBothNamingFields, sampleCarretera, sampleIdenttramo };
}

/** Apply naming choice to all segments */
export function applyNamingField(route: Route, field: 'carretera' | 'identtramo'): Route {
  return {
    ...route,
    segments: route.segments.map((s) => ({
      ...s,
      name: s.kmlMeta[field] || s.name,
    })),
  };
}
