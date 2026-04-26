## Objetivo

Conectar las correcciones de gabinete con la Hoja de Ruta 2.0: la exportación muestra como dato principal el **valor consolidado**, conserva trazabilidad completa del cambio, no permite que el autofix pise correcciones humanas y filtra correcciones cuando el export es de selección parcial. El dato original de campo nunca se muta. `segmentCorrections` sigue siendo append-only. La lógica de gabinete y el export clásico no se tocan.

---

## Ajustes obligatorios incorporados

1. **Autofix aplicado vs omitido** — dos contadores y dos categorías de findings separados. Los omitidos no inflan "Autofixes aplicados (revisar)".
2. **`startedAt`/`endedAt` no se protegen** porque no están en `CorrectableField`. Si faltan se sigue infiriendo como autofix `REVISAR` (comportamiento actual).
3. **`VALORES_ORIGINALES` viene del raw de campo** (`rawSegmentsById.get(seg.id)[field]`), no de `previousValue`. `VALORES_CONSOLIDADOS` viene del consolidado vigente (`consolidatedSegmentsById.get(seg.id)[field]`).
4. **Conflicto `completado + nonRecordable` con corrección de gabinete activa** sobre `status` o `nonRecordable` → no se autofixa; se emite finding `ERROR` ("CRÍTICO" en hoja 09) describiendo la inconsistencia residual.
5. **Filtrado por `selectedIds`** — si hay selección, `segmentCorrections` también se filtra a `c.segmentId ∈ selectedIds`.

---

## Cambios por archivo

### 1. `src/utils/excel-export-v2.ts`

**Imports nuevos** desde `@/utils/gabinete/consolidate` (`getConsolidatedSegments`, `getActiveCorrections`) y `@/utils/gabinete/field-labels` (`getFieldLabel`, `formatCorrectionValue`).

**Firma pública**:

```ts
exportRouteToExcelV2(route, incidents, rstMode, {
  selectedIds?, f5Events?, persistentEvents?,
  segmentCorrections?: SegmentCorrection[],   // NUEVO
})
```

**Pipeline dentro de `buildWorkbook`** (orden estricto):

```text
1. rawSegments              ← route.segments filtrados por selectedIds
2. scopedCorrections        ← corrections.filter(c => active && rawIds.has(c.segmentId))
3. consolidatedSegments     ← getConsolidatedSegments(rawSegments, scopedCorrections)
4. activeByField            ← Map<segId, Map<CorrectableField, SegmentCorrection>>
5. { fixed, applied, skipped } ← autoFixCopy(consolidatedSegments, activeByField)
6. findings                 ← buildQualityFindings(fixed, incs, f5, applied, skipped, scopedCorrections, rawById, fixedById, rstMode)
```

Todas las hojas visibles consumen `fixed`. Hoja 05 además recibe `rawById`, `consolidatedById` y `activeByField` para columnas de trazabilidad.

**`autoFixCopy(segments, protectedByField?)` — nueva firma**:

- Devuelve `{ fixed, applied: AutoFixRecord[], skipped: AutoFixSkipped[] }`.
- `AutoFixSkipped { segmentId, segmentName, field, reason, severity: 'REVISAR' | 'ERROR' }`.
- Antes de aplicar cualquier autofix sobre un campo X, comprueba `protectedByField.get(segId)?.has(X)`. Si protegido → emite `skipped` y NO aplica.
- Reglas:
  - Caso `completado + nonRecordable`: si `status` o `nonRecordable` están protegidos → `skipped` con `severity: 'ERROR'` y motivo "Inconsistencia crítica: tramo completado y no grabable simultáneamente con corrección de gabinete activa. Resolver manualmente."
  - Caso `trackNumber=null` en completado: si `trackNumber` protegido → no infiere; emite `skipped` `REVISAR` "Track null tras corrección de gabinete; verificar consolidado."
  - Casos `startedAt`/`endedAt`: **siempre se infieren si faltan** (no están en `CorrectableField`); siguen siendo `applied` `REVISAR`.

**`buildQualityFindings(fixed, incs, f5, applied, skipped, corrections, rawById, fixedById, rstMode)`** — añadidos:

- 1 finding `REVISAR` por cada `applied` (igual que hoy).
- 1 finding por cada `skipped`, con su `severity`.
- 1 finding `REVISAR` por cada corrección activa de gabinete:
  ```
  Estado: REVISAR
  Hoja: 05_DETALLE_TECNICO_TRAMOS
  Campo: getFieldLabel(c.field)
  Motivo: "Corrección de gabinete · original=<rawValue> → consolidado=<newValue> · «<reason>» · por <correctedBy> el <correctedAt>"
  Acción: "Validar el consolidado antes de cerrar la campaña."
  ```
  El `<rawValue>` se lee del raw, no del `previousValue` (que puede haber sido a su vez el resultado de una corrección anterior superseded).

**Hoja 02_RESUMEN_EJECUTIVO** — nuevos KPIs:

- `Autofixes aplicados (revisar)` ← `applied.length` (ya existe pero con definición correcta).
- `Autofixes omitidos por corrección de gabinete` ← `skipped.length`.
- `Correcciones de gabinete activas` ← `scopedCorrections.length`.

**Hoja 05_DETALLE_TECNICO_TRAMOS** — 7 columnas nuevas al final:

