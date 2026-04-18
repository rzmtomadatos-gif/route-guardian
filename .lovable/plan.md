

# Plan corregido — Modo Gabinete con corrección auditada y reversible

## 1. Modelo de 3 capas

```text
A. Histórico crudo (event-log SQLite)
   ↓ inmutable, append-only
B. Correcciones de gabinete (segmentCorrections)
   ↓ auditadas, reversibles, ordenadas por fecha
C. Resultado consolidado actual (Segment vigente)
   ↓ derivado: campo + última corrección activa aplicada
```

- **A** no se toca jamás.
- **B** es una nueva colección append-only de correcciones, cada una marcada como `active: true|false`.
- **C** es lo que ve la app, derivado en tiempo real aplicando las correcciones activas sobre el dato de campo.

## 2. Estructura de datos nueva

### Nuevo tipo `SegmentCorrection`

```typescript
interface SegmentCorrection {
  id: string;                    // uuid
  segmentId: string;
  field: CorrectableField;       // 'workDay' | 'trackNumber' | 'status' | 'carretera' | ...
  previousValue: unknown;        // valor antes de la corrección
  newValue: unknown;             // valor después
  reason: string;                // motivo obligatorio
  correctedBy: string;           // user id o email
  correctedByRole: 'gabinete' | 'admin';
  correctedAt: string;           // ISO
  active: boolean;               // false si fue revertida
  revertedBy?: string;
  revertedAt?: string;
  revertReason?: string;
  supersededBy?: string;         // id de corrección posterior sobre el mismo campo
}
```

### Añadido a `AppState`

```typescript
segmentCorrections: SegmentCorrection[];  // append-only, persistido en SQLite
```

### Derivación del consolidado

```typescript
function getConsolidatedSegment(segment, corrections): Segment {
  const active = corrections
    .filter(c => c.segmentId === segment.id && c.active)
    .sort((a, b) => a.correctedAt.localeCompare(b.correctedAt));
  
  return active.reduce((acc, c) => ({ ...acc, [c.field]: c.newValue }), segment);
}
```

El `Segment` original **nunca se muta** por una corrección. El consolidado se deriva al leer.

## 3. Tabla de campos editables

| Campo | Editable | Capa afectada | Motivo obligatorio | Reversible |
|---|---|---|---|---|
| `name`, `notes`, `kmlId`, `companySegmentId` | ✅ | Consolidado | ❌ | ✅ |
| `carretera`, `identtramo`, `tipo`, `calzada`, `sentido`, `pkInicial`, `pkFinal` | ✅ | Consolidado | ❌ | ✅ |
| `direction`, `type` | ✅ | Consolidado | ❌ | ✅ |
| `workDay` | ✅ | Histórico corregido | ✅ | ✅ |
| `trackNumber` | ✅ | Histórico corregido | ✅ | ✅ |
| `segmentOrder` | ✅ | Histórico corregido | ✅ | ✅ |
| `status` | ✅ | Histórico corregido | ✅ | ✅ |
| `needsRepeat`, `nonRecordable`, `invalidatedByTrack` | ✅ | Histórico corregido | ✅ | ✅ |
| `repeatNumber` | ✅ | Histórico corregido | ✅ | ✅ |
| `trackHistory`, `startedAt`, `endedAt`, `failedAt` | ❌ | Auditoría base | — | — |
| Eventos del event-log | ❌ | Auditoría base inmutable | — | — |

**Distinción clave**: metadatos del tramo no exigen motivo (son descriptivos). Trazabilidad operativa sí lo exige (afecta a la realidad de campaña).

## 4. Operaciones sobre correcciones

| Acción | Comportamiento |
|---|---|
| **Crear corrección** | Append a `segmentCorrections` con `active: true`. Si ya existe corrección activa sobre el mismo campo, se marca la anterior con `supersededBy: nuevaId` y `active: false`. Se emite evento `SEGMENT_CORRECTION_APPLIED` en event-log. |
| **Revertir corrección** | Marca `active: false`, `revertedBy`, `revertedAt`, `revertReason`. Si había una corrección anterior superseded, NO se reactiva automáticamente (el operador decide). Se emite evento `SEGMENT_CORRECTION_REVERTED`. |
| **Re-corregir** | Crear corrección nueva. La anterior queda histórica. |
| **Generar tramo manual** | Capacidad existente, sin cambios. Crea `Segment` con `plannedBy: 'manual'`. |

## 5. Eventos nuevos en event-log

```typescript
| 'SEGMENT_CORRECTION_APPLIED'
| 'SEGMENT_CORRECTION_REVERTED'
```

Payload incluye `correctionId`, `field`, `previousValue`, `newValue`, `reason`, `correctedByRole`. Esto garantiza que la auditoría base también registra la actividad de gabinete sin perder el dato original.

## 6. UI — Ficha de tramo en 3 secciones visibles

```text
┌─ Tramo BOA_00045 ──────────────────────────────┐
│ [Resultado consolidado actual]                 │
│  Día: 2 (corregido)  Track: 3 (corregido)      │
│  Estado: completado                            │
│  ...                                           │
├────────────────────────────────────────────────┤
│ [Correcciones de gabinete]                     │
│  • 2026-04-17 — Día 1 → 2  (M.G., motivo: ...) │
│    [Revertir] [Ver detalle]                    │
│  • 2026-04-17 — Track 2 → 3 (M.G., motivo: ...)│
│    [Revertir] [Ver detalle]                    │
├────────────────────────────────────────────────┤
│ [Histórico original / event-log]               │
│  • 2026-04-15 10:23 · Día 1 · Track 2 · Inicio │
│  • 2026-04-15 10:25 · Completado               │
│  ...                                           │
└────────────────────────────────────────────────┘
```

Indicadores visuales:
- Campo corregido lleva badge "(corregido)" en consolidado.
- Hover muestra "Original: X · Actual: Y · por M.G. el ...".
- Lista de correcciones permite revertir cada una individualmente.

## 7. Exportación Excel — hojas resultantes

| Hoja | Contenido |
|---|---|
| **Tramos (consolidado)** | Vista vigente con columna `editado_por_gabinete: sí/no` |
| **Tramos (original de campo)** | Datos sin aplicar correcciones |
| **Correcciones de Gabinete** | Una fila por corrección: tramo, campo, antes, después, motivo, autor, fecha, activa, revertida |
| **Por Día** | Agregado sobre consolidado |
| **Por Track** | Agregado sobre consolidado |
| **Historial de Intentos** | Reconstruido desde event-log (incluye `SEGMENT_CORRECTION_*`) |
| **Incidencias** | Sin cambios |
| **Event Log crudo** | Auditoría base inalterada |
| **Resumen ejecutivo** | Métricas consolidadas + nº de correcciones activas |

Esto deja a gabinete ver simultáneamente: qué dijo campo, qué corrigió gabinete, qué versión está vigente.

## 8. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Sobrecorrección masiva sin trazabilidad | Motivo obligatorio en campos críticos + RBAC (solo `gabinete`/`admin`) |
| Confundir original con corregido | Badges visuales + 3 secciones separadas en ficha + 2 hojas Excel diferenciadas |
| Reversión accidental | Diálogo de confirmación + motivo de reversión obligatorio |
| Cadena de correcciones inconsistente | `supersededBy` enlaza correcciones sobre el mismo campo; al revertir, no se reactiva la anterior automáticamente |
| Pérdida de confianza en los datos | Toda corrección genera evento en event-log → auditoría base completa |
| Romper coherencia entre consolidado y agregados | Agregados (Día/Track) se derivan SIEMPRE del consolidado, nunca del dato crudo |
| Corrección de `trackNumber` rompe `lastConsumedTrackByDay` | La corrección no toca esa estructura; afecta solo a la asignación lógica del tramo, no a la numeración consumida |
| Importar campaña sin `segmentCorrections` | Schema Zod opcional con default `[]` |

## 9. Sub-bloques de implementación

### Orden recomendado
1. **Tipos + estado**: `SegmentCorrection`, `segmentCorrections: []` en `AppState`, schema Zod, `getDefaultState`.
2. **Utilidades puras**: `getConsolidatedSegment`, `applyCorrection`, `revertCorrection`, `buildSegmentHistory` (con correcciones intercaladas).
3. **Eventos**: añadir `SEGMENT_CORRECTION_APPLIED/REVERTED` al event-log.
4. **Hook**: `useSegmentCorrections` con `applyCorrection`, `revertCorrection`.
5. **Página `/gabinete`**: tabs Resumen Días / Tracks / Tramos / Historial.
6. **`SegmentDetailDialog`**: 3 secciones (consolidado / correcciones / histórico) con edición.
7. **Excel enriquecido**: hojas nuevas reusando utilidades.
8. **RBAC**: ruta y acciones de corrección bloqueadas a roles `gabinete` y `admin`.

## 10. Archivos a tocar

| Archivo | Cambio |
|---|---|
| `src/types/route.ts` | +`SegmentCorrection`, +`segmentCorrections` en `AppState`, +`CorrectableField` |
| `src/utils/storage.ts` | `getDefaultState`: `segmentCorrections: []` |
| `src/utils/persistence/campaign-schema.ts` | Schema Zod opcional con default `[]` |
| `src/utils/persistence/types.ts` | +eventos `SEGMENT_CORRECTION_APPLIED/REVERTED` |
| `src/utils/gabinete/consolidate.ts` | Nuevo — `getConsolidatedSegment` y derivaciones |
| `src/utils/gabinete/build-segment-history.ts` | Nuevo — fusiona event-log + correcciones |
| `src/utils/gabinete/build-day-summary.ts` | Nuevo — agrega sobre consolidado |
| `src/utils/gabinete/build-track-summary.ts` | Nuevo — agrega sobre consolidado |
| `src/hooks/useSegmentCorrections.ts` | Nuevo — `applyCorrection`, `revertCorrection` |
| `src/pages/GabinetePage.tsx` | Nuevo — ruta `/gabinete` con tabs |
| `src/components/gabinete/SegmentDetailDialog.tsx` | Nuevo — ficha con 3 secciones editables |
| `src/components/gabinete/CorrectionsList.tsx` | Nuevo — listado con revertir |
| `src/components/gabinete/SegmentHistoryView.tsx` | Nuevo |
| `src/components/gabinete/DaySummaryTable.tsx` | Nuevo |
| `src/components/gabinete/TrackSummaryTable.tsx` | Nuevo |
| `src/utils/excel-export.ts` | +hojas Tramos original, Correcciones de Gabinete, Por Día, Por Track, Historial |
| `src/test/gabinete-corrections.test.ts` | Nuevo — apply/revert/supersede |
| `src/App.tsx` | Registrar `/gabinete` con guard de rol |
| `src/components/AppLayout.tsx` | Tab "Gabinete" visible solo admin/gabinete |

## 11. Plan de pruebas mínimo

1. Aplicar corrección de `trackNumber` → consolidado refleja nuevo valor, original intacto, evento en log.
2. Revertir corrección → consolidado vuelve al original, corrección queda con `active: false`.
3. Dos correcciones consecutivas sobre `workDay` → la primera queda `superseded`, la segunda activa.
4. Revertir la segunda corrección de `workDay` → vuelve al original (NO reactiva la primera).
5. Editar metadato KML (carretera) → no exige motivo, queda corregido, reversible.
6. Editar `trackNumber` sin motivo → bloqueado por validación UI.
7. Exportar Excel → 2 hojas distintas Tramos original vs consolidado + hoja Correcciones poblada.
8. Importar campaña antigua sin `segmentCorrections` → carga con `[]`, no rompe.
9. Operador (rol `operator`) intenta acceder a `/gabinete` → bloqueado por RBAC.
10. Reversión de corrección → genera evento `SEGMENT_CORRECTION_REVERTED` en event-log.

## 12. Sub-bloque inicial recomendado

**Sub-bloque 1**: tipos + utilidades puras + tests.
- `SegmentCorrection`, `CorrectableField`, `segmentCorrections` en estado.
- `getConsolidatedSegment`, `applyCorrection`, `revertCorrection`.
- Tests cubriendo apply/revert/supersede/reversión sin reactivación.

Sin UI todavía. Esto valida el modelo de 3 capas antes de exponerlo. Después se construye `/gabinete` sobre base sólida.

