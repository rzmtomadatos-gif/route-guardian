

# Plan técnico corregido — Corrección de trazabilidad operativa

## Para entender sin ser informático

VialRoute apunta qué tramo se grabó, en qué vídeo (track) y en qué día. Hoy el cuaderno cuenta mal: tramos cancelados o saltados "ocupan sitio" dentro del vídeo. El sistema cambia de vídeo antes de tiempo sin avisar bien. Además, un botón de cancelación tapa el mapa cuando debería estar abajo en el panel de control.

---

## 1. Diagnóstico técnico real

### Puntos exactos de contaminación

| # | Punto | Archivo | Línea | Qué hace mal |
|---|---|---|---|---|
| 1 | `allocateTrackNumber` | `useRouteState.ts` | L248 | `segmentIds.length < capacity` — cuenta TODOS los IDs, incluidos `en_progreso` |
| 2 | `confirmStartSegment` cierre | `useRouteState.ts` | L290 | `segmentIds.length >= capacity` — cierra track antes de tiempo |
| 3 | `countSegmentsInTrack` | `useRouteState.ts` | L118-119 | Cuenta `en_progreso` Y `completado` |
| 4 | `segmentOrder` al iniciar | `useRouteState.ts` | L335-342 | Cuenta `en_progreso + completado` para orden |
| 5 | UI track indicator | `MapControlPanel.tsx` | L596 | Muestra `segmentIds.length/capacity` — incluye en_progreso |
| 6 | Exportación `trackOrderMap` | `excel-export.ts` | L146-154 | Incluye todos los tramos con `trackNumber !== null` |
| 7 | Exportación DIA/TRACK/TOP | `excel-export.ts` | L168-170 | Muestra valores para todos los estados |
| 8 | Botón "Cancelar inicio" en overlay | `NavigationOverlay.tsx` | L701-723 | Tarjeta completa que tapa el mapa |

### Lógica vs UI

**Lógica:** Puntos 1-4 (capacidad contaminada → saltos prematuros de track), 6-7 (exportación contamina gabinete).
**Solo UI:** Punto 5 (indicador incorrecto), Punto 8 (botón mal ubicado).

---

## 2. Blindajes obligatorios

### Cambio de día
- `en_progreso` de Día N no puede consolidarse en Día N+1
- `changeWorkDay(force)` pone `trackSession: null` → sin herencia
- Cada día empieza en Track 1; nunca track0

### Cambio de track
- Solo `completado` llena track
- Siguiente track no se abre sin aviso (`blockEndPrompt` + `EndOfVideoDialog`)
- Mientras el aviso no se confirme, `confirmStartSegment` L277 bloquea inicio

---

## 3. Reglas operativas objetivo

| # | Regla |
|---|---|
| R1 | Solo `completado` ocupa hueco real en el track |
| R2 | Solo `completado` consolida DIA, TRACK y ORDEN en exportación |
| R3 | `en_progreso`, cancelados, skips no consumen capacidad |
| R4 | Aviso obligatorio al operador antes de cambio de track |
| R5 | No se puede iniciar tramo mientras el aviso no se confirme |
| R6 | Botón "Cancelar inicio" solo en panel inferior, nunca en overlay |
| R7 | Cada día empieza en Track 1, sin herencia |
| R8 | Tramo iniciado en Día N no puede consolidarse en Día N+1 |

---

## 4. Plan por fases

### Fase A — Capacidad correcta + botón reubicado (riesgo bajo)

1. **`allocateTrackNumber` (L248):** contar solo `status === 'completado'` dentro de `segmentIds`
2. **`confirmStartSegment` cierre (L290):** misma corrección
3. **`countSegmentsInTrack` (L118-119):** filtrar solo `completado`
4. **`segmentOrder` al iniciar (L335-342):** contar solo `completado` para calcular orden provisional

> **NOTA IMPORTANTE:** El `segmentOrder` calculado en Fase A al iniciar un tramo **sigue siendo provisional**. Solo sirve para no contaminar la capacidad del track. El valor **definitivo** de `segmentOrder` se reconsolidará en una fase posterior dentro de `completeSegment`, cuando el tramo pase a `completado`. En Fase A **no queda resuelta** la consolidación final del orden — solo se corrige la contaminación.

