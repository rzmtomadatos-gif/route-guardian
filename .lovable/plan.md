# Hotfix Overpass — Generación por zona y enriquecimiento manual

## 1. Diagnóstico

Verificado en `src/utils/overpass-api.ts` y `src/pages/MapPage.tsx`:

- **`buildOverpassQuery`** genera una query por **cada combinación** `way["highway"="X"](poly:"...")`. Para "Calles urbanas" en zona mediana son fácilmente 4 × N celdas → satura Overpass y devuelve 504/429.
- **`executeOverpassQuery`** usa un único endpoint, sin reintentos, sin timeout configurable, sin `AbortController`.
- **`fetchNearestRoad`** usa `out tags 1;` → devuelve **la primera way** que encuentre el servidor, no la más cercana al punto. Por eso el enriquecimiento manual da nombres inconsistentes o vacíos.
- **`handleFetchRoads`** (MapPage L742) muestra siempre el toast genérico `"Error al consultar las vías. Intenta con una zona más pequeña"` aunque el fallo sea timeout/red/empty.
- **`AreaSelectionDialog`** no propaga ningún `AbortSignal`: pulsar Cancelar solo cierra el modal, las peticiones siguen vivas.
- Filtro `residential` actual: `['residential','living_street','unclassified','service']` → falta `tertiary`, `secondary` y sus `_link`, que en OSM son habituales en avenidas urbanas.

## 2. Plan de cambios

### 2.1 `src/utils/overpass-api.ts` — núcleo robusto

**Tipos nuevos**
```ts
export type OverpassErrorKind =
  | 'rate_limit' | 'timeout' | 'network'
  | 'empty' | 'query' | 'aborted' | 'unknown';

export class OverpassError extends Error {
  constructor(public kind: OverpassErrorKind, message: string, public cause?: unknown) { ... }
}

export interface OverpassWay {
  id: number;          // mantiene compatibilidad (= osmId)
  osmId: number;       // explícito, mismo valor que id
  name: string;
  ref?: string;        // referencia carretera/calle
  highway: string;
  coordinates: LatLng[];
  oneway: boolean;
  onewayReverse: boolean;
}

export interface OverpassOptions {
  signal?: AbortSignal;
  timeoutMs?: number;       // default 35000
  onProgress?: (msg: string) => void;
}
```

**Mirrors (resiliencia, no garantía)**
```ts
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
```
Comentario explícito en el código: *"Endpoints públicos. Pueden fallar o tener cuota. Esto es resiliencia, no infraestructura. TODO fase futura: caché bbox + throttling + posible proxy propio."*

**`executeOverpassQuery(query, options)`**
- Recorre mirrors en orden con failover.
- Por cada mirror: hasta 2 intentos con backoff exponencial (500ms, 1500ms) si recibe 429/504.
- `fetch` con `AbortController` propio que escucha `options.signal` y un timeout interno (`timeoutMs` default 35s).
- Mapea fallos a `OverpassError` tipado:
  - `signal.aborted` → `aborted`
  - `TypeError` (fetch) → `network`
  - `AbortError` por timeout → `timeout`
  - `429` agotados → `rate_limit`
  - `400` → `query`
  - parseo JSON fallido → `unknown`
- Si todos los mirrors fallan, lanza el último `OverpassError`.

**Filtro "Calles urbanas" ampliado**
```ts
residential: {
  label: 'Calles urbanas',
  osmTypes: [
    'residential','living_street',
    'tertiary','tertiary_link',
    'secondary','secondary_link',
    'unclassified','service','pedestrian',
  ],
  description: 'Calles dentro de poblaciones',
}
```
Comentario en el código: *"`service` puede traer accesos/parkings. Aceptado por ahora; preparado para subtipo configurable más adelante."*

**Query optimizada (regex en lugar de N subqueries)**
```ts
function buildOverpassQuery(polygon, categories) {
  const polyStr = polygon.map(p => `${p.lat} ${p.lng}`).join(' ');
  const types = uniqueTypes(categories);
  const regex = `^(${types.join('|')})$`;
  return `[out:json][timeout:30];
