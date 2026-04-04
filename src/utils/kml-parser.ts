import { kmlWithFolders } from '@tmcw/togeojson';
import type { Folder } from '@tmcw/togeojson';
import JSZip from 'jszip';
import type { Segment, LatLng, Route, SegmentKmlMeta } from '@/types/route';
import { sanitizeHtml, stripHtml, sanitizeTextField } from '@/utils/sanitize';

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
  // Sanitize HTML before parsing to prevent XSS from malicious KML
  const safeHtml = sanitizeHtml(descriptionHtml);
  const fields: Record<string, string> = {};
  const rowRegex = /<td[^>]*>\s*(.*?)\s*<\/td>\s*<td[^>]*>\s*(.*?)\s*<\/td>/gi;
  let match;
  while ((match = rowRegex.exec(safeHtml)) !== null) {
    const key = stripHtml(match[1]).trim();
    const value = stripHtml(match[2]).trim();
    if (key && value) fields[key.toLowerCase()] = sanitizeTextField(value, 1000);
  }
  return fields;
}

function extractKmlMeta(props: Record<string, unknown>): SegmentKmlMeta {
  const s = (v: string | undefined) => v ? sanitizeTextField(stripHtml(v), 500) : undefined;

  let carretera = s(getProp(props, 'carretera'));
  let identtramo = s(getProp(props, 'identtramo'));
  let tipo = s(getProp(props, 'tipo'));
  let calzada = s(getProp(props, 'calzada'));
  let sentido = s(getProp(props, 'sentido'));
  let pkInicial = s(getProp(props, 'pkinicial'));
  let pkFinal = s(getProp(props, 'pkfinal'));

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

type FolderOrFeature = GeoJSON.Feature | Folder;

/** Recursively walk the kmlWithFolders tree and collect segments */
function collectSegments(
  children: FolderOrFeature[],
  routeId: string,
  segments: Segment[],
  currentLayer?: string
): void {
  for (const child of children) {
    if ('type' in child && (child as Folder).type === 'folder') {
      const folder = child as Folder;
      const folderName = (folder.meta?.name as string) || currentLayer;
      collectSegments(folder.children, routeId, segments, folderName);
    } else {
      // It's a GeoJSON Feature
      const feature = child as GeoJSON.Feature;
      if (!feature.geometry) continue;
      const coords = extractCoordinates(feature.geometry);
      if (coords.length < 2) continue;

      const props = (feature.properties || {}) as Record<string, unknown>;
      const meta = extractKmlMeta(props);

      const rawKmlId =
        (feature.properties?.name as string) ||
        (feature.properties?.Name as string) ||
        '';
      const kmlId = sanitizeTextField(stripHtml(rawKmlId), 500);
      const name = sanitizeTextField(
        meta.identtramo || meta.carretera || kmlId || `Tramo ${segments.length + 1}`,
        500
      );

      segments.push({
        id: generateId(),
        routeId,
        trackNumber: null,
        plannedTrackNumber: null,
        trackHistory: [],
        kmlId,
        name,
        notes: '',
        coordinates: coords,
        direction: 'ambos',
        type: 'tramo',
        status: 'pendiente',
        kmlMeta: meta,
        layer: currentLayer,
      });
    }
  }
}

const MAX_KML_FILE_SIZE = 200 * 1024 * 1024; // 200 MB

export async function parseKMLFile(file: File): Promise<ParsedKmlResult> {
  if (file.size > MAX_KML_FILE_SIZE) {
    throw new Error(`El archivo KML/KMZ es demasiado grande (${(file.size / 1024 / 1024).toFixed(1)} MB). Máximo: ${MAX_KML_FILE_SIZE / 1024 / 1024} MB.`);
  }
  if (file.size === 0) {
    throw new Error('El archivo KML/KMZ está vacío.');
  }
  const xmlDoc = await readKMLFromFile(file);
  const root = kmlWithFolders(xmlDoc);

  // Debug: log the tree structure
  const describeTree = (children: any[], depth = 0): string[] => {
    const lines: string[] = [];
    for (const c of children) {
      if (c.type === 'folder') {
        lines.push(`${'  '.repeat(depth)}📁 Folder: "${c.meta?.name || '(sin nombre)'}"`);
        lines.push(...describeTree(c.children || [], depth + 1));
      } else {
        const name = c.properties?.name || c.properties?.Name || '(feature)';
        const geomType = c.geometry?.type || 'null';
        lines.push(`${'  '.repeat(depth)}📄 Feature: "${name}" [${geomType}]`);
      }
    }
    return lines;
  };
  console.log('[KML Parser] Tree structure:\n' + describeTree(root.children).join('\n'));

  const routeId = generateId();
  const segments: Segment[] = [];

  collectSegments(root.children, routeId, segments);

  if (segments.length === 0) {
    throw new Error('No se encontraron tramos válidos en el archivo');
  }

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

/** Assign companySegmentId to every segment using a global counter */
export function applyProjectCode(route: Route, code: string, projectName: string): Route {
  return {
    ...route,
    projectCode: code,
    projectName,
    segments: route.segments.map((s, i) => ({
      ...s,
      companySegmentId: `${code}_${String(i).padStart(5, '0')}`,
    })),
  };
}
