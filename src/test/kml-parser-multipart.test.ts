/**
 * Tests para soporte multiparte en kml-parser.
 *
 * Cubre `extractLineParts` (función pura) y la integración end-to-end de
 * `parseKMLFile` para asegurar que un Placemark con MultiGeometry genera
 * un Segment independiente por cada línea, sin concatenar partes.
 */
import { describe, it, expect } from 'vitest';
import { extractLineParts, parseKMLFile } from '@/utils/kml-parser';

function kmlFile(content: string, name = 'test.kml'): File {
  const f = new File([content], name, { type: 'application/vnd.google-earth.kml+xml' });
  if (typeof (f as unknown as { text?: () => Promise<string> }).text !== 'function') {
    Object.defineProperty(f, 'text', { value: async () => content });
  }
  return f;
}

describe('extractLineParts — función pura', () => {
  it('LineString → 1 parte', () => {
    const parts = extractLineParts({
      type: 'LineString',
      coordinates: [[-3.7, 40.4], [-3.71, 40.41]],
    });
    expect(parts).toHaveLength(1);
    expect(parts[0]).toHaveLength(2);
    expect(parts[0][0]).toEqual({ lat: 40.4, lng: -3.7 });
  });

  it('MultiLineString → una parte por línea, sin .flat()', () => {
    const parts = extractLineParts({
      type: 'MultiLineString',
      coordinates: [
        [[-3.70, 40.40], [-3.71, 40.41]],
        [[-3.80, 40.50], [-3.81, 40.51], [-3.82, 40.52]],
        [[-3.90, 40.60], [-3.91, 40.61]],
      ],
    });
    expect(parts).toHaveLength(3);
    expect(parts[0]).toHaveLength(2);
    expect(parts[1]).toHaveLength(3);
    expect(parts[2]).toHaveLength(2);
    // No debe haber un punto del segundo grupo dentro del primero
    expect(parts[0]).not.toContainEqual({ lat: 40.50, lng: -3.80 });
  });

  it('GeometryCollection con Point + LineString → solo la línea', () => {
    const parts = extractLineParts({
      type: 'GeometryCollection',
      geometries: [
        { type: 'Point', coordinates: [-3.7, 40.4] },
        { type: 'LineString', coordinates: [[-3.7, 40.4], [-3.71, 40.41]] },
      ],
    });
    expect(parts).toHaveLength(1);
    expect(parts[0]).toHaveLength(2);
  });

  it('GeometryCollection anidada con LineString + MultiLineString → todas las partes', () => {
    const parts = extractLineParts({
      type: 'GeometryCollection',
      geometries: [
        { type: 'LineString', coordinates: [[-3.7, 40.4], [-3.71, 40.41]] },
        {
          type: 'MultiLineString',
          coordinates: [
            [[-3.8, 40.5], [-3.81, 40.51]],
            [[-3.9, 40.6], [-3.91, 40.61]],
          ],
        },
      ],
    });
    expect(parts).toHaveLength(3);
  });

  it('Partes con menos de 2 coords se descartan', () => {
    const parts = extractLineParts({
      type: 'MultiLineString',
      coordinates: [
        [[-3.7, 40.4]], // inválida
        [[-3.8, 40.5], [-3.81, 40.51]],
      ],
    });
    expect(parts).toHaveLength(1);
  });

  it('Point y Polygon no generan tramos', () => {
    expect(extractLineParts({ type: 'Point', coordinates: [-3.7, 40.4] })).toEqual([]);
    expect(
      extractLineParts({
        type: 'Polygon',
        coordinates: [[[-3.7, 40.4], [-3.71, 40.41], [-3.72, 40.42], [-3.7, 40.4]]],
      }),
    ).toEqual([]);
  });

  it('Geometría null/undefined → []', () => {
    expect(extractLineParts(null)).toEqual([]);
    expect(extractLineParts(undefined)).toEqual([]);
  });
});