way["highway"~"${regex}"](poly:"${polyStr}");
out body geom;`;
}
```
Mismo patrón para `fetchRoadsInCircle` con `(around:R,lat,lng)`. Reduce drásticamente el tamaño de la query y el coste en el servidor. `out body geom` evita la segunda pasada `>; out skel qt` y trae geometría directa.

**Subdivisión de bbox grandes con filtro contra polígono original**
```ts
fetchRoadsInArea(polygon, categories, options?) {
  const bbox = computeBBox(polygon);
  const areaKm2 = bboxAreaKm2(bbox);
  const cells = areaKm2 > 25 ? splitBBox(bbox, gridFor(areaKm2)) : [bbox];

  const all = new Map<number, OverpassWay>();
  for (const cell of cells) {
    if (options?.signal?.aborted) throw new OverpassError('aborted', 'Cancelado');
    const cellPoly = bboxToPolygon(cell);
    const ways = await executeOverpassQuery(buildQuery(cellPoly, categories), options);
    for (const w of ways) {
      if (!all.has(w.osmId) && intersectsPolygon(w.coordinates, polygon)) {
        all.set(w.osmId, clipToPolygon(w, polygon));   // recorta vías parcialmente fuera
      }
    }
  }
  return [...all.values()];
}
```
Reglas obligatorias del filtrado:
- Dedup por `osmId`.
- `intersectsPolygon`: descarta vías cuya geometría completa cae fuera del polígono original (las celdas bbox son superconjunto).
- `clipToPolygon`: si una way cruza el borde, conserva solo los nodos dentro + un nodo de borde por cada entrada/salida. Implementación pragmática (no Sutherland-Hodgman completo): mantiene runs contiguos de puntos `inside` con un punto `outside` de transición a cada lado para no cortar visualmente la línea.

**`fetchNearestRoad(point, options)` — geometría real**
```ts
const query = `[out:json][timeout:10];
way(around:150,${lat},${lng})["highway"];
out body geom;`;
```
Después:
- Para cada way, calcula distancia perpendicular del punto a cada segmento consecutivo de su geometría con `distanceToSegment` (ya existe en `route-optimizer.ts`).
- Devuelve la way con distancia mínima.
- Estrategia escalada: primer intento radio 50m; si vacío, 150m. (No 30/80/150 — simplifica.)
- Devuelve también `osmId`, `ref`, `oneway` además de `name`/`highway`.

### 2.2 `src/components/AreaSelectionDialog.tsx`

- Recibe nueva prop opcional `onCancel: () => void` (ya existe `onClose`).
- El botón "Cancelar" durante carga llama a `onCancel?.()` para que MapPage aborte la petición real, además de cerrar.

### 2.3 `src/pages/MapPage.tsx`

