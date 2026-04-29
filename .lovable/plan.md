## Objetivo

Conectar Gabinete ↔ Tramos ↔ Mapa ↔ Excel para que un tramo pueda repetirse o reactivarse manteniendo su histórico, sin ampliar `SegmentStatus`. Añadir hoja `HISTORIAL_INTENTOS` derivada del event-log, sanear `duplicateSegments` y enriquecer la cabecera del MapControlPanel.

## Cambios

### 1. `src/utils/persistence/types.ts`

Añadir a `EventType`:

- `SEGMENT_REACTIVATED_FOR_FIELD`
- `SEGMENT_DUPLICATED`

### 2. `src/hooks/useRouteState.ts`

**Enriquecer `logEvent('SEGMENT_STARTED')**` (línea 671) con `workDay`, `trackNumber`, `segmentOrder`, `startedAt`, `acquisitionMode`, `segmentStartSeconds`. Capturar los valores dentro del setState (en una variable local fuera) y emitir tras el commit.

**Enriquecer `logEvent('SEGMENT_COMPLETED')**` (línea 761) con los mismos + `endedAt`, `segmentEndSeconds`.

**Sanear `duplicateSegments**` (línea 1407): el duplicado sale como tramo nuevo limpio:

```ts
{
  ...orig,
  id: nuevoId,
  name: orig.name + ' (copia)',
  companySegmentId: undefined,        // NUNCA heredar
  status: 'pendiente',
  nonRecordable: false,
  needsRepeat: false,
  repeatRequested: false,
  trackNumber: null,
  plannedTrackNumber: null,
  plannedBy: undefined,
  segmentOrder: undefined,
  trackHistory: [],
  workDay: s.workDay,
  timestampInicio: undefined,
  timestampFin: undefined,
  startedAt: null,
  endedAt: null,
  failedAt: null,
  segmentStartSeconds: null,
  segmentEndSeconds: null,
  invalidatedByTrack: null,
  repeatNumber: 0,
}
```

Y emitir `SEGMENT_DUPLICATED` con `{ sourceSegmentId, newSegmentId, sourceCompanySegmentId }`.

**Nueva función `reactivateSegmentForField**` (export del hook):

```ts
reactivateSegmentForField(segmentId: string, opts: {
  targetWorkDay: number;
  reason: string;
  mode?: 'repeat_existing_segment';
})
```

Comportamiento dentro del setState:

- Buscar segmento en `s.route.segments`. Si no existe → no-op.
- Capturar snapshot previo: `previousStatus`, `previousWorkDay`, `previousTrackNumber`, `previousSegmentOrder`, `previousNonRecordable`.
- Mapear el segmento a:
  ```ts
  {
    ...seg,
    status: 'pendiente',
    nonRecordable: false,
    needsRepeat: true,
    repeatRequested: true,    // deprecated, compatibilidad
    workDay: opts.targetWorkDay,
    trackNumber: null,
    plannedTrackNumber: null,
    plannedBy: undefined,
    segmentOrder: undefined,
    timestampInicio: undefined,
    timestampFin: undefined,
    startedAt: null,
    endedAt: null,
    failedAt: null,
    segmentStartSeconds: null,
    segmentEndSeconds: null,
    invalidatedByTrack: null,
    // trackHistory NO se toca → conserva histórico
    // companySegmentId NO se toca
  }
  ```
- Si `s.route.optimizedOrder` no contiene `segmentId`, añadir al final.
- Persistir con `setState(updater, true)` (immediate).

Tras commit, `logEvent('SEGMENT_REACTIVATED_FOR_FIELD', { workDay, segmentId, payload: { previousStatus, previousWorkDay, previousTrackNumber, previousSegmentOrder, previousNonRecordable, targetWorkDay, reason, mode } })`.

Exportar `reactivateSegmentForField` en el `return {...}` final del hook.

### 3. `src/App.tsx`

Desestructurar `reactivateSegmentForField` del hook y pasarlo como prop a `MapPage`, `SegmentsPage` y `GabinetePage`. (También `state.workDay` ya disponible.)

### 4. `src/components/ReactivateSegmentDialog.tsx` (NUEVO)

Diálogo reutilizable shadcn:

