import type { Route, Segment } from '@/types/route';

/**
 * Export a Route to KML format, preserving layers as Folders.
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

  const segmentToPlacemark = (seg: Segment): string => {
    const coords = seg.coordinates
      .map((c) => `${c.lng},${c.lat},0`)
      .join(' ');

    // Build ExtendedData from kmlMeta
    const extData: string[] = [];
    if (seg.kmlMeta) {
      Object.entries(seg.kmlMeta).forEach(([key, value]) => {
        if (value) {
          extData.push(`        <Data name="${escapeXml(key)}"><value>${escapeXml(value)}</value></Data>`);
        }
      });
    }

    return `    <Placemark>
      <name>${escapeXml(seg.kmlId || seg.name)}</name>
      <description>${escapeXml(seg.notes || '')}</description>
      ${extData.length > 0 ? `<ExtendedData>\n${extData.join('\n')}\n      </ExtendedData>` : ''}
      <LineString>
        <coordinates>${coords}</coordinates>
      </LineString>
    </Placemark>`;
  };

  const folders: string[] = [];

  // Layers as folders
  const sortedLayers = Array.from(layerMap.keys()).sort();
  for (const layerName of sortedLayers) {
    const segs = layerMap.get(layerName)!;
    folders.push(`  <Folder>
    <name>${escapeXml(layerName)}</name>
${segs.map(segmentToPlacemark).join('\n')}
  </Folder>`);
  }

  // Segments without layer at root level
  const rootPlacemarks = noLayer.map(segmentToPlacemark).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(route.name)}</name>
${folders.join('\n')}
${rootPlacemarks}
  </Document>
</kml>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Download KML string as a file.
 */
export function downloadKml(kmlContent: string, fileName: string): void {
  const blob = new Blob([kmlContent], { type: 'application/vnd.google-earth.kml+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.kml') ? fileName : `${fileName}.kml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
