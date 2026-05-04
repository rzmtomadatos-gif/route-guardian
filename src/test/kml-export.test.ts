import { describe, it, expect, vi } from 'vitest';
import { routeToKml, sanitizeKmlFileName, uniqueKmlFileName } from '@/utils/kml-export';
import type { Route, Segment } from '@/types/route';

function makeSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: 'seg-1',
    routeId: 'route-1',
    trackNumber: null,
    plannedTrackNumber: null,
    trackHistory: [],
    kmlId: 'MAD_00001',
    name: 'Tramo 1',
    notes: '',
    coordinates: [
      { lat: 40.4, lng: -3.7 },
      { lat: 40.5, lng: -3.8 },
    ],
    direction: 'creciente',
    type: 'tramo',
    status: 'pendiente',
    kmlMeta: {},
    ...overrides,
  };
}

function makeRoute(segments: Segment[], name = 'Madrid 2026'): Route {
  return {
    id: 'route-1',
    name,
    loadedAt: new Date().toISOString(),
    fileName: 'madrid.kml',
    segments,
    optimizedOrder: segments.map((s) => s.id),
  };
}

describe('routeToKml — kmlMeta con valores no string', () => {
  it('exporta osmId numérico sin lanzar y lo serializa correctamente', () => {
    const seg = makeSegment({
      kmlMeta: {
        osmId: 12345,
        ref: 'M-501',
        source: 'osm',
      },
    });
    const route = makeRoute([seg]);

    expect(() => routeToKml(route)).not.toThrow();
    const kml = routeToKml(route);
    expect(kml).toContain('<Data name="osmId"><value>12345</value></Data>');
    expect(kml).toContain('<Data name="ref"><value>M-501</value></Data>');
    expect(kml).toContain('<Data name="source"><value>osm</value></Data>');
  });

  it('omite entradas vacías o null en kmlMeta', () => {
    const seg = makeSegment({
      kmlMeta: {
        carretera: '',
        identtramo: undefined,
        osmId: 999,
      } as any,
    });
    const kml = routeToKml(makeRoute([seg]));
    expect(kml).not.toContain('name="carretera"');
    expect(kml).not.toContain('name="identtramo"');
    expect(kml).toContain('<Data name="osmId"><value>999</value></Data>');
  });
});

describe('routeToKml — escapado XML', () => {
  it('escapa <, >, &, ", \' en name, notes, route.name y kmlMeta', () => {
    const seg = makeSegment({
      kmlId: 'A < B & C > D "e" \'f\'',
      notes: 'Notas con < > & " \'',
      kmlMeta: { carretera: 'M & N <test>' },
    });
    const route = makeRoute([seg], 'Ruta "Test" & <demo>');
    const kml = routeToKml(route);

    expect(kml).toContain('Ruta &quot;Test&quot; &amp; &lt;demo&gt;');
    expect(kml).toContain('A &lt; B &amp; C &gt; D &quot;e&quot; &apos;f&apos;');
    expect(kml).toContain('Notas con &lt; &gt; &amp; &quot; &apos;');
    expect(kml).toContain('M &amp; N &lt;test&gt;');
    // No debe aparecer ningún '&' suelto sin escapar
    expect(kml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
  });
});

describe('routeToKml — coordenadas inválidas', () => {
  it('filtra coords inválidas pero mantiene placemark si quedan ≥2 válidas', () => {
    const seg = makeSegment({
      coordinates: [
        { lat: 40.4, lng: -3.7 },
        { lat: NaN, lng: -3.75 },
        { lat: 0, lng: 0 }, // sentinel inválido
        { lat: 40.5, lng: -3.8 },
        { lat: 200, lng: 500 }, // fuera de rango
      ],
    });
    const kml = routeToKml(makeRoute([seg]));
    expect(kml).toContain('<Placemark>');
    expect(kml).toContain('<coordinates>-3.7,40.4,0 -3.8,40.5,0</coordinates>');
    expect(kml).not.toContain('NaN');
    expect(kml).not.toContain('200');
    expect(kml).not.toContain('500');
  });

  it('omite el placemark si quedan menos de 2 coordenadas válidas y registra warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const segBad = makeSegment({
      id: 'seg-bad',
      kmlId: 'BAD',
      coordinates: [
        { lat: NaN, lng: NaN },
        { lat: 0, lng: 0 },
      ],
    });
    const segOk = makeSegment({ id: 'seg-ok', kmlId: 'OK' });
    const kml = routeToKml(makeRoute([segBad, segOk]));

    expect(kml).not.toContain('>BAD<');
    expect(kml).toContain('>OK<');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Se omitieron 1'),
    );
    warnSpy.mockRestore();
  });
});

describe('sanitizeKmlFileName', () => {
  it('elimina caracteres reservados y conserva espacios normales', () => {
    expect(sanitizeKmlFileName('mi ruta / final?.kml')).toBe('mi ruta  final.kml');
  });

  it('fuerza extensión .kml si no está presente', () => {
    expect(sanitizeKmlFileName('madrid')).toBe('madrid.kml');
    expect(sanitizeKmlFileName('madrid.KML')).toBe('madrid.KML');
  });

  it('conserva mayúsculas/minúsculas del nombre original', () => {
    expect(sanitizeKmlFileName('Madrid Centro')).toBe('Madrid Centro.kml');
    expect(sanitizeKmlFileName('Campaña MAD 2026')).toBe('Campaña MAD 2026.kml');
  });

  it('devuelve "ruta.kml" si el nombre queda vacío tras limpiar', () => {
    expect(sanitizeKmlFileName('///???')).toBe('ruta.kml');
    expect(sanitizeKmlFileName('   ')).toBe('ruta.kml');
  });

  it('elimina caracteres prohibidos: \\ : * ? " < > |', () => {
    expect(sanitizeKmlFileName('a\\b:c*d?e"f<g>h|i.kml')).toBe('abcdefghi.kml');
  });
});

describe('uniqueKmlFileName', () => {
  const fixedDate = new Date(2026, 3, 25, 10, 15, 30); // 25 abr 2026 10:15:30 local

  it('añade sufijo de fecha/hora antes de la extensión', () => {
    expect(uniqueKmlFileName('Madrid 2026.kml', fixedDate)).toBe(
      'Madrid 2026 - 20260425-101530.kml',
    );
  });

  it('conserva mayúsculas y espacios del nombre original', () => {
    const out = uniqueKmlFileName('Campaña MAD Test', fixedDate);
    expect(out).toBe('Campaña MAD Test - 20260425-101530.kml');
  });

  it('genera nombres distintos en momentos distintos', () => {
    const a = uniqueKmlFileName('ruta.kml', new Date(2026, 0, 1, 9, 0, 0));
    const b = uniqueKmlFileName('ruta.kml', new Date(2026, 0, 1, 9, 0, 1));
    expect(a).not.toBe(b);
  });

  it('no duplica el sufijo si ya está presente', () => {
    const once = uniqueKmlFileName('ruta.kml', fixedDate);
    const twice = uniqueKmlFileName(once, fixedDate);
    expect(twice).toBe(once);
  });

  it('aplica saneado y añade extensión si falta', () => {
    const out = uniqueKmlFileName('mala/ruta?', fixedDate);
    expect(out).toBe('malaruta - 20260425-101530.kml');
  });

  it('devuelve nombre válido aunque el original esté vacío', () => {
    const out = uniqueKmlFileName('', fixedDate);
    expect(out).toBe('ruta - 20260425-101530.kml');
  });
});