**`handleFetchRoads`** — abort + errores diferenciados:
```ts
const abortRef = useRef<AbortController | null>(null);

const handleFetchRoads = useCallback(async (categories, layerName) => {
  abortRef.current?.abort();
  const ctrl = new AbortController();
  abortRef.current = ctrl;
  setIsLoadingArea(true);
  setPendingLayerName(layerName);
  try {
    const ways = areaMode === 'circle' && circleParams
      ? await fetchRoadsInCircle(circleParams.center, circleParams.radiusMeters, categories, { signal: ctrl.signal })
      : await fetchRoadsInArea(getAreaPolygon(), categories, { signal: ctrl.signal });
    if (ctrl.signal.aborted) return;
    if (!ways.length) {
      toast.warning('No se encontraron vías del tipo seleccionado en esta zona');
      return;
    }
    setFetchedWays(ways);
    setShowAreaDialog(false);
    setShowResultsDialog(true);
  } catch (err) {
    if (err instanceof OverpassError) {
      switch (err.kind) {
        case 'aborted':    return;                                // silencioso
        case 'rate_limit': toast.error('Servidor OSM saturado. Reintenta en unos segundos.'); break;
        case 'timeout':    toast.error('Consulta demasiado lenta. Reduce la zona o reintenta.'); break;
        case 'network':    toast.error('Sin conexión. Comprueba la red y reintenta.'); break;
        case 'query':      toast.error('Error de consulta Overpass. Revisa los filtros.'); break;
        default:           toast.error('Error inesperado consultando vías.'); break;
      }
    } else {
      toast.error('Error inesperado consultando vías.');
    }
    console.error('[Overpass]', err);
  } finally {
    if (abortRef.current === ctrl) abortRef.current = null;
    setIsLoadingArea(false);
  }
}, [...]);

const handleAreaCancel = useCallback(() => {
  abortRef.current?.abort();
  abortRef.current = null;
  setIsLoadingArea(false);
  setShowAreaDialog(false);
}, []);
```
- Eliminar la doble pasada `fetchCompleteRoads` en modo círculo: ya no aporta valor con `out body geom` y consume cuota innecesariamente. Mantener `fetchCompleteRoads` exportado por compatibilidad pero no usarlo desde `handleFetchRoads`.

**`fetchNearestRoad` para tramo manual** (L487):
- Pasar `{ signal }` ligado al ciclo de vida del panel de creación.
- Recibir `osmId`, `ref`, `oneway`. Propagar al `SegmentCreatorPanel` para que el `Segment` final lleve los metadatos.

### 2.4 `src/components/SegmentCreatorPanel.tsx`

Construcción del `Segment` final:
```ts
const displayName =
  (roadInfo?.name && roadInfo.name.trim()) ||
  (roadInfo?.ref && roadInfo.ref.trim()) ||
  name.trim() ||
  'Tramo manual sin nombre';

const segment: Segment = {
  id: Math.random().toString(36).substring(2, 10),  // id interno VialRoute, NO sobrescribir
  // id_unico se mantiene como lo gestione la app (no se toca aquí)
  ...
  name: displayName,
  kmlMeta: {
    carretera: roadInfo?.ref || roadInfo?.name,
    tipo: roadInfo?.highway,
    sentido: roadInfo?.oneway ? 'único' : undefined,
    osmId: roadInfo?.osmId,
    ref: roadInfo?.ref,
    source: roadInfo ? 'osm' : 'manual',
  },
};
```
Regla: nunca pisar `id` interno con `osmId`. `kmlMeta.osmId` es el campo explícito.

### 2.5 Generación desde área (en `handleConfirmGeneration`)

Igual: `kmlMeta` recibe `osmId`, `ref`, `source: 'osm'`. `id` interno sigue siendo el random. `kmlId` mantiene `osm-${way.id}` para no romper consumidores existentes.

## 3. Identificadores — regla cerrada

| Campo | Origen | Propósito |
|---|---|---|
| `Segment.id` | `Math.random()` interno | id interno VialRoute |
| `Segment.id_unico` | gestión existente de la app | id operativo — **no se toca** |
| `Segment.kmlId` | `osm-${osmId}` o KML original | trazabilidad de origen |
| `Segment.kmlMeta.osmId` | OSM | identificador OSM explícito |
| `Segment.kmlMeta.ref` | OSM `ref` | referencia carretera |
| `Segment.kmlMeta.source` | `"osm" \| "manual" \| "kml"` | procedencia |
| `OverpassWay.id` | OSM way id | mantiene compatibilidad existente |
| `OverpassWay.osmId` | igual a `id` | nombre explícito nuevo |

## 4. Archivos

