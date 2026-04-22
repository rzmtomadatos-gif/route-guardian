

# Sub-bloque 3 — Modo gabinete: vertical slice usable

## Diagnóstico corto

El estado real verificado en repo:

- **Modelo de 3 capas** completo y estable: `Segment` (base), `segmentCorrections` (auditadas, append-only), `getConsolidatedSegment` (derivado en lectura).
- **Hook `useSegmentCorrections`**: `applySegmentCorrection` y `revertSegmentCorrection` con commit atómico, lectura post-commit, gate por rol `admin`/`gabinete`, eventos `SEGMENT_CORRECTION_APPLIED/REVERTED` ya emitidos al event-log.
- **`CorrectableField`** con 21 campos y `FIELDS_REQUIRING_REASON` con los 8 críticos ya definidos en `types/route.ts`.
- **`field-labels.ts`** cubre todas las etiquetas humanas.
- **`SegmentCorrectionsPanel`** ya muestra correcciones con estado activa/superseded/revertida, pero solo lectura.
- **`AppLayout`** tiene 4 tabs fijas: Cargar / Mapa / Tramos / Config. Sin tab de Gabinete.
- **`useUserRole`** ya distingue `gabinete` como rol propio, pero `isFieldOperator` y `canNavigate` lo excluyen. Falta un flag explícito `canViewGabinete`.

No hay aún ninguna ruta `/gabinete` ni componentes en `src/components/gabinete/`. El sub-bloque parte limpio.

## Plan breve cerrado

Vertical slice con 4 piezas: ruta protegida + listado con filtros + ficha de tramo de 3 bloques (original / consolidado / historial) + diálogos para aplicar y revertir correcciones. Reutiliza al 100% el hook y el engine actuales. No toca `SegmentEditDialog` de campo. Resumen Día / Tracks / Historial global quedan para sub-bloque 4 pero la estructura de carpetas se deja preparada.

### Flujo: aplicar corrección desde UI

1. Usuario abre ficha de gabinete de un tramo → pulsa "Corregir" en el campo deseado.
2. Se abre `CorrectionApplyDialog` mostrando: etiqueta humana, valor consolidado actual, input adecuado al tipo (texto / número / select de status / switch booleano), y campo motivo.
3. Si el campo está en `FIELDS_REQUIRING_REASON`, el motivo es obligatorio (validación: `trim().length >= 3`). Para campos descriptivos el motivo es opcional pero se permite.
4. Al confirmar → `applySegmentCorrection({ segment, field, newValue, reason })` del hook real.
5. Toast verde "Corrección aplicada". El listado se re-renderiza automáticamente desde `state.segmentCorrections` y la ficha refleja el nuevo consolidado y suma una entrada al historial.
6. Errores (rol insuficiente, segmento no encontrado, motivo faltante) → toast rojo, no se persiste nada.

### Flujo: revertir corrección desde UI

1. En la sección "Historial de correcciones" cada corrección **activa** muestra botón "Revertir". Las superseded/revertidas no.
2. Se abre `CorrectionRevertDialog` con: resumen de la corrección a revertir (campo, valor previo, valor nuevo, autor, fecha) y campo motivo de reversión (obligatorio, `trim().length >= 3`).
3. Al confirmar → `revertSegmentCorrection({ correctionId, revertReason })`.
4. La corrección queda marcada `active: false`, `revertedAt`, `revertedBy`, `revertReason`. **No se reactiva ninguna corrección anterior superseded** (regla del engine ya implementada). El consolidado vuelve al dato base para ese campo.
5. Toast verde "Corrección revertida". La ficha actualiza consolidado e historial.

### Separación visual original / consolidado / correcciones en la ficha

Tres tarjetas claramente diferenciadas, en este orden vertical:

```
┌───────────────────────────────────────────────────────────┐
│ A. DATO ORIGINAL DE CAMPO       [bg neutra, borde gris]   │
│ Tabla 2 columnas: etiqueta humana → valor base            │
│ Sin acciones. Read-only puro. Lee de `segment` sin pasar  │
│ por el engine.                                            │
├───────────────────────────────────────────────────────────┤
│ B. CONSOLIDADO ACTUAL            [bg primary/5, primary]  │
│ Misma tabla, valor = consolidado.                         │
│ Cada fila tiene botón "Corregir".                         │
│ Filas con corrección activa: badge "corregido" + valor    │
│ original tachado al lado en gris pequeño.                 │
├───────────────────────────────────────────────────────────┤
│ C. HISTORIAL DE CORRECCIONES     [bg secondary, borde]    │
│ Lista cronológica desc. Cada item:                        │
│  · campo (etiqueta humana)                                │
│  · valor anterior → valor nuevo                           │
│  · estado (activa / superseded / revertida) badge color   │
│  · autor · fecha · motivo                                 │
│  · si revertida: línea adicional con revertedBy/reason    │
│  · si activa: botón "Revertir"                            │
└───────────────────────────────────────────────────────────┘
```

Esto reutiliza la lógica de `SegmentCorrectionsPanel` para el bloque C (con la adición del botón Revertir).

## Archivos concretos a tocar

### Nuevos

| Archivo | Responsabilidad |
|---|---|
| `src/pages/GabinetePage.tsx` | Página `/gabinete`. Lee `state.route?.segments` y `state.segmentCorrections` desde `useRouteState`. Header con título, nº tramos, búsqueda, filtros. Renderiza `GabineteSegmentsTable`. Maneja apertura de `GabineteSegmentDetailDialog`. |
| `src/components/gabinete/GabineteSegmentsTable.tsx` | Listado virtualizable simple (no virtual scroll en esta fase, render directo con paginación de 100). Columnas: companySegmentId / name / workDay / trackNumber / segmentOrder / status / nº correcciones activas. Click → abre ficha. Muestra valores consolidados, no base. |
| `src/components/gabinete/GabineteSegmentDetailDialog.tsx` | Ficha con los 3 bloques A/B/C descritos. Recibe `segment` y consume el hook. |
| `src/components/gabinete/CorrectionApplyDialog.tsx` | Diálogo para aplicar corrección. Recibe `segment`, `field`, valor consolidado actual. Renderiza input según tipo del campo (texto / número entero / select / switch). Valida motivo si `FIELDS_REQUIRING_REASON.has(field)`. |
| `src/components/gabinete/CorrectionRevertDialog.tsx` | Diálogo para revertir. Resumen + textarea motivo obligatorio. |
| `src/components/gabinete/CorrectionFieldEditor.tsx` | Componente helper que devuelve el input adecuado al tipo del campo (consumido por `CorrectionApplyDialog`). Aísla el switch tipo→input. |
| `src/components/gabinete/field-types.ts` | Mapa puro `CorrectableField → 'string' \| 'number' \| 'boolean' \| 'status' \| 'direction' \| 'type'`. Usado por `CorrectionFieldEditor`. Tipado exhaustivo: añadir un campo nuevo a `CorrectableField` rompe compilación si no se registra aquí. |
| `src/test/gabinete-page-flow.test.ts` | Tests unitarios del flujo apply/revert vía API del hook simulando interacciones (sin React Testing Library, mismo patrón que `gabinete-corrections-hook.test.ts`). |

### Modificados

| Archivo | Cambio |
|---|---|
| `src/App.tsx` | +`<Route path="/gabinete" element={<GabinetePage state={state} />} />` dentro de `<Routes>` protegidas, pasando `state` y todo lo necesario desde `useRouteState`. |
| `src/components/AppLayout.tsx` | Añadir 5ª tab "Gabinete" (icon `ClipboardEdit` o `FileSearch`) **solo visible si `role === 'admin' \|\| role === 'gabinete'`**. Filtrado en runtime con `useUserRole`. |
| `src/hooks/useUserRole.ts` | Añadir flag derivado `canViewGabinete = role === 'admin' \|\| role === 'gabinete'`. No cambia los flags existentes. |

