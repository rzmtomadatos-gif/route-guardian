

# Plan aprobado — Sub-bloque 2 (implementación final)

## Vigilancias confirmadas

1. **`deps.state.segments` siempre disponible**: el wrapper React `useSegmentCorrections()` lee `state.route?.segments ?? []` desde `useRouteState`. Si no hay ruta cargada, pasa `[]` y `applySegmentCorrection` lanza el error claro "Segmento no encontrado en estado". Nunca `undefined`.

2. **Tests de `previousValue` cubren ambos tipos de campo**:
   - Campo crítico: `workDay` (10 → 20), verifica `previousValue === 10` desde estado, no `1` de `req.segment`.
   - Campo descriptivo: `name` ("Real" → "Nuevo"), verifica `previousValue === "Real"` desde estado, no `"Viejo"` de `req.segment`.

3. **`readCommittedState` solo lectura**: la firma fuerza el patrón. El callback recibe `AppState` pero la implementación devuelve `current` sin mutar. TypeScript no permite que el callback retorne nada (firma `(s: AppState) => void`). Documentado en JSDoc:

```typescript
/**
 * Lee el estado YA comprometido por React tras el último setState pendiente.
 * Solo lectura: el callback no debe mutar `state`. Para escribir, usar setState.
 * Útil para emitir eventos de auditoría con datos consolidados post-commit.
 */
const readCommittedState = useCallback((cb: (s: AppState) => void) => {
  setStateRaw((current) => {
    cb(current);
    return current;  // ← devuelve la misma referencia, no muta
  });
}, []);
```

## Resumen de implementación

### Archivos

| Archivo | Cambio |
|---|---|
| `src/hooks/useRouteState.ts` | +`readCommittedState(cb)` exportado (solo lectura post-commit) |
| `src/hooks/useSegmentCorrections.ts` | (a) `deps.state.segments` + `deps.afterCommit`; (b) resolver `baseSeg` desde `deps.state.segments` por `segmentId` ANTES del updater, pasarlo al engine en lugar de `req.segment`; (c) error claro si `baseSeg` no existe; (d) reemplazar `await Promise.resolve()` por promesa basada en `afterCommit`; (e) consolidado post-commit desde `committedSegments` para el log; (f) wrapper React conecta `afterCommit` a `readCommittedState` y pasa `segments: state.route?.segments ?? []` |
| `src/components/SegmentEditDialog.tsx` | Solo claridad visual: nota informativa + mini vista read-only del consolidado para campos con corrección activa. **Sin tocar** `useState`, inputs ni `onSave` |
| `src/test/gabinete-corrections-hook.test.ts` | +tests de `previousValue` desde estado real (workDay y name) + consolidado post-commit en log + error si segmento no existe + revert con consolidado post-reversión |

### Comportamiento clave

```typescript
// applySegmentCorrection
const baseSeg = deps.state.segments.find((s) => s.id === req.segment.id);
if (!baseSeg) throw new Error(`Segmento no encontrado en estado: ${req.segment.id}`);

deps.setSegmentCorrections((prev) => {
  const result = engineApplyCorrection(prev, {
    segment: baseSeg,        // ← estado real, no req.segment
    field: req.field, newValue: req.newValue, reason: req.reason,
    correctedBy, correctedByRole,
  });
  committed = result;
  return result.corrections;
});

// Esperar commit real vía afterCommit
await new Promise<void>((resolve) => {
  if (deps.afterCommit) {
    deps.afterCommit((s) => {
      committedCorrections = s.segmentCorrections;
      committedSegments = s.segments;
      resolve();
    });
  } else { resolve(); }  // modo test: setter síncrono
});

// Consolidado para log: SIEMPRE desde committedSegments
const baseSegAfter = committedSegments.find((s) => s.id === req.segment.id);
const consolidatedAfter = baseSegAfter
  ? engineGetConsolidatedSegment(baseSegAfter, committedCorrections)
  : null;

await log('SEGMENT_CORRECTION_APPLIED', {
  workDay: consolidatedAfter?.workDay,
  trackNumber: consolidatedAfter?.trackNumber ?? undefined,
  segmentId: req.segment.id,
  payload: { /* ... */ },
});
```

### SegmentEditDialog (cambio mínimo)

```tsx
const { role } = useUserRole();
const { getActiveCorrections } = useSegmentCorrections();
const activeCorrections = getActiveCorrections(segment.id);
const canSee = role === 'admin' || role === 'gabinete';
const showInfo = canSee && activeCorrections.length > 0;

// Arriba del contenido
{showInfo && (
  <p className="text-[11px] text-muted-foreground italic">
    Campos editables: dato original de campo. Las correcciones activas de gabinete se muestran más abajo.
  </p>
)}

// Encima del SegmentCorrectionsPanel
{showInfo && (
  <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-1.5">
    <p className="text-[10px] font-semibold text-primary uppercase tracking-wide">
      Valor consolidado actual
    </p>
    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
      {activeCorrections.map((c) => (
        <div key={c.id}>
          <span className="text-muted-foreground">{getFieldLabel(c.field)}:</span>{' '}
          <span className="text-foreground font-medium">{formatCorrectionValue(c.newValue)}</span>
        </div>
      ))}
    </div>
  </div>
)}
```

`useState`, inputs y `onSave` quedan intactos: la edición de campo sigue operando sobre el dato base, sin contaminar con consolidado.

## Pendiente para sub-bloques siguientes

- Página `/gabinete` con tabs (Resumen / Tracks / Tramos / Historial).
- Editor de correcciones con diálogo de motivo.
- Botón "Revertir" funcional desde UI.
- Excel enriquecido con hojas "Tramos original" + "Correcciones de gabinete".