- Título: "Reactivar tramo para campo".
- Muestra: nombre + companySegmentId del segmento, estado actual, día actual.
- Campo `targetWorkDay` (Input numérico, default = `state.workDay`, min=1).
- Campo `reason` (Textarea, obligatorio, ≥3 chars).
- Botón "Reactivar" (deshabilitado si `reason.trim().length < 3`).
- Aviso visible: "Esta acción cambia el estado operativo base. El histórico previo (eventos, incidencias, trackHistory) se conserva."
- Al confirmar: llamar `onConfirm({ targetWorkDay, reason })` y cerrar.

Props:

```ts
{ open, segment, defaultWorkDay, onConfirm({targetWorkDay, reason}), onClose }
```

### 5. `src/components/LayerPanel.tsx`

**Props nuevas** (opcionales):

- `onReactivateSegment?: (segmentId: string) => void` — abre el diálogo en el padre.

**Sustituir** la línea 527-531 por:

```tsx
{(seg.status === 'completado' ||
  seg.status === 'posible_repetir' ||
  seg.nonRecordable ||
  seg.needsRepeat) && onReactivateSegment && (
  <DropdownMenuItem onClick={() => onReactivateSegment(seg.id)}>
    <RefreshCw className="w-3 h-3 mr-2" />
    {seg.nonRecordable ? 'Reactivar para campo' : 'Repetir tramo'}
  </DropdownMenuItem>
)}
```

Importar `RefreshCw` de lucide-react.

### 6. `src/pages/SegmentsPage.tsx`

- Añadir prop `onReactivateSegment: (segmentId, opts) => void` y `currentWorkDay: number`.
- Estado local `reactivateTarget: Segment | null`.
- Pasar `onReactivateSegment={(id) => setReactivateTarget(seg)}` al LayerPanel (resolviendo segmento por id).
- Renderizar `<ReactivateSegmentDialog>` y al confirmar → `onReactivateSegment(id, opts)` + toast.

### 7. `src/components/gabinete/GabineteSegmentDetailDialog.tsx`

Añadir bloque visible (sección D, fuera de las correcciones reversibles), separado claramente:

- Título "D · Reactivar para campo (acción operativa)".
- Texto explicativo: "Esta acción NO es una corrección reversible. Modifica el estado operativo base para que el operador pueda navegar el tramo. El histórico se conserva."
- Botón "Reactivar para campo" → abre `ReactivateSegmentDialog`.

Nuevas props: `onReactivate?: (segmentId, opts) => void`, `currentWorkDay?: number`.

### 8. `src/pages/GabinetePage.tsx`

- Aceptar prop `onReactivateSegment` y `currentWorkDay` (= `state.workDay`).
- Pasar a `GabineteSegmentDetailDialog`.
- Toast tras reactivar: "Tramo reactivado para Día X. Disponible en Tramos y Mapa."

### 9. `src/components/MapControlPanel.tsx`

**Importar** `RefreshCw`, `ArrowUp`, `ArrowDown`.

Nuevas props opcionales: `onReactivateSegment?: (segmentId: string) => void`.

**Cabecera del bloque pendiente expandido** (línea 392-414): reescribir como dos filas:

```
[ChipTrack]  Siguiente tramo · #N / TOTAL          [▲][▼][↻]
             {nombre}                              [Ir/Iniciar]
```

Donde:

- `#N / TOTAL` se calcula con `displayOrderMap.get(pinnedSegment.id)` y `optimizedOrder.length`.
- `▲` → `onReorder(pinnedSegment.id, 'up')`, deshabilitado si `pos<=1`.
- `▼` → `onReorder(pinnedSegment.id, 'down')`, deshabilitado si `pos>=total`.
- `↻` → visible si `pinnedSegment.status==='completado' || 'posible_repetir' || pinnedSegment.nonRecordable || pinnedSegment.needsRepeat`. Llama `onReactivateSegment(pinnedSegment.id)`.

**Bloque "en_progreso"** (línea 361-389): añadir el mismo `#N / TOTAL` discreto en la cabecera.

### 10. `src/pages/MapPage.tsx`