5. **UI indicator (MapControlPanel L596):** mostrar `{completados en segmentIds}/{capacity}`
6. **Eliminar bloque "Cancelar inicio" de `NavigationOverlay` (L701-723):** borrar completamente
7. **Calcular `canCancelStart` en `MapPage.tsx`:**
   - Lógica exacta (la misma que hoy usa NavigationOverlay L702):
     - `activeSegment.status === 'en_progreso'`
     - AND `operationalState === 'idle' || operationalState === 'approaching'`
   - `onCancelStart`: la misma función actual → `() => onCancelStartSegment(activeSegment.id)`
   - Pasar a `MapControlPanel` dos props nuevas: `canCancelStart` y `onCancelStart`
8. **Añadir botón "Cancelar inicio" en `MapControlPanel`:**
   - Recibir props `canCancelStart: boolean` y `onCancelStart: () => void`
   - Renderizar junto a Finalizar/Saltar/Incidencia
   - Visible **solo** cuando `canCancelStart === true`
   - Nunca durante grabación real (recording)

**Archivos tocados en Fase A:**

| Archivo | Cambio |
|---|---|
| `src/hooks/useRouteState.ts` | allocateTrackNumber, confirmStartSegment, countSegmentsInTrack, segmentOrder provisional |
| `src/pages/MapPage.tsx` | Calcular `canCancelStart` + `onCancelStart`, pasarlos como props a MapControlPanel |
| `src/components/NavigationOverlay.tsx` | Eliminar bloque L701-723 completo |
| `src/components/MapControlPanel.tsx` | Indicador completados/capacity + botón "Cancelar inicio" con props `canCancelStart` + `onCancelStart` |

### Fase B — Exportación limpia (riesgo bajo)

1. **`trackOrderMap` (L146-154):** filtrar solo `seg.status === 'completado'`
2. **Columnas DIA/TRACK/TOP (L168-170):** vacías para estados que no sean `completado`

**Archivos:** `src/utils/excel-export.ts`

### Fase C — Aviso de cambio de track reforzado (riesgo bajo)

1. Verificar que `EndOfVideoDialog` explica claramente: "Prepara el siguiente archivo de grabación"
2. Verificar que `blockEndPrompt.isOpen` bloquea `confirmStartSegment` (guard L277)
3. Ajustar texto si no es claro

**Archivos:** `src/components/EndOfVideoDialog.tsx` (solo texto si necesario)

---

## 5. Lista completa de archivos por fase

| Archivo | Fase | Cambio |
|---|---|---|
| `src/hooks/useRouteState.ts` | A | allocateTrackNumber, confirmStartSegment, countSegmentsInTrack, segmentOrder provisional |
| `src/pages/MapPage.tsx` | A | Calcular `canCancelStart` + `onCancelStart`, pasar a MapControlPanel |
| `src/components/NavigationOverlay.tsx` | A | Eliminar bloque "Cancelar inicio" (L701-723) |
| `src/components/MapControlPanel.tsx` | A | Indicador completados/capacity + botón cancelar inicio |
| `src/utils/excel-export.ts` | B | trackOrderMap filtrado, DIA/TRACK/TOP solo completados |
| `src/components/EndOfVideoDialog.tsx` | C | Revisar/ajustar texto del aviso |

**No se toca:** persistencia, SQLite, import/export core, auth, copiloto, mapas, tipos, campaña real.

---

## 6. Pruebas — Escenario A: campaña limpia

1. Crear campaña vacía con ~10 tramos
2. D1/T1: iniciar → cancelar → T1 muestra **0/9**
3. Iniciar → completar → T1 muestra **1/9**
4. Iniciar otro → cancelar → T1 sigue en **1/9**
5. Saltar 3 tramos → T1 sigue en 1/9
6. Completar hasta 9 → aviso de fin de track
7. No se puede iniciar tramo con aviso abierto
8. Confirmar → T2 empieza con 0/9
9. Exportar Excel → DIA/TRACK/TOP solo en completados
10. Botón "Cancelar inicio" **NO** aparece arriba en el mapa
11. Botón "Cancelar inicio" **SÍ** aparece abajo cuando `en_progreso` + idle/approaching
12. Botón "Cancelar inicio" **NO** aparece durante recording
13. Cambiar día → Track 1 sin herencia
14. No aparece track0 nunca

## 7. Pruebas — Escenario B: campaña contaminada

1. Cargar copia de campaña Boadilla
2. Carga sin errores
3. Exportar Excel → completados mantienen DIA/TRACK/TOP exactos
4. No completados: DIA/TRACK/TOP vacíos
5. No se reescribe nada en el JSON

---

## 8. Garantías para la campaña real

1. Exportar JSON y KML antes de tocar código
2. Probar Escenario A primero, nunca sobre la real
3. Probar Escenario B después, nunca sobre la real
4. No reinterpretar tramos completados históricos
5. Solo cuando A y B estén validados, usar en campaña real

