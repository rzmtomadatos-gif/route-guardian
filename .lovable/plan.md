

# Plan de implementación aprobado — Coherencia navegación ↔ track ↔ tramo

## Decisiones de diseño aplicadas

1. **Sin evento `DEFENSIVE_CLEANUP`** — la limpieza defensiva se registra dentro del payload de `NAV_STOPPED` (`{ defensiveCleaned: [...ids] }`). No se tocan `types.ts` ni `campaign-schema.ts`.

2. **Sin doble `TRACK_CLOSED`** — `stopNavigation()` comprueba si `trackSession.active === true` antes de cerrar y emitir. Si `cancelAllInProgress` ya lo cerró (por `segmentIds` vacío), el track llega con `active: false` y `stopNavigation` no lo toca ni emite nada.

3. **Razones cerradas** — `cancelAllInProgress` acepta solo `'operator_cancel' | 'recovery_cancel' | 'stop_navigation_cancel'`, no `string` libre.

---

## Cambios exactos

### 1. `src/hooks/useRouteState.ts`

**a) Extraer `revertSegmentToPending` (función pura, ~L1209)**

- Recibe `(s: AppState, segmentId: string) → AppState`
- Limpia: `status→pendiente`, `trackNumber→null`, `plannedTrackNumber→null`, `plannedBy→undefined`, `segmentOrder→undefined`, `timestampInicio→undefined`, `startedAt→null`, `segmentStartSeconds→null`
- NO toca `trackHistory` ni `activeSegmentId`
- Elimina segmentId de `trackSession.segmentIds`; si queda vacío → cierra track (`active:false`, `endedAt:now`)

**b) Extraer `revertAllInProgress` (función pura)**

- Itera todos los `en_progreso`, aplica `revertSegmentToPending` secuencialmente
- Devuelve `{ state, revertedIds }`

**c) Refactorizar `cancelStartSegment` (L1210-1264)**

- Usa `revertSegmentToPending` internamente
- Recalcula `activeSegmentId` al siguiente pendiente (comportamiento actual preservado)
- Emite `SEGMENT_CANCELLED` con `reason: 'operator_cancel'`
- Elimina la línea que pushea a `trackHistory` (ajuste 1 del usuario)

**d) Crear `cancelAllInProgress(reason)` — nueva función expuesta**

- Tipo de `reason`: `'operator_cancel' | 'recovery_cancel' | 'stop_navigation_cancel'`
- Llama `revertAllInProgress`, pone `activeSegmentId = null`
- Emite un `SEGMENT_CANCELLED` por cada ID revertido, con la razón recibida

**e) Reforzar `stopNavigation` (L115-125)**

- `navigationActive = false`, `activeSegmentId = null`
- Si `trackSession.active === true` → cerrar (`active:false`, `endedAt:now`, `closedManually:true`) + emitir `TRACK_CLOSED { trackNumber, reason: 'navigation_stopped' }`
- Si `trackSession.active` ya es `false` → no tocar, no emitir `TRACK_CLOSED`
- Defensa: detectar tramos `en_progreso` residuales → sanear con `revertAllInProgress` → incluir IDs en payload de `NAV_STOPPED` (`defensiveCleaned: [...]`)
- Emitir `NAV_STOPPED { reason: 'operator_stop', trackNumber, defensiveCleaned? }`

**f) Exponer `cancelAllInProgress` en el return del hook**

### 2. `src/components/StopNavigationDialog.tsx` — NUEVO

- Diálogo modal con 2 opciones: "Cancelar inicios y detener" / "Volver a navegación"
- Props: `open`, `inProgressCount`, `onCancelAndStop`, `onGoBack`
- Estilo coherente con `RecoveryDialog` (AlertDialog + AlertTriangle)

### 3. `src/pages/MapPage.tsx`

- Añadir estado `showStopDialog: boolean`
- Crear `handleStopRequest`: si hay tramos `en_progreso` → abrir diálogo; si no → llamar `onStopNavigation()` directamente
- Crear `handleCancelAndStop`: llama `cancelAllInProgress('stop_navigation_cancel')` → luego `onStopNavigation()`
- Reemplazar `onStopNavigation` por `handleStopRequest` en el MapControlPanel y el efecto de capa oculta (L368)
- Importar y renderizar `StopNavigationDialog`

### 4. `src/App.tsx`

- Desestructurar `cancelAllInProgress` del hook
- Reemplazar el `forEach(cancelStartSegment)` en `handleRecoveryCancelSegments` (L95-101) por `cancelAllInProgress('recovery_cancel')`
- Pasar `cancelAllInProgress` como prop al MapPage (o usar directamente si está en App)

---

## Archivos tocados

| Archivo | Cambio |
|---|---|
| `src/hooks/useRouteState.ts` | Helper puro + refactor cancelStart + nuevo cancelAll + reforzar stopNav |
| `src/components/StopNavigationDialog.tsx` | NUEVO |
| `src/pages/MapPage.tsx` | Interceptar botón Detener + integrar diálogo |
| `src/App.tsx` | Usar cancelAllInProgress en recovery |

**No se toca**: `types.ts`, `campaign-schema.ts`, SQLite, formato campaña, import/export, auth, copiloto, mapas.

---

## Riesgos

Todos nulos. Solo se modifican transiciones de estado sobre tramos `en_progreso`. Tramos completados intocables. Formato de datos sin cambios. Campaña real preservada.

