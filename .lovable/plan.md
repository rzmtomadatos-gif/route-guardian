
# Hotfix Overpass — 3 condiciones de control finales

Refinamiento sobre el plan ya implementado. Tres ajustes quirúrgicos: timeout global cancelable, validación geométrica post-clipping y aviso de duplicados antes de insertar. No se reabre nada del flujo principal.

## 1. Timeout global por operación + cancelación fiable

**Problema actual:** cada petición HTTP tiene timeout de 35 s, pero una zona dividida en hasta 16 celdas (4×4) con failover entre 3 mirrors podría llegar teóricamente a varios minutos si todo va mal. La cancelación por usuario funciona, pero si no cancela, se queda esperando.

**Solución en `src/utils/overpass-api.ts`:**

- Añadir parámetro `globalTimeoutMs` a `OverpassOptions` (default `120_000` = 2 min).
- En `fetchRoadsInArea` y `fetchRoadsInCircle`, crear un `AbortController` interno encadenado con el `signal` del usuario:
  - se aborta si el usuario aborta
  - se aborta si se supera `globalTimeoutMs`
- Si el global timeout se dispara: lanzar `OverpassError('timeout', 'Operación demasiado lenta. Reduce la zona.')`.
- El check `if (options.signal?.aborted)` antes de cada celda ya existe; se mantiene y se complementa con el signal encadenado.
- La cancelación del usuario sigue funcionando exactamente igual (idempotente).

**Detalle técnico encadenado:**

```ts
const linked = new AbortController();
const onUserAbort = () => linked.abort();
options.signal?.addEventListener('abort', onUserAbort, { once: true });
const globalTimer = setTimeout(() => linked.abort(), globalTimeoutMs);
// ... bucle de celdas usa { signal: linked.signal }
// finally: clearTimeout + removeEventListener + distinguir si abort fue por timeout o por usuario
```

Si `linked.signal.aborted` y el usuario NO había abortado → fue timeout global → mapear a `OverpassError('timeout', ...)`. Si el usuario abortó → propagar `OverpassError('aborted', ...)`.

## 2. Validación geométrica tras `clipWayToPolygon`

**Problema actual:** la implementación pragmática de clipping solo descarta resultado con `< 2` coords. No detecta:
- Vías que cruzan el polígono con un solo punto interior + dos vecinos lejanos → polilínea con saltos absurdos.
- Vías que entran y salen varias veces → genera una sola polilínea falsa que une trozos discontinuos.

**Solución — nueva función `splitWayByPolygon` en `src/utils/overpass-api.ts`:**

En lugar de devolver una sola lista plana de puntos, devolver **runs contiguos** de puntos `inside` con un único vecino de borde a cada lado:

```ts
export function splitWayByPolygon(coords: LatLng[], polygon: LatLng[]): LatLng[][] {
  // Devuelve N sub-polilíneas, cada una continua y geométricamente válida.
  // Cada run = secuencia inside + 1 vecino exterior a cada extremo.
}
```

**Validación adicional aplicada a cada run resultante:**
- Mínimo 2 coords (descartar si menos).
- Salto máximo entre puntos consecutivos: si supera `MAX_SEGMENT_GAP_M = 500 m`, descartar el run y registrar `console.warn('[Overpass] run descartado por salto', osmId, gap)`.
- Si `intersectsPolygon(run, polygon)` falla para todos los puntos del run → descartar.

**Integración en `fetchRoadsInArea`:**