- Aceptar prop `onReactivateSegment`.
- Mantener estado `reactivateTarget` y renderizar `<ReactivateSegmentDialog>`.
- Pasar `onReactivateSegment={(id) => setReactivateTarget(...)}` a `MapControlPanel`.
- Al confirmar: invocar prop del padre + toast.

### 11. `src/utils/gabinete/segment-attempts.ts` (NUEVO)

Utilidad pura derivada del event-log + incidents + segments:

```ts
export interface SegmentAttempt {
  id: string;                    // synth: `${segmentId}#${attemptIndex}`
  segmentId: string;
  companySegmentId?: string;
  workDay: number;
  trackNumber: number | null;
  segmentOrder?: number | null;
  status: 'pendiente'|'en_progreso'|'completado'|'no_grabable'|'cancelado'|'invalidado'|'posible_repetir';
  startedAt?: string | null;
  endedAt?: string | null;
  incidentIds: string[];
  source: 'field' | 'gabinete' | 'system';
  reason?: string;
}

export function deriveSegmentAttempts(
  eventLog: PersistentEvent[],
  incidents: Incident[],
  segments: Segment[],
): SegmentAttempt[]
```

Reglas de derivación:

- Iterar eventLog ordenado por timestamp.
- `SEGMENT_STARTED` → abre nuevo intento usando `payload.workDay`, `payload.trackNumber`, `payload.segmentOrder`, `payload.startedAt`. Estado inicial `en_progreso`.
- `SEGMENT_COMPLETED` → cierra intento abierto del mismo segmento con status `completado`, rellena `endedAt`.
- `SEGMENT_CANCELLED` → cierra con `cancelado`, `reason = payload.reason`.
- `SEGMENT_SKIPPED` → cierra con `cancelado`, reason "skipped".
- `INCIDENT_RECORDED` con `payload.impact='critica_no_grabable'` → cierra con `no_grabable`. Con `critica_invalida_bloque` → `invalidado`.
- `SEGMENT_REACTIVATED_FOR_FIELD` → cierra cualquier intento abierto sin afectar; emite intento NUEVO sintético "pendiente" para el `targetWorkDay` con `source='gabinete'` y `reason`.
- Asociar incidencias por `(segmentId, workDay, trackNumber)` matching.
- Para tramos completados sin event-log (datos antiguos), generar intento "fallback" desde el segmento actual.

### 12. `src/utils/excel-export-v2.ts`

Añadir:

- Import `deriveSegmentAttempts` y tipo `SegmentAttempt`.
- Etiqueta en `EVENT_TYPE_LABELS`: `SEGMENT_REACTIVATED_FOR_FIELD: 'Tramo reactivado'`, `SEGMENT_DUPLICATED: 'Tramo duplicado'`.
- Etiqueta en índice (sh3): `'11_HISTORIAL_INTENTOS'`.
- **Nueva hoja `11_HISTORIAL_INTENTOS**` después de `10_DICCIONARIO`:
  - Headers: `ID_EMPRESA, NOMBRE, DIA, TRACK, POSICION, ESTADO_INTENTO, INICIO, FIN, DURACION, INCIDENCIAS, FUENTE, MOTIVO`.
  - Filas: una por cada `SegmentAttempt` ordenadas por `workDay, trackNumber, startedAt`.
  - Estilo zebra y coloreado por status.
- Llamar `const attempts = deriveSegmentAttempts(ctx.persistentEvents, allIncidents, segments)` en `buildWorkbook`.

Exportar `deriveSegmentAttempts` en `__testing` para los tests (vía re-export).

### 13. Tests

`**src/test/segment-reactivation.test.ts` (NUEVO)** — pruebas puras sin React:

1. **Reactivar nonRecordable**: aplicar `reactivateSegmentForField` (vía función pura extraída — ver siguiente punto) sobre estado mock con segmento `nonRecordable=true, status='posible_repetir'` → resultado: `status='pendiente'`, `nonRecordable=false`, `needsRepeat=true`, `workDay=18`, `trackNumber=null`, `optimizedOrder.includes(id)`.
2. **Reactivar completado de Día 1 a Día 18**: snapshot previo conservado en payload; `trackHistory` intacto.
3. **Tramo reactivado entra en filtro Pendientes**: simular el filtro de SegmentsPage.
4. **Tramo reactivado entra en `nextPending**`: simular `orderedSegments.find(s => s.status==='pendiente')`.

Para esto: extraer la lógica pura del reactivate a `src/utils/segment-reactivation.ts`:

```ts
export function applyReactivation(state: AppState, segmentId: string, opts: {targetWorkDay,reason}): { state: AppState; previousSnapshot: {...} | null }
```

y `reactivateSegmentForField` del hook simplemente la envuelve + emite evento.

`**src/test/segment-duplicate.test.ts` (NUEVO)**: similar, extraer `applyDuplicate(state, ids)` puro y verificar que ningún duplicado hereda `companySegmentId`.

`**src/test/segment-attempts.test.ts` (NUEVO)**: tests de `deriveSegmentAttempts` con event-log mock que incluye reactivación → 2 intentos del mismo segmentId en días distintos.

`**src/test/excel-export-v2.test.ts**`: añadir caso `it('exporta dos intentos del mismo ID empresa en días distintos')` que invoca `buildWorkbook` con event-log que contiene `SEGMENT_STARTED` Día 1, `SEGMENT_COMPLETED` Día 1, `SEGMENT_REACTIVATED_FOR_FIELD` Día 18, `SEGMENT_STARTED` Día 18, `SEGMENT_COMPLETED` Día 18, y verifica que la hoja 11 tiene 2 filas con el mismo `companySegmentId`.

**Tests de UI MapControlPanel**: omitidos (alta superficie y poco valor frente al coste). Verificación manual + el test puro de `buildDisplayOrderMap` ya existente cubre `#N/TOTAL`.