### Modificados
- `src/utils/overpass-api.ts` — `OverpassError`, mirrors+failover+abort+timeout, query con regex+`out body geom`, subdivisión bbox+filtro polígono, `fetchNearestRoad` con geometría real, filtro `residential` ampliado, `OverpassWay` con `osmId`/`ref`.
- `src/pages/MapPage.tsx` — `AbortController` para área y para `fetchNearestRoad`, errores diferenciados, eliminar `fetchCompleteRoads` del flujo activo, propagar `osmId`/`ref` a tramo manual.
- `src/components/AreaSelectionDialog.tsx` — prop `onCancel`, llamarla en Cancel durante carga.
- `src/components/SegmentCreatorPanel.tsx` — fallback de nombre + `kmlMeta` enriquecido.

### Nuevos
- `src/test/overpass-api.test.ts` — pruebas unitarias de:
  - `executeOverpassQuery` aborta con `AbortSignal`.
  - failover entre mirrors (mock fetch).
  - mapeo de status → `OverpassErrorKind`.
  - `intersectsPolygon` y `clipToPolygon` con vía cruzando borde.
  - `fetchNearestRoad` elige por distancia perpendicular, no por orden de respuesta.
  - filtro `residential` incluye `secondary`/`tertiary`.

### NO se tocan
- Tipos `Segment`/`AppState` (solo se añaden claves opcionales en `kmlMeta`, ya es `Record<string, any>`).
- `fetchCompleteRoads` y `mergeWaysByName` (export se mantiene por compatibilidad).
- KML import/parser, navegación, RST, GPS log, gabinete.

## 5. Riesgos reales

1. **`clipToPolygon` simplificado**: no es Sutherland-Hodgman completo. Una vía que entra y sale varias veces puede generar una polilínea con un par de saltos visuales. Aceptable para esta fase: mejor que crear tramos kilómetros fuera del área. Documentado como TODO.
2. **Mirrors públicos**: pueden caer todos a la vez. Mitigación: error tipado claro + sugerencia de reintento. No es infraestructura definitiva (anotado en código).
3. **Cambio de `out skel qt` a `out body geom`**: si algún consumidor externo dependía del formato anterior, se rompe. Verificado: solo `executeOverpassQuery` consume la respuesta.
4. **Filtro ampliado urbano**: en ciudades grandes puede multiplicar resultados. Mitigado con subdivisión bbox y deduplicado por `osmId`.

## 6. Pruebas — plan de verificación

**Unitarias** (en `overpass-api.test.ts`, mockeando `fetch`):
- abort durante consulta → `OverpassError('aborted')`.
- 429 → reintento → 200 OK devuelve ways.
- 429 persistente en todos los mirrors → `OverpassError('rate_limit')`.
- vacío → array vacío (no error).
- `fetchNearestRoad`: dadas 3 ways con geometría conocida, devuelve la más cercana al punto, no la primera de la lista.
- `clipToPolygon`: vía con 5 nodos, 2 dentro/3 fuera → resultado conserva los 2 + 1 de borde.

**Manuales en preview** (a confirmar tras implementar):
- Zona urbana pequeña en Madrid centro con "Calles urbanas" → genera tramos con nombres reales.
- Zona urbana mediana (~50 km²) → divide y termina sin error genérico.
- Polígono irregular en L → ningún tramo creado fuera del polígono dibujado.
- Tipo de vía sin presencia en zona → toast "No se encontraron vías del tipo seleccionado".
- Cancelar durante carga → modal cierra, no llega ningún resultado tardío, no aparece toast de error.
- Tramo manual sobre calle conocida → nombre + `kmlMeta.osmId`/`ref`/`source: 'osm'`.
- Tramo manual sobre vía sin `name` con `ref` → usa `ref` como nombre.
- Repetir generación sobre misma zona → no duplica (dedup por `osmId` dentro de la generación; los duplicados entre generaciones distintas se aceptan, son intención del operador).

## 7. Lo que NO se hace ahora
- Caché local persistente por bbox/radio.
- Throttling/cola de peticiones.
- Backend/proxy propio.
- Subtipo configurable para `service`.
- Excel, gabinete GPX/KML, comparación geométrica esperada vs real.
