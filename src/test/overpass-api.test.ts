import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  fetchRoadsInArea,
  fetchRoadsInCircle,
  fetchNearestRoad,
  OverpassError,
  ROAD_CATEGORIES,
  pointInPolygon,
  intersectsPolygon,
  clipWayToPolygon,
  splitWayByPolygon,
  __test__,
} from '@/utils/overpass-api';

const { distancePointToPolyline, OVERPASS_MIRRORS } = __test__;

const okResponse = (body: any): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const errResponse = (status: number): Response =>
  new Response('error', { status });

function makeWayElement(
  id: number,
  coords: Array<[number, number]>,
  tags: Record<string, string> = {},
) {
  return {
    type: 'way',
    id,
    geometry: coords.map(([lat, lon]) => ({ lat, lon })),
    tags: { highway: 'residential', ...tags },
  };
}

describe('overpass-api', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    // @ts-ignore
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Filtro Calles urbanas ampliado
  // ---------------------------------------------------------------------------
  describe('ROAD_CATEGORIES.residential', () => {
    it('incluye secondary, tertiary y sus _link', () => {
      const types = ROAD_CATEGORIES.residential.osmTypes;
      expect(types).toEqual(
        expect.arrayContaining([
          'residential',
          'living_street',
          'tertiary',
          'tertiary_link',
          'secondary',
          'secondary_link',
          'unclassified',
          'service',
          'pedestrian',
        ]),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Geometría: pointInPolygon, intersección, recorte
  // ---------------------------------------------------------------------------
  describe('pointInPolygon / intersectsPolygon / clipWayToPolygon', () => {
    const square = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 10 },
      { lat: 10, lng: 10 },
      { lat: 10, lng: 0 },
    ];

    it('detecta puntos dentro y fuera', () => {
      expect(pointInPolygon({ lat: 5, lng: 5 }, square)).toBe(true);
      expect(pointInPolygon({ lat: -1, lng: 5 }, square)).toBe(false);
    });

    it('descarta vías totalmente fuera del polígono', () => {
      const outside = [
        { lat: 20, lng: 20 },
        { lat: 21, lng: 21 },
      ];
      expect(intersectsPolygon(outside, square)).toBe(false);
    });

    it('clipWayToPolygon conserva nodos dentro + vecinos de borde', () => {
      // Vía con 5 nodos: 2 dentro (idx 1,2), 3 fuera (idx 0,3,4)
      const coords = [
        { lat: -5, lng: 5 }, // fuera
        { lat: 2, lng: 5 },  // dentro
        { lat: 4, lng: 5 },  // dentro
        { lat: 15, lng: 5 }, // fuera
        { lat: 20, lng: 5 }, // fuera
      ];
      const clipped = clipWayToPolygon(coords, square);
      // Esperado: idx 0 (vecino), 1, 2 (dentro), 3 (vecino). idx 4 fuera.
      expect(clipped).toHaveLength(4);
      expect(clipped[0]).toEqual(coords[0]);
      expect(clipped[1]).toEqual(coords[1]);
      expect(clipped[2]).toEqual(coords[2]);
      expect(clipped[3]).toEqual(coords[3]);
    });
  });

  // ---------------------------------------------------------------------------
  // distancePointToPolyline
  // ---------------------------------------------------------------------------
  describe('distancePointToPolyline', () => {
    it('devuelve ~0 cuando el punto cae sobre la línea', () => {
      const line = [
        { lat: 40.0, lng: -3.7 },
        { lat: 40.0, lng: -3.6 },
      ];
      const d = distancePointToPolyline({ lat: 40.0, lng: -3.65 }, line);
      expect(d).toBeLessThan(1);
    });

    it('crece con distancia perpendicular', () => {
      const line = [
        { lat: 40.0, lng: -3.7 },
        { lat: 40.0, lng: -3.6 },
      ];
      const dNear = distancePointToPolyline({ lat: 40.0001, lng: -3.65 }, line);
      const dFar = distancePointToPolyline({ lat: 40.001, lng: -3.65 }, line);
      expect(dNear).toBeLessThan(dFar);
    });
  });

  // ---------------------------------------------------------------------------
  // executeOverpassQuery: abort, mapeo de errores y failover
  // ---------------------------------------------------------------------------
  describe('fetch lifecycle (executeOverpassQuery vía fetchRoadsInCircle)', () => {
    it('aborta antes de enviar si signal ya está cancelado', async () => {
      const ctrl = new AbortController();
      ctrl.abort();
      await expect(
        fetchRoadsInCircle({ lat: 40, lng: -3 }, 100, ['residential'], { signal: ctrl.signal }),
      ).rejects.toMatchObject({ kind: 'aborted' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('mapea TypeError de fetch a OverpassError("network") en TODOS los mirrors', async () => {
      fetchMock.mockImplementation(async () => { throw new TypeError('Failed to fetch'); });
      await expect(
        fetchRoadsInCircle({ lat: 40, lng: -3 }, 100, ['residential']),
      ).rejects.toMatchObject({ kind: 'network' });
      // intentos = mirrors (sin reintento porque no es rate_limit)
      expect(fetchMock).toHaveBeenCalledTimes(OVERPASS_MIRRORS.length);
    });

    it('429 reintenta dentro del mismo mirror y luego salta al siguiente', async () => {
      // Cada llamada devuelve un Response NUEVO (no se puede reusar el mismo)
      fetchMock.mockImplementation(async () => errResponse(429));
      await expect(
        fetchRoadsInCircle({ lat: 40, lng: -3 }, 100, ['residential']),
      ).rejects.toMatchObject({ kind: 'rate_limit' });
      // 3 mirrors × 3 intentos (1 inicial + 2 reintentos)
      expect(fetchMock).toHaveBeenCalledTimes(OVERPASS_MIRRORS.length * 3);
    }, 30_000);

    it('failover: primer mirror falla, segundo responde OK', async () => {
      fetchMock
        .mockResolvedValueOnce(errResponse(500)) // mirror 1 → unknown, sin reintento
        .mockResolvedValueOnce(okResponse({
          elements: [makeWayElement(1, [[40, -3], [40.001, -3]])],
        }));
      const ways = await fetchRoadsInCircle({ lat: 40, lng: -3 }, 100, ['residential']);
      expect(ways).toHaveLength(1);
      expect(ways[0].osmId).toBe(1);
      expect(ways[0].id).toBe(1); // compat
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('400 → OverpassError("query")', async () => {
      fetchMock.mockImplementation(async () => errResponse(400));
      await expect(
        fetchRoadsInCircle({ lat: 40, lng: -3 }, 100, ['residential']),
      ).rejects.toMatchObject({ kind: 'query' });
    });

    it('respuesta vacía no es error: devuelve []', async () => {
      fetchMock.mockImplementation(async () => okResponse({ elements: [] }));
      const ways = await fetchRoadsInCircle({ lat: 40, lng: -3 }, 100, ['residential']);
      expect(ways).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // fetchRoadsInArea: filtra contra polígono original (no solo bbox)
  // ---------------------------------------------------------------------------
  describe('fetchRoadsInArea', () => {
    it('descarta vías cuya geometría completa está fuera del polígono', async () => {
      const polygon = [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 1 },
        { lat: 1, lng: 0 },
      ];
      fetchMock.mockImplementation(async () => okResponse({
        elements: [
          makeWayElement(10, [[0.1, 0.1], [0.2, 0.2]]),       // dentro
          makeWayElement(20, [[0.95, 0.95], [0.99, 0.99]]),   // fuera del triángulo (pero dentro del bbox)
        ],
      }));
      const ways = await fetchRoadsInArea(polygon, ['residential']);
      const ids = ways.map((w) => w.osmId).sort();
      expect(ids).toEqual([10]);
    });
  });

  // ---------------------------------------------------------------------------
  // fetchNearestRoad: elige por distancia perpendicular real
  // ---------------------------------------------------------------------------
  describe('fetchNearestRoad', () => {
    it('elige la vía más cercana al punto, no la primera', async () => {
      // Punto de consulta
      const point = { lat: 40.0, lng: -3.7 };
      // way A: lejos (devuelta primero por Overpass)
      // way B: muy cerca (devuelta después)
      fetchMock.mockResolvedValueOnce(okResponse({
        elements: [
          makeWayElement(1, [[40.01, -3.7], [40.011, -3.7]], { name: 'Lejana', highway: 'residential' }),
          makeWayElement(2, [[40.0001, -3.7], [40.0001, -3.69]], { name: 'Cercana', highway: 'residential', ref: 'X-1' }),
        ],
      }));
      const info = await fetchNearestRoad(point);
      expect(info?.osmId).toBe(2);
      expect(info?.name).toBe('Cercana');
      expect(info?.ref).toBe('X-1');
    });

    it('escala radio: si el primer intento (50m) está vacío, prueba 150m', async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ elements: [] })) // 50m vacío
        .mockResolvedValueOnce(okResponse({
          elements: [makeWayElement(7, [[40.0, -3.7], [40.0001, -3.7]], { name: 'Encontrada' })],
        })); // 150m con resultado
      const info = await fetchNearestRoad({ lat: 40, lng: -3.7 });
      expect(info?.osmId).toBe(7);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('devuelve null si ningún radio encuentra vías', async () => {
      fetchMock.mockImplementation(async () => okResponse({ elements: [] }));
      const info = await fetchNearestRoad({ lat: 40, lng: -3.7 });
      expect(info).toBeNull();
    });
  });

  describe('splitWayByPolygon', () => {
    // Cuadrado unitario [0,0]-[1,1]
    const square = [
      { lat: 0, lng: 0 }, { lat: 0, lng: 1 },
      { lat: 1, lng: 1 }, { lat: 1, lng: 0 },
    ];

    it('vía totalmente fuera devuelve []', () => {
      const coords = [{ lat: 5, lng: 5 }, { lat: 5, lng: 6 }];
      expect(splitWayByPolygon(coords, square)).toEqual([]);
    });

    it('vía totalmente dentro devuelve un solo run', () => {
      const coords = [{ lat: 0.2, lng: 0.2 }, { lat: 0.4, lng: 0.4 }, { lat: 0.6, lng: 0.6 }];
      const runs = splitWayByPolygon(coords, square);
      expect(runs).toHaveLength(1);
      expect(runs[0].length).toBe(3);
    });

    it('vía que entra y sale dos veces se divide en 2 runs', () => {
      // dentro - fuera - fuera - dentro - dentro - fuera
      const coords = [
        { lat: 0.5, lng: 0.5 },   // in
        { lat: 0.5, lng: 1.0001 },// out (apenas)
        { lat: 0.5, lng: 1.0002 },// out
        { lat: 0.5, lng: 0.7 },   // in (vuelve)
        { lat: 0.5, lng: 0.8 },   // in
        { lat: 0.5, lng: 1.0003 },// out
      ];
      const runs = splitWayByPolygon(coords, square);
      expect(runs).toHaveLength(2);
      // Cada run >= 2 puntos
      for (const r of runs) expect(r.length).toBeGreaterThanOrEqual(2);
    });

    it('descarta run con salto > 500 m entre puntos consecutivos', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // Punto interior con vecino exterior a varios km
      const coords = [
        { lat: 5, lng: 5 },       // out, lejísimos
        { lat: 0.5, lng: 0.5 },   // in
        { lat: 5, lng: 5.001 },   // out, lejísimos
      ];
      const runs = splitWayByPolygon(coords, square, 999);
      expect(runs).toEqual([]);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe('fetchRoadsInArea — timeout global', () => {
    it('aborta con OverpassError(timeout) si globalTimeoutMs se supera', async () => {
      vi.useFakeTimers();
      // fetch que nunca resuelve a menos que se aborte
      fetchMock.mockImplementation((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const e: any = new Error('AbortError');
            e.name = 'AbortError';
            reject(e);
          });
        }),
      );

      // Polígono pequeño (1 sola celda)
      const poly = [
        { lat: 0, lng: 0 }, { lat: 0, lng: 0.001 },
        { lat: 0.001, lng: 0.001 }, { lat: 0.001, lng: 0 },
      ];
      const promise = fetchRoadsInArea(poly, ['highway'], { globalTimeoutMs: 50 });
      // Atrapar rechazo antes de avanzar timers
      const caught = promise.catch((e) => e);
      await vi.advanceTimersByTimeAsync(60);
      const err = await caught;
      expect(err).toBeInstanceOf(OverpassError);
      expect(err.kind).toBe('timeout');
      vi.useRealTimers();
    });

    it('si el usuario aborta antes del timeout, error es aborted (no timeout)', async () => {
      fetchMock.mockImplementation((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const e: any = new Error('AbortError');
            e.name = 'AbortError';
            reject(e);
          });
        }),
      );
      const ctrl = new AbortController();
      const poly = [
        { lat: 0, lng: 0 }, { lat: 0, lng: 0.001 },
        { lat: 0.001, lng: 0.001 }, { lat: 0.001, lng: 0 },
      ];
      const promise = fetchRoadsInArea(poly, ['highway'], {
        signal: ctrl.signal,
        globalTimeoutMs: 5000,
      });
      const caught = promise.catch((e) => e);
      // El usuario cancela inmediatamente
      setTimeout(() => ctrl.abort(), 10);
      const err = await caught;
      expect(err).toBeInstanceOf(OverpassError);
      expect(err.kind).toBe('aborted');
    });
  });
});