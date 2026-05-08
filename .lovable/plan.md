# Plan: Trimble operativo en mapa + copiloto (revisado)

Objetivo: en `TRIMBLE_LIDAR`, el operador trabaja desde el mapa sin buscar tramos. La cola sale del orden operativo real (`activeRouteBlock` o `optimizedOrder`), el conductor recibe inicio+fin de los próximos tramos vía batch existente, y al cerrar una captura se avanza automáticamente.

## 1. Utilidad pura: `src/utils/trimble/recording-queue.ts`

### `deriveTrimbleSegmentStatus(segmentId, captures, activeRunId)` → `TrimbleSegmentStatus`

Algoritmo (estricto, en este orden):

1. Captura abierta del segmento en el run activo (`runId === activeRunId && endedAt === null`) → `en_captura`.
2. De las capturas cerradas del segmento (`endedAt !== null`), tomar la **última** por `endedAt`.
3. Si esa última tiene `qaStatus` no nulo → devolver `qaStatus`.
4. Si no, devolver su `fieldStatus`.
5. Si no hay capturas → `pendiente`.

No prioriza "existe alguna descartada/OK"; solo cuenta la **última cerrada**.

### `buildTrimbleRecordingQueue(state, visibleSegmentIds, orderIds, limit)`

Firma:

```ts
buildTrimbleRecordingQueue(
  state: AppState,
  visibleSegmentIds: Set<string>,
  orderIds: string[],
  limit: number = SEGMENTS_PER_BATCH
): Array<{ segment: Segment; status: TrimbleSegmentStatus; start: LatLng; end: LatLng; positionInOrder: number }>
```

Reglas:

- Recorre `orderIds` en orden.
- Filtra: presentes en `visibleSegmentIds` y existentes en `state.route.segments`.
- **Incluir** solo: `pendiente`, `en_captura`, `repetir`.
- **Excluir**: `capturado_pendiente_proceso`, `procesado_ok`, `procesado_con_observaciones`, `descartado_por_calidad`, `no_capturable`.
(Si gabinete quiere repetir un tramo aceptado con observaciones, debe marcarlo como `repetir`.)
- `start = coordinates[0]`, `end = coordinates[length-1]`.
- Devuelve hasta `limit` (por defecto `SEGMENTS_PER_BATCH = 4`).

## 2. Copiloto: reutilizar batch existente

No duplicar nada de `src/utils/google-maps-batch.ts`. Añadir solo wrapper en el mismo archivo o en `recording-queue.ts`:

```ts
trimbleQueueToStops(
  queue: Array<{ start: LatLng; end: LatLng }>
): BatchStop[]
```

- Para cada item de la cola: empuja `{ lat: start.lat, lng: start.lng }` y `{ lat: end.lat, lng: end.lng }`.
- 4 tramos × 2 = 8 paradas. Encaja con el límite implícito de Google Maps (no se sube a 5/10 paradas hasta validar en campo).

`QueueItem` (Realtime) de Trimble: una entrada por parada con nombre claro:

```
[
  { segmentId: s.id, name: `INICIO · ${s.name}`, lat: start.lat, lng: start.lng },
  { segmentId: s.id, name: `FIN · ${s.name}`,    lat: end.lat,   lng: end.lng   },
  ...
]
```

Esto hace que en `/driver-mini` el conductor vea explícitamente "INICIO" y "FIN" de cada tramo.

Helper local en `MapPage`:

```ts
function buildTrimbleCopilotPayload(queue) {
  const stops = trimbleQueueToStops(queue);            // 8 paradas si SEGMENTS_PER_BATCH=4
  const items = queue.flatMap(q => [
    { segmentId: q.segment.id, name: `INICIO · ${q.segment.name}`, lat: q.start.lat, lng: q.start.lng },
    { segmentId: q.segment.id, name: `FIN · ${q.segment.name}`,    lat: q.end.lat,   lng: q.end.lng   },
  ]);
  const url = buildGoogleMapsBatchUrl(stops);
  return { items, url };
}
```

Envío: `await copilot.pushQueue(items, 0, url);`.

## 3. Panel mapa: `src/components/trimble/TrimbleMapPanel.tsx`

Solo se monta si `state.acquisitionMode === 'TRIMBLE_LIDAR'`. Compacto, anclado al área inferior del mapa. Acciones autosuficientes — el operador no necesita ir a `/trimble`:

- **Si no hay misión activa**: botón "Abrir misión" (form mínimo en popover: vehículo + operador, resto en `/trimble`).
- **Si hay misión y no hay pasada**: botón "Abrir pasada" (selector dirección ida/vuelta + iniciar).
- **Si hay misión + pasada**:
  - Cabecera: misión + pasada activas (badges compactos).
  - "Tramo actual" (queue[0]): nombre, `companySegmentId`, badge de estado.
  - Próximos hasta `SEGMENTS_PER_BATCH - 1` tramos en lista compacta con badge.
  - Acciones del tramo actual:
    - "Iniciar captura" → `startTrimbleCapture(queue[0].segment.id)` + `onSetActiveSegment(queue[0].segment.id)`.
    - Si hay captura abierta de ese tramo: "Cerrar como capturado", "Repetir", "No capturable" → `closeTrimbleCapture(fieldStatus)`.
    - "Incidencia" → abre dialog reutilizando los inputs ya existentes en `TrimbleFieldPanel` (extraer a `TrimbleIncidentDialog` para no duplicar).
  - "Enviar al conductor" → `buildTrimbleCopilotPayload(queue)` + `copilot.pushQueue(...)`. Si no hay sesión, toast con CTA al `CopilotPanel` ya existente.

`/trimble` permanece como vista avanzada (lista manual, gestión de misiones cerradas, etc.). Etiqueta visible en su cabecera: "Vista avanzada / emergencia".

## 4. Avance automático

Tras `closeTrimbleCapture` ok:

- La cola se recalcula sola (`useMemo` sobre `state.trimbleSegmentCaptures` + `orderIds` + `visibleSegmentIds`).
- `onSetActiveSegment(newQueue[0]?.segment.id)` para centrar en mapa.
- Si `copilot.active` y la primera parada del batch nuevo difiere de la actual del conductor (`session.segment_id !== newItems[0]?.segmentId`), toast "Cola actualizada — ¿enviar al conductor?" con botón "Enviar".
- El envío automático sin confirmación se evita para no spamear al conductor en marcha.

## 5. Mapa: estado visual Trimble

En `MapPage`, cuando `acquisitionMode === 'TRIMBLE_LIDAR'`:

- Calcular `trimbleStatusBySegment: Map<string, TrimbleSegmentStatus>` con `deriveTrimbleSegmentStatus` para los segmentos visibles (memoizado por `state.trimbleSegmentCaptures` + `state.activeRunId`).
- Pasar prop opcional `trimbleStatusBySegment` a `GoogleMapDisplay` y `MapDisplay`. Si está presente, sobreescribe el color del tramo según tabla de tokens semánticos (en `index.css`):


| Estado                        | Color (token)                                                  |
| ----------------------------- | -------------------------------------------------------------- |
| `pendiente`                   | gris neutro (`--trimble-pending`)                              |
| `en_captura`                  | 🟡 amarillo (`--trimble-capturing`)                            |
| `capturado_pendiente_proceso` | azul/cyan (`--trimble-pending-process`) — distinguible de "OK" |
| `procesado_ok`                | 🟢 verde sólido (`--trimble-ok`)                               |
| `procesado_con_observaciones` | 🟡 amarillo borde discontinuo (`--trimble-ok-notes`)           |
| `repetir`                     | 🟠 naranja (`--trimble-repeat`)                                |
| `no_capturable`               | ⚫ gris oscuro (`--trimble-not-capturable`)                     |
| `descartado_por_calidad`      | 🔴 rojo (`--trimble-discarded`)                                |


Tramo actual y siguiente: borde grueso/glow (reutilizar resaltado existente de `activeSegment` y `nextSegment`).

En modo Trimble: NO se pintan overlays RST (referencias 300/150/30, F5, etc.). NO se mezclan colores RST con Trimble.

## 6. Cambios en archivos existentes

- `src/pages/MapPage.tsx`:
  - `orderIds = activeRouteBlock.length > 0 ? activeRouteBlock : state.route?.optimizedOrder ?? []`.
  - `visibleSegmentIds` desde `getVisibleMapSegments`.
  - `const trimbleQueue = useMemo(() => acquisitionMode === 'TRIMBLE_LIDAR' ? buildTrimbleRecordingQueue(state, visibleSegmentIds, orderIds) : [], [...])`.
  - `trimbleStatusBySegment` igualmente memoizado.
  - Montar `<TrimbleMapPanel ... />` cuando modo Trimble; ocultar `MapControlPanel` o reducir sus acciones RST irrelevantes.
- `src/components/GoogleMapDisplay.tsx` y `src/components/MapDisplay.tsx`:
  - Aceptar prop opcional `trimbleStatusBySegment?: Map<string, TrimbleSegmentStatus>`.
  - Si presente, usar tabla de colores Trimble en vez de la RST.
- `src/components/trimble/TrimbleFieldPanel.tsx`:
  - Extraer la sección de incidencia a `TrimbleIncidentDialog` para reutilizar en `TrimbleMapPanel`.
  - Mantener selector manual como "modo emergencia / cambio manual".
- `src/index.css`:
  - Añadir tokens HSL para los 8 estados de la tabla.

## 7. Tests nuevos

`src/test/trimble-segment-status.test.ts`:

- Captura abierta en run activo gana → `en_captura`.
- Última cerrada con `qaStatus = 'procesado_ok'` → `procesado_ok` (aunque haya una previa `descartado_por_calidad`).
- Última cerrada con `qaStatus = 'descartado_por_calidad'` → `descartado_por_calidad` (aunque haya una previa OK).
- Última cerrada sin qaStatus, fieldStatus = `repetir` → `repetir`.
- Sin capturas → `pendiente`.

`src/test/trimble-recording-queue.test.ts`:

- Respeta `orderIds` provisto.
- Filtra por `visibleSegmentIds`.
- Incluye solo `pendiente`, `en_captura`, `repetir`.
- Excluye `capturado_pendiente_proceso`, `procesado_ok`, `procesado_con_observaciones`, `descartado_por_calidad`, `no_capturable`.
- `start` = `coordinates[0]`, `end` = `coordinates[length-1]`.
- Limit por defecto `SEGMENTS_PER_BATCH` (4).

`src/test/trimble-copilot-batch.test.ts`:

- `trimbleQueueToStops`: 4 tramos → 8 paradas, en orden start, end, start, end…
- `buildGoogleMapsBatchUrl(stops)` con esas paradas: `destination` = end del último, waypoints = el resto en orden.
- `buildTrimbleCopilotPayload`: `items` tiene 8 entradas con nombres `INICIO · …` y `FIN · …`, `segmentId` repetido 2 veces consecutivas.

`src/test/trimble-auto-advance.test.ts`:

- Cerrar captura como `capturado_pendiente_proceso` → ese tramo desaparece de la cola.
- Cerrar como `repetir` → ese tramo permanece en la cola en su posición.
- Cerrar como `no_capturable` → desaparece de la cola.

`src/test/trimble-mode-isolation.test.ts` (extender):

- En `RST` y `GARMIN`, `MapPage` no calcula `trimbleStatusBySegment` ni cola (cubre el guard del memo).
- `GoogleMapDisplay` sin prop `trimbleStatusBySegment` mantiene colores RST.

## 8. Verificación

- `npx tsc --noEmit`
- Suite Trimble (incluye 4 nuevos tests).
- Suite legacy import/export.
- Suite Excel en aislamiento.
- Suite completa.

## Criterio de aceptación

Operador en mapa, modo Trimble:

1. Abre misión y pasada desde el panel del mapa.
2. Ve "Tramo actual" sin buscarlo + próximos `SEGMENTS_PER_BATCH - 1`.
3. "Enviar al conductor" → `/driver-mini` muestra hasta 8 paradas con etiquetas `INICIO ·` / `FIN ·`.
4. "Iniciar captura" → tramo en `en_captura`, color amarillo en mapa.
5. "Cerrar captura" → estado actualizado, cola avanza, sugerencia de reenvío al conductor.
6. RST y Garmin intactos: panel Trimble no aparece, colores Trimble no se aplican, overlays RST funcionan igual.
7. Exportación Excel sigue incluyendo trazabilidad Trimble (ya implementada).

## Plan aprobado para implementación con estos ajustes menores obligatorios:

1. Fallback de orden

En MapPage:

- usar `activeRouteBlock` si existe;

- si no, `route.optimizedOrder`;

- si ambos están vacíos, usar `route.segments.map(s => s.id)`.

Esto evita dejar la cola Trimble vacía en campañas sin optimización previa.

2. Geometría insuficiente

`buildTrimbleRecordingQueue` debe excluir tramos con `coordinates.length < 2`.

Añadir warning/log interno o contador para que el operador/gabinete sepa que hay tramos sin geometría suficiente.

Añadir test específico.

3. Sesión copiloto

Si no hay sesión copiloto activa:

- mostrar CTA “Crear sesión copiloto” desde `TrimbleMapPanel`;

- si se crea correctamente, permitir enviar la cola;

- si falla, mostrar error claro pero no bloquear misión/pasada/captura Trimble.

4. Copiloto INICIO/FIN

Mantener `QueueItem` sin migrar, pero los nombres deben ser:

- `INICIO · nombre_tramo`

- `FIN · nombre_tramo`

Test obligatorio:

- 4 tramos → 8 items;

- item 1 = INICIO;

- item 2 = FIN;

- ambos comparten segmentId;

- `batch_url.destination` = fin del último tramo;

- `waypoints` conserva el orden completo anterior.

Con esos ajustes, implementar:

- `recording-queue.ts`

- `TrimbleMapPanel`

- integración en MapPage

- colores Trimble opcionales en GoogleMapDisplay/MapDisplay

- tests nuevos

- verificación completa.

Condición:

No tocar lógica RST/Garmin salvo el guard visual para ocultar acciones RST cuando `acquisitionMode === 'TRIMBLE_LIDAR'`.