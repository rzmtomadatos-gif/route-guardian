

# Corrección — Emisión de TRACK_CLOSED fuera del updater en addIncident

## Problema identificado

El plan anterior colocaba `logEvent('TRACK_CLOSED', ...)` dentro del updater de `setState` en `addIncident`. Eso introduce side effects dentro del updater, rompiendo el patrón de la repo.

## Patrón existente en la repo

Hay dos variantes ya usadas:

1. **`finalizeTrack` (L569)**: emite `logEvent` directamente después del `setState(...)`, sin leer estado resultante.
2. **`completeSegment` (L526-538)**: usa `setStateRaw` con callback de solo lectura para inspeccionar el estado resultante y emitir condicionalmente.

## Solución propuesta

Usar el **patrón de `completeSegment`** (variante 2), porque necesitamos leer el estado resultante para extraer `workDay` y `trackNumber` del `blockEndPrompt` recién abierto.

Después del `setState(...)` en `addIncident`, añadir:

```typescript
// Después del setState existente (L793) y del logEvent INCIDENT_RECORDED (L794):
setStateRaw((current) => {
  if (current.blockEndPrompt.isOpen && current.blockEndPrompt.reason === 'invalidated') {
    logEvent('TRACK_CLOSED', {
      workDay: current.workDay,
      trackNumber: current.blockEndPrompt.trackNumber ?? undefined,
      payload: { reason: 'invalidated' },
    });
  }
  return current; // no mutation
});
```

Esto:
- mantiene el updater de `addIncident` libre de side effects
- emite `TRACK_CLOSED` solo cuando la invalidación realmente ocurrió
- usa el mismo patrón exacto que `completeSegment` (L526-538)
- lee `workDay` y `trackNumber` del estado real, no de variables capturadas

## Orden de emisión

```text
setState(...)           → muta estado, abre blockEndPrompt
logEvent(INCIDENT_RECORDED)  → ya existente (L794)
setStateRaw(...)        → lee estado, emite TRACK_CLOSED si invalidación
```

## Resto del plan

Sin cambios respecto al plan aprobado:
- `src/types/route.ts`: añadir `'invalidated'` a `BlockEndPrompt.reason`
- `src/hooks/useRouteState.ts`: `addIncident` abre `blockEndPrompt` con `reason: 'invalidated'`; `closeBlockEndPrompt` usa `Math.max(getMaxTrack(...), blockEndPrompt.trackNumber ?? 0) + 1`
- `src/components/EndOfVideoDialog.tsx`: texto diferenciado para `reason === 'invalidated'`
- `src/components/MapControlPanel.tsx` y `src/pages/MapPage.tsx`: pasar `reason`

