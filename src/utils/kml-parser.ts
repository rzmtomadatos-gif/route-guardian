import { kml } from '@tmcw/togeojson';
import JSZip from 'jszip';
import type { Segment, LatLng, Route } from '@/types/route';

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

export async function parseKMLFile(file: File): Promise<Route> {
  const xmlDoc = await readKMLFromFile(file);
  const geojson = kml(xmlDoc);

  const routeId = generateId();
  const segments: Segment[] = [];

  for (const feature of geojson.features) {
    if (!feature.geometry) continue;
    const coords = extractCoordinates(feature.geometry);
    if (coords.length < 2) continue;

    const name =
      (feature.properties?.name as string) ||
      (feature.properties?.Name as string) ||
      `Tramo ${segments.length + 1}`;

    segments.push({
      id: generateId(),
      routeId,
      name,
      coordinates: coords,
      direction: 'ambos',
      type: 'tramo',
      status: 'pendiente',
    });
  }

  if (segments.length === 0) {
    throw new Error('No se encontraron tramos válidos en el archivo');
  }

  return {
    id: routeId,
    name: file.name.replace(/\.(kml|kmz)$/i, ''),
    loadedAt: new Date().toISOString(),
    fileName: file.name,
    segments,
    optimizedOrder: segments.map((s) => s.id),
  };
}