### NO se tocan

- `useSegmentCorrections.ts` — la API es suficiente.
- `consolidate.ts` — engine completo.
- `field-labels.ts` — cobertura completa.
- `SegmentEditDialog.tsx` — sigue siendo edición de campo, no se mezcla con gabinete.
- `SegmentCorrectionsPanel.tsx` — se reutiliza tal cual en la ficha de gabinete (bloque C) **excepto** que la ficha de gabinete renderiza una variante con botón Revertir; para no romperlo, el botón vive en `GabineteSegmentDetailDialog` y se renderiza al lado del panel actual, no dentro. Si tras la implementación se ve más limpio, se promueve un prop opcional `onRevert?` al panel; decisión queda dentro del sub-bloque sin reabrir contratos.

## Riesgos reales

1. **Tab Gabinete visible para operator**: si el filtrado por rol en `AppLayout` falla (role aún cargando), se mostraría brevemente. Mitigación: ocultar mientras `loading === true`. La ruta `/gabinete` además valida rol al montar y muestra "Acceso restringido" si no es admin/gabinete (defensa en profundidad: tab oculta + ruta protegida).
2. **Cambio de status / booleanos críticos**: corregir `status` a `completado` desde gabinete cambia el consolidado pero no toca el `Segment` base. La navegación de campo seguirá viendo el estado real. Esto es **correcto y deseado** (modelo de 3 capas), pero hay que documentarlo en JSDoc del diálogo para que no genere expectativa errónea.
3. **`segmentOrder` numérico**: campo opcional en `Segment`. Permitir limpiar (vaciar input) → `newValue: undefined`. Validar en el editor para no enviar `NaN`.
4. **Volumen de tramos**: con 50k tramos posibles (límite de campaña), render directo del listado con búsqueda lineal puede sentirse lento. En esta fase se acepta render directo con `useMemo` para filtros; virtualización queda para sub-bloque 4 si se confirma necesidad real con el dataset Boadilla.
5. **Etiqueta de status**: `SegmentStatus` incluye `'pendiente' | 'en_progreso' | 'completado' | 'posible_repetir'`. El select del editor debe usar etiquetas humanas en español, no las claves técnicas.

## Plan de pruebas mínimo

### Tests unitarios nuevos (`gabinete-page-flow.test.ts`)

1. Aplicar corrección desde la API con motivo válido sobre campo crítico (`workDay`) → corrección creada, consolidado refleja el cambio, base intacto.
2. Aplicar corrección sobre campo descriptivo (`name`) sin motivo → corrección creada (motivo vacío permitido).
3. Validador `requiresReason(field)`: confirma que los 8 críticos retornan `true` y los 13 descriptivos `false`. Cubre exhaustividad sobre `CorrectableField`.
4. Revertir corrección activa → `active: false`, `revertedAt` presente, base sigue intacto, consolidado vuelve al base para ese campo.
5. Revertir corrección no reactiva una superseded anterior sobre el mismo campo (regla heredada del engine, test de no-regresión).
6. Mapa `field-types.ts`: cobertura exhaustiva — todo `CorrectableField` tiene un tipo asignado.

### Verificación manual (criterios de aceptación)

- Login como `operator` → tab Gabinete oculta + acceso directo a `/gabinete` muestra "Acceso restringido".
- Login como `admin` → tab visible, listado completo, ficha con 3 bloques, apply y revert funcionan, toasts correctos.
- Login como `gabinete` → idem admin para esta funcionalidad.
- Tras apply: consolidado cambia, base no, historial suma entrada, badge "corregido" aparece en bloque B.
- Tras revert: consolidado vuelve al base, historial muestra entrada con estado "revertida" y datos de reversión.
- Etiquetas en español en toda la UI (búsqueda, filtros, columnas, ficha, diálogos, toasts).
- Typecheck verde, suite de tests existentes verde, tests nuevos verdes.