| Columna | Origen |
|---|---|
| `CORREGIDO_GABINETE` | `Sí` si `activeByField.get(segId)?.size > 0`, sino `No` |
| `CAMPOS_CORREGIDOS` | `getFieldLabel(c.field)` separados por `; ` |
| `VALORES_ORIGINALES` | por cada corrección: `<label>=<formatCorrectionValue(rawById.get(segId)[field])>` separados por `\n` |
| `VALORES_CONSOLIDADOS` | por cada corrección: `<label>=<formatCorrectionValue(consolidatedById.get(segId)[field])>` separados por `\n` |
| `MOTIVO_CORRECCION` | concatenación `<label>: <reason>` por línea |
| `CORREGIDO_POR` | autores únicos separados por `, ` |
| `FECHA_CORRECCION` | última `correctedAt` formateada con `fmtDate` |

Helper interno `readRawField(seg, field)` que entiende paths `kmlMeta.*` (mismo patrón que `readFieldFromSegment` de consolidate.ts pero local para evitar dependencia adicional… o reutilizando el existente; se reutilizará).

Fila pintada con `COLORS.review` si tiene corrección activa (precedencia: corrección humana > autofix > zebra).

**Hoja 09_VALIDACION_CALIDAD** — sin cambios estructurales: ya consume `findings`. La lista incluye los 3 nuevos tipos (applied/skipped/correction). Los `ERROR` salen en rojo (ya existe esa rama).

**Hoja 10_DICCIONARIO** — añadir entradas:

- `CORREGIDO_GABINETE` / `Corrección de gabinete` / `Autofix omitido`.

**`__testing`** — exponer adicionalmente `buildWorkbook` para tests que inspeccionen celdas sin tocar el DOM.

---

### 2. `src/pages/SegmentsPage.tsx`

En `handleExportV2`:

```ts
await exportRouteToExcelV2(route, incidents, state.rstMode, {
  selectedIds: selectedIds && selectedIds.size > 0 ? selectedIds : undefined,
  persistentEvents: events,
  segmentCorrections: state.segmentCorrections ?? [],   // NUEVO
});
```

Sin más cambios.

---

### 3. `src/test/excel-export-v2.test.ts`

Añadir `describe('integración con segmentCorrections')`:

1. **`workDay` corregido** — corrección activa `workDay: undefined → 1`. El consolidado expone `workDay=1`. Hoja 09 emite finding REVISAR de gabinete.
2. **`trackNumber` corregido** — corrección a `5` sobre tramo `completado`. `autoFixCopy` registra `skipped` (no `applied`) para `trackNumber`. Consolidado mantiene `5`.
3. **`status` corregido a `completado` con `nonRecordable=true`** — `autoFixCopy` emite `skipped` con `severity: 'ERROR'`. Hoja 09 contiene un finding `ERROR`. La regla `completado + nonRecordable → posible_repetir` NO se aplica.
4. **Trazabilidad hoja 05** — vía `buildWorkbook` se inspecciona la fila del tramo y se verifica `CORREGIDO_GABINETE=Sí`, `CAMPOS_CORREGIDOS` con etiqueta humana, `VALORES_ORIGINALES` que sale del raw (no del previousValue: se hace una corrección que supersedea otra anterior y se comprueba que el valor mostrado es el del campo original, no el de la previousValue intermedia).
5. **Filtrado por `selectedIds`** — corrección sobre tramo NO seleccionado no debe aparecer en hoja 09 ni en columnas de hoja 05.
6. **Sin correcciones (regresión)** — con `corrections=[]` hoja 05 muestra `CORREGIDO_GABINETE=No` y columnas de trazabilidad vacías. Comportamiento idéntico al actual para todo lo demás.
7. **Conteos diferenciados** — `applied` y `skipped` se reportan por separado; `applied` no incluye los `skipped`.

Tests usan `__testing.buildWorkbook` (síncrono respecto al DOM) para leer celdas de las hojas resultantes.

---

## Reglas de oro respetadas

- `route.segments` (campo) **no se muta** en ningún punto.
- `segmentCorrections` permanece append-only (este cambio es solo lector).
- Consolidado calculado en lectura vía `getConsolidatedSegments()`.
- Trazabilidad completa en hoja 05 + hoja 09.
- Autofix nunca pisa una corrección humana; los conflictos se reportan diferenciados (REVISAR o ERROR).
- `startedAt`/`endedAt` no se protegen (no son `CorrectableField`).
- Selección parcial filtra correcciones al mismo subconjunto.
- Datos faltantes → `NO REGISTRADO`. Cero invención.
- Export clásico (`excel-export.ts`) **intacto**.
- Lógica de gabinete (`consolidate.ts`, `useSegmentCorrections`, schema) **intacta**.

## Criterio de aceptación

- Lo que gabinete ve en "Consolidado actual" coincide con lo exportado en hojas 04 y 05.
- El dato original sigue trazable vía `VALORES_ORIGINALES` (leído del raw) y findings de hoja 09.
- Cada corrección activa aparece como hallazgo REVISAR en hoja 09 con autor, fecha, motivo y valores raw/consolidado.
- Caso Boadilla `workDay=1` sobre tramos huérfanos del inicio se refleja correctamente sin tocar el dato de campo.
- Conflictos críticos (`completado + nonRecordable` protegido) salen como `ERROR` en hoja 09, no se autocorrigen.
- `tsc --noEmit` y `vitest run` en verde.
