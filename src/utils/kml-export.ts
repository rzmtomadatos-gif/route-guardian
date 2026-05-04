import type { Route, Segment, LatLng } from '@/types/route';
import { isValidLatLng } from '@/utils/coord-validation';

/**
 * Escapa caracteres XML aceptando cualquier valor.
 *
 * Reglas de coerción (en este orden):
 *  - null / undefined → ""
 *  - string           → tal cual
 *  - number / boolean → String(value)
 *  - object / array   → JSON.stringify(value), o "" si falla
 *  - cualquier otro   → String(value), o "" si falla
 *
 * Imprescindible: nunca llamamos `.replace()` sobre algo que no sea string.
 * Esto evita el `TypeError: value.replace is not a function` que rompía la
 * exportación cuando `kmlMeta.osmId` venía como number desde Overpass.
 */
function escapeXml(value: unknown): string {
  let str: string;

  if (value === null || value === undefined) {
    str = '';
  } else if (typeof value === 'string') {
    str = value;
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    str = String(value);
  } else if (typeof value === 'object') {
    try {
      str = JSON.stringify(value) ?? '';
    } catch {
      str = '';
    }
  } else {
    try {
      str = String(value);
    } catch {
      str = '';
    }
  }

  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Convierte un Route en KML preservando capas como Folders.
 *
 * Endurecimiento frente a datos reales de campo:
 *  - Coordenadas se filtran con `isValidLatLng` (descarta NaN, fuera de rango y [0,0]).
 *  - Si tras filtrar quedan menos de 2 puntos, el Placemark se omite (una LineString
 *    con un solo punto es KML inválido y rompe Google Earth).
 *  - Todos los textos pasan por `escapeXml`, que tolera number/boolean/object.
 */
export function routeToKml(route: Route): string {
  const layerMap = new Map<string, Segment[]>();
  const noLayer: Segment[] = [];

  route.segments.forEach((seg) => {
    if (seg.layer) {
      if (!layerMap.has(seg.layer)) layerMap.set(seg.layer, []);
      layerMap.get(seg.layer)!.push(seg);
    } else {
      noLayer.push(seg);
    }
  });

  let omittedCount = 0;

  const segmentToPlacemark = (seg: Segment): string | null => {
    const validCoords: LatLng[] = Array.isArray(seg.coordinates)
      ? seg.coordinates.filter(isValidLatLng)
      : [];

    if (validCoords.length < 2) {
      omittedCount += 1;
      return null;
    }

    const coords = validCoords.map((c) => `${c.lng},${c.lat},0`).join(' ');

    const extData: string[] = [];
    if (seg.kmlMeta && typeof seg.kmlMeta === 'object') {
      Object.entries(seg.kmlMeta).forEach(([key, value]) => {
        // Mantener el comportamiento previo: omitir vacíos / nulos.
        if (value === undefined || value === null || value === '') return;
        extData.push(
          `        <Data name="${escapeXml(key)}"><value>${escapeXml(value)}</value></Data>`,
        );
      });
    }

    const placemarkName = escapeXml(seg.kmlId ?? seg.name ?? '');
    const placemarkDesc = escapeXml(seg.notes ?? '');

    return `    <Placemark>
      <name>${placemarkName}</name>
      <description>${placemarkDesc}</description>
      ${extData.length > 0 ? `<ExtendedData>\n${extData.join('\n')}\n      </ExtendedData>` : ''}
      <LineString>
        <coordinates>${coords}</coordinates>
      </LineString>
    </Placemark>`;
  };

  const folders: string[] = [];

  const sortedLayers = Array.from(layerMap.keys()).sort();
  for (const layerName of sortedLayers) {
    const segs = layerMap.get(layerName)!;
    const placemarks = segs
      .map(segmentToPlacemark)
      .filter((p): p is string => p !== null);
    folders.push(`  <Folder>
    <name>${escapeXml(layerName)}</name>
${placemarks.join('\n')}
  </Folder>`);
  }

  const rootPlacemarks = noLayer
    .map(segmentToPlacemark)
    .filter((p): p is string => p !== null)
    .join('\n');

  if (omittedCount > 0) {
    console.warn(
      `[KML Export] Se omitieron ${omittedCount} tramo(s) por coordenadas inválidas o insuficientes (<2 puntos).`,
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(route.name)}</name>
${folders.join('\n')}
${rootPlacemarks}
  </Document>
</kml>`;
}

/**
 * Limpia un nombre de archivo para descarga.
 *  - Elimina caracteres reservados en sistemas de archivos: / \ : * ? " < > |
 *  - Elimina caracteres de control.
 *  - Recorta espacios y puntos al final (problemáticos en Windows).
 *  - Asegura que termina en `.kml`.
 *  - Si tras limpiar queda vacío, devuelve "ruta.kml".
 *  - Conserva espacios normales internos y mayúsculas/minúsculas tal cual.
 */
export function sanitizeKmlFileName(rawName: string): string {
  const cleaned = (rawName ?? '')
    .replace(/[\/\\:*?"<>|]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/[\s.]+$/g, '')
    .trim();

  const base = cleaned.length > 0 ? cleaned : 'ruta';
  return /\.kml$/i.test(base) ? base : `${base}.kml`;
}

/**
 * Devuelve un timestamp local compacto apto para nombres de archivo:
 * `YYYYMMDD-HHMMSS` (sin separadores ambiguos para FS).
 */
function buildTimestampSuffix(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * Construye un nombre de archivo único añadiendo un sufijo de fecha/hora antes
 * de la extensión `.kml`. Conserva mayúsculas, minúsculas y espacios del nombre
 * original. Si el nombre ya contiene un sufijo idéntico al actual, no lo duplica.
 *
 *   "Madrid 2026.kml" → "Madrid 2026 - 20260425-101530.kml"
 *
 * Pensado para evitar sobreescrituras silenciosas al exportar varias veces la
 * misma campaña en una jornada.
 */
export function uniqueKmlFileName(rawName: string, date: Date = new Date()): string {
  const sanitized = sanitizeKmlFileName(rawName);
  const suffix = buildTimestampSuffix(date);

  // Separa base y extensión real (.kml/.KML/...).
  const match = sanitized.match(/^(.*)(\.kml)$/i);
  const base = match ? match[1] : sanitized;
  const ext = match ? match[2] : '.kml';

  // Si el nombre ya termina con un sufijo de timestamp idéntico, no duplicar.
  const trimmedBase = base.replace(/[\s-]+$/u, '');
  const alreadyHasSuffix = new RegExp(`[\\s-]${suffix}$`).test(base);

  if (alreadyHasSuffix) {
    return `${base}${ext}`;
  }

  return `${trimmedBase} - ${suffix}${ext}`;
}

/**
 * Descarga un string KML como archivo.
 *
 * Siempre añade un sufijo de fecha/hora único al nombre para evitar
 * sobreescrituras y facilitar trazabilidad operativa en campo.
 */
export function downloadKml(kmlContent: string, fileName: string): void {
  const safeName = uniqueKmlFileName(fileName);
  const blob = new Blob([kmlContent], { type: 'application/vnd.google-earth.kml+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