## Lo que NO cambia

- `SegmentStatus` no se amplía. "No grabable" sigue siendo `nonRecordable=true` + `status='posible_repetir'`.
- `Segment` schema, `Incident`, `campaign-schema.ts`, persistence schema.
- `segmentCorrections` (correcciones reversibles): siguen siendo el canal de gabinete para edición auditada. La reactivación es una operación operativa distinta.
- Lógica RST (F5/F7/F9), punto estratégico, navegación.
- Hojas 01-10 del Excel.
- Export clásico (`excel-export.ts`).

## Criterios de aceptación

- Reactivar un tramo `nonRecordable` desde Gabinete o LayerPanel lo deja como pendiente y aparece inmediatamente en SegmentsPage filtro Pendientes y en `nextPending` de MapControlPanel.
- `trackHistory`, eventos previos, incidencias previas y `companySegmentId` se conservan tras reactivación.
- Duplicar nunca produce dos tramos con el mismo `companySegmentId`.
- Cabecera de "Siguiente tramo" muestra `#N / TOTAL` con botones `▲ ▼ ↻` operativos.
- Hoja `11_HISTORIAL_INTENTOS` muestra filas separadas para cada intento; un mismo ID empresa puede aparecer en Día 1 y Día 18.
- `tsc --noEmit` y `vitest run` en verde.  


AJUSTE OBLIGATORIO — HISTORIAL_INTENTOS

En `deriveSegmentAttempts`, `SEGMENT_REACTIVATED_FOR_FIELD` no debe generar siempre una fila independiente.

Debe tratarse como un marcador de reactivación:

1. Al leer `SEGMENT_REACTIVATED_FOR_FIELD`, guardar un marcador por:

   - segmentId

   - targetWorkDay

   - reason

   - timestamp

   - source='gabinete'

2. Si posteriormente aparece `SEGMENT_STARTED` o `SEGMENT_COMPLETED` para el mismo segmentId y workDay:

   - fusionar ese marcador con el intento real

   - NO crear una fila pendiente adicional

   - conservar `source='gabinete'` o `reason` en el intento resultante

3. Si al terminar de procesar el event-log queda un marcador de reactivación sin intento real posterior:

   - entonces sí crear un intento sintético:

     - status='pendiente'

     - source='gabinete'

     - reason=motivo de reactivación

     - workDay=targetWorkDay

     - trackNumber=null

Criterio:

- Tramo grabado en Día 1, reactivado en Día 18 y grabado en Día 18 → 2 filas.

- Tramo grabado en Día 1, reactivado en Día 18 pero aún no grabado → 2 filas: Día 1 completado + Día 18 pendiente/reactivado.