

# Plan final aprobado — Sub-bloque 2 (con correcciones)

## Cambios respecto al plan anterior

**Corrección 1 — campo real del modelo**

`CorrectableField` en `src/types/route.ts` declara `segmentOrder` (no `trackPosition`). El mapa de etiquetas queda:

```typescript
// src/utils/gabinete/field-labels.ts
export const FIELD_LABELS: Record<CorrectableField, string> = {
  trackNumber:        'Track',
  workDay:            'Día',
  segmentOrder:       'Posición en track',   // ← nombre real del modelo
  status:             'Estado',
  name:               'Nombre',
  kmlId:              'ID Tramo',
  direction:          'Dirección',
  type:               'Tipo',
  notes:              'Notas',
  'kmlMeta.carretera':  'Carretera',
  'kmlMeta.identtramo': 'Identificador tramo',
  'kmlMeta.tipo':       'Tipo (KML)',
  'kmlMeta.calzada':    'Calzada',
  'kmlMeta.sentido':    'Sentido',
  'kmlMeta.pkInicial':  'PK Inicial',
  'kmlMeta.pkFinal':    'PK Final',
};
```

Si en el futuro se añade un campo nuevo a `CorrectableField`, TypeScript obligará a añadir su etiqueta aquí (Record exhaustivo).

**Corrección 2 — atomicidad real del setter**

`setSegmentCorrections` se implementa siguiendo exactamente el mismo patrón ya validado en `useRouteState` (líneas 96-103):

```typescript
// src/hooks/useRouteState.ts (extracto del nuevo setter)
const setSegmentCorrections = useCallback(
  (updater: (prev: SegmentCorrection[]) => SegmentCorrection[]) => {
    setState((s) => ({
      ...s,
      segmentCorrections: updater(s.segmentCorrections ?? []),
    }), true);  // immediate save = true para auditoría
  },
  [setState],
);
```

Garantías:
- **No hay lectura previa fuera del updater**. El updater recibe `s.segmentCorrections` actual y devuelve la nueva colección en una sola transición de React.
- **No hay race con otros setters**. `setState` ya envuelve `setStateRaw` con persistencia atómica.
- **`immediate=true`** porque las correcciones de gabinete son operaciones críticas auditables que no deben quedar a merced del debounce de 400 ms.

En el hook `useSegmentCorrections`:

```typescript
const applySegmentCorrection = async (input) => {
  // 1. Snapshot del estado para calcular el resultado puro
  let committed: ApplyCorrectionResult | null = null;
  
  // 2. Commit atómico — el cálculo vive DENTRO del updater
  setSegmentCorrections((prev) => {
    const result = engine.applyCorrection(prev, {
      segment, field, newValue, reason,
      correctedBy, correctedByRole,
    });
    committed = result;            // capturar para emitir evento después
    return result.corrections;
  });
  
  // 3. Esperar al flush del commit
  await Promise.resolve();
  
  // 4. Emitir evento SOLO si el commit produjo resultado real
  if (committed) {
    await logEvent('SEGMENT_CORRECTION_APPLIED', { ... });
  }
  
  return committed!.created;
};
```

El cálculo vía `engine.applyCorrection` ocurre dentro del updater (puro y determinista; el engine no tiene side effects). El evento se emite **fuera** y solo tras confirmar el commit, igual que `confirmNavigationStart`/`confirmStopNavigation` en el hook actual.

## Resto del plan: sin cambios

Todo lo demás del plan aprobado se mantiene tal cual:
- Archivos a crear: `useSegmentCorrections.ts`, `field-labels.ts`, `SegmentCorrectionsPanel.tsx`, `gabinete-corrections.test.ts`.
- Archivos a modificar: `useRouteState.ts` (añadir el setter), `SegmentEditDialog.tsx` (insertar panel inspección).
- Panel gated a roles `admin` y `gabinete` (`return null` para `operator`).
- Eventos `SEGMENT_CORRECTION_APPLIED/REVERTED` post-commit con payload completo.
- Reglas de supersede / no-reactivación / motivo obligatorio: heredadas del engine puro ya existente.
- Sin tocar `/gabinete`, Excel, RBAC de ruta ni edición desde la ficha de campo.

## Plan de prueba con verificación de los dos puntos

1. Test unitario: el mapa `FIELD_LABELS` cubre los 16 valores de `CorrectableField` (TypeScript exhaustive check + assertion en runtime).
2. Test del setter: dos `applySegmentCorrection` consecutivos en el mismo tick producen ambas correcciones persistidas con la primera marcada `supersededBy` correctamente — demuestra que no hay lectura/escritura separada.
3. Test del orden commit→evento: spy sobre `logEvent` confirma que se llama **después** del cambio efectivo en `state.segmentCorrections`.