describe('parseKMLFile — integración multiparte', () => {
  it('KML con LineString normal → 1 segmento', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <Placemark><name>T1</name>
    <LineString><coordinates>-3.70,40.40 -3.71,40.41</coordinates></LineString>
  </Placemark>
</Document></kml>`;
    const { route } = await parseKMLFile(kmlFile(xml));
    expect(route.segments).toHaveLength(1);
    expect(route.segments[0].name).toBe('T1');
    expect(route.segments[0].kmlMeta.multiPartIndex).toBeUndefined();
    expect(route.optimizedOrder).toHaveLength(1);
  });

  it('KML con MultiGeometry de 3 LineString → 3 segmentos independientes', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <Placemark><name>M-501</name>
    <MultiGeometry>
      <LineString><coordinates>-3.70,40.40 -3.71,40.41</coordinates></LineString>
      <LineString><coordinates>-3.80,40.50 -3.81,40.51 -3.82,40.52</coordinates></LineString>
      <LineString><coordinates>-3.90,40.60 -3.91,40.61</coordinates></LineString>
    </MultiGeometry>
  </Placemark>
</Document></kml>`;
    const { route } = await parseKMLFile(kmlFile(xml));
    expect(route.segments).toHaveLength(3);
    expect(route.segments[0].name).toBe('M-501 — parte 1/3');
    expect(route.segments[1].name).toBe('M-501 — parte 2/3');
    expect(route.segments[2].name).toBe('M-501 — parte 3/3');

    // Cada parte conserva sus coords originales (no concatenadas)
    expect(route.segments[0].coordinates).toHaveLength(2);
    expect(route.segments[1].coordinates).toHaveLength(3);
    expect(route.segments[2].coordinates).toHaveLength(2);

    // Trazabilidad multiparte
    for (let i = 0; i < 3; i++) {
      const m = route.segments[i].kmlMeta;
      expect(m.multiPartParentName).toBe('M-501');
      expect(m.multiPartIndex).toBe(i + 1);
      expect(m.multiPartTotal).toBe(3);
      expect(m.multiPartGeometryType).toBeDefined();
    }

    // IDs únicos
    const ids = new Set(route.segments.map((s) => s.id));
    expect(ids.size).toBe(3);

    // optimizedOrder coherente
    expect(route.optimizedOrder).toHaveLength(route.segments.length);
    expect(route.optimizedOrder).toEqual(route.segments.map((s) => s.id));
  });

  it('KML con MultiGeometry dentro de Folder → conserva layer en cada parte', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <Folder><name>CORTADAS</name>
    <Placemark><name>P1</name>
      <MultiGeometry>
        <LineString><coordinates>-3.70,40.40 -3.71,40.41</coordinates></LineString>
        <LineString><coordinates>-3.80,40.50 -3.81,40.51</coordinates></LineString>
      </MultiGeometry>
    </Placemark>
  </Folder>
</Document></kml>`;
    const { route } = await parseKMLFile(kmlFile(xml));
    expect(route.segments).toHaveLength(2);
    expect(route.segments.every((s) => s.layer === 'CORTADAS')).toBe(true);
  });

  it('KML con MultiGeometry mezclando Point + LineStrings → ignora Point', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <Placemark><name>Mix</name>
    <MultiGeometry>
      <Point><coordinates>-3.70,40.40</coordinates></Point>
      <LineString><coordinates>-3.70,40.40 -3.71,40.41</coordinates></LineString>
      <LineString><coordinates>-3.80,40.50 -3.81,40.51</coordinates></LineString>
    </MultiGeometry>
  </Placemark>
</Document></kml>`;
    const { route } = await parseKMLFile(kmlFile(xml));
    expect(route.segments).toHaveLength(2);
    expect(route.segments[0].name).toBe('Mix — parte 1/2');
    expect(route.segments[1].name).toBe('Mix — parte 2/2');
  });
});