```ts
const runs = splitWayByPolygon(w.coordinates, polygon);
if (runs.length === 0) continue;
runs.forEach((run, idx) => {
  // Si una vía produce N runs, generar N entradas con sufijo en osmId interno.
  // Mantener osmId original real, pero en el Map usar clave compuesta.
  const key = runs.length === 1 ? w.osmId : `${w.osmId}#${idx}`;
  if (all.has(key)) return;
  all.set(key, { ...w, coordinates: run });
});
```

**Cambio de tipo:** la clave del Map pasa de `number` a `string | number`. Solo es interno a la función, no afecta al tipo público `OverpassWay` (sigue teniendo `osmId: number` real).

## 3. Aviso de duplicados antes de insertar

**Problema actual:** `handleConfirmGeneration` en `MapPage.tsx` inserta todos los ways como segmentos sin comprobar si ya existían `osmId` en la ruta. El operador no se entera.

**Solución en `src/pages/MapPage.tsx`:**

Antes de mostrar `AreaResultsDialog` (o dentro de él), calcular cuántos `osmId` de los `fetchedWays` ya existen en `state.route?.segments`:

```ts
const existingOsmIds = new Set(
  state.route?.segments
    .map(s => s.kmlMeta?.osmId)
    .filter((x): x is number => typeof x === 'number')
);
const duplicateCount = fetchedWays.filter(w => existingOsmIds.has(w.osmId)).length;
```

**Dónde mostrarlo:** en `AreaResultsDialog` (componente que ya muestra el resumen previo a confirmar). Añadir una línea visible:

```
⚠ N vías ya existen en la ruta y se duplicarán si confirmas
```

Si `duplicateCount === 0`: no mostrar nada. No bloquear nunca la inserción — el operador decide. Conservación del comportamiento actual: tras confirmar, se insertan todas (la deduplicación entre generaciones distintas no se bloquea, solo se comunica).

**Cambio mínimo en props de `AreaResultsDialog`:** añadir `duplicateCount?: number` opcional, retrocompatible.

## Archivos a tocar

### Modificados
- `src/utils/overpass-api.ts`
  - Añadir `globalTimeoutMs` a `OverpassOptions`.
  - Encadenar abort en `fetchRoadsInArea` y `fetchRoadsInCircle`.
  - Sustituir `clipWayToPolygon` por `splitWayByPolygon` (mantener `clipWayToPolygon` exportado por compatibilidad de tests, marcado deprecated en JSDoc).
  - Constante `MAX_SEGMENT_GAP_M = 500`.
- `src/pages/MapPage.tsx`
  - Calcular `duplicateCount` antes de abrir `AreaResultsDialog`.
  - Pasar prop al diálogo.
- `src/components/AreaResultsDialog.tsx`
  - Aceptar prop `duplicateCount` opcional, mostrar banner amarillo si `> 0`.

### Tests a ampliar
- `src/test/overpass-api.test.ts`:
  - `splitWayByPolygon` divide vía que entra/sale dos veces en 2 runs.
  - `splitWayByPolygon` descarta runs con salto > 500 m.
  - `splitWayByPolygon` con vía totalmente fuera devuelve `[]`.
  - `fetchRoadsInArea` aborta con `globalTimeoutMs` simulado.
  - `fetchRoadsInArea` distingue abort por usuario vs timeout global en el error final.

### NO se toca
- `executeOverpassQuery` (núcleo con failover y reintentos sigue intacto).
- `fetchNearestRoad` (creación manual ya quedó correcta en la fase previa).
- `SegmentCreatorPanel.tsx`.
- Schema de campaña.

## Riesgos reales

1. **Cambio de comportamiento en clipping**: vías que antes generaban una sola polilínea con saltos ahora pueden dividirse en varios sub-tramos. Es lo que quiere el operador, pero aumenta el número de segmentos creados en zonas con vías que rodean el polígono. Mitigación: el banner de duplicados informa del total real.
2. **Timeout global de 2 min**: razonable para zonas grandes con divisiones. Si en pruebas reales resulta corto, se ajusta vía constante única. No es valor mágico repartido por el código.
3. **`AreaResultsDialog`**: cambio mínimo y opcional, retrocompatible.

## Criterios de aceptación

1. Generar zona muy grande con todos los mirrors lentos → en 2 min máximo se aborta con mensaje claro de timeout.
2. Cancelar manualmente durante la consulta → aborta inmediatamente, no espera al timeout.
3. Vía OSM que entra/sale del polígono dos veces → genera 2 segmentos, no 1 con saltos.
4. Vía con un solo punto interior y vecinos a >500 m → se descarta con warning en consola.
5. Generar zona donde 5 ways ya existen como segmentos → diálogo muestra "5 vías ya existen y se duplicarán".
6. Confirmar igualmente → inserta todo, no bloquea (decisión del operador).
7. Tests existentes siguen pasando + 5 tests nuevos verdes.
