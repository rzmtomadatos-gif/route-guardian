

# Plan — Navegación OFF + activeSegmentId null al cerrar track

## Diagnóstico

Los tres puntos que cierran track y abren `blockEndPrompt` ya tienen `navigationActive: false` (implementación anterior), pero **no** ponen `activeSegmentId: null`. Además, ninguno emite `NAV_STOPPED`.

El `stopNavigation` existente (L185-238) ya establece el patrón correcto:
- `navigationActive: false`
- `activeSegmentId: null`
- Emite `NAV_STOPPED` vía `setTimeout` con `reason` + `trackNumber`

## Cambios

### Archivo único: `src/hooks/useRouteState.ts`

**En los 3 returns que abren `blockEndPrompt`**, el estado final incluirá:

```typescript
navigationActive: false,
activeSegmentId: null,
```

Los 3 puntos son:
1. `completeSegment` — cierre por capacidad
2. `finalizeTrack` — cierre manual
3. `addIncident` — invalidación crítica

### Emisión de NAV_STOPPED

**Sí se emitirá**, usando el mismo patrón `setStateRaw` (lectura sin mutación) que ya se usa para `TRACK_CLOSED` en `addIncident`.

Después del `setState` de cada cierre, se añadirá:

```typescript
setStateRaw((current) => {
  if (!current.navigationActive && current.blockEndPrompt.isOpen) {
    logEvent('NAV_STOPPED', {
      payload: {
        reason: 'track_closed_capacity',  // o 'track_closed_manual' o 'track_closed_invalidated'
        trackNumber: current.blockEndPrompt.trackNumber ?? undefined,
      },
    });
  }
  return current;
});
```

Cada punto usará su reason específico:
- `completeSegment` → `track_closed_capacity`
- `finalizeTrack` → `track_closed_manual`
- `addIncident` → `track_closed_invalidated`

### Justificación de emitir NAV_STOPPED

1. **Coherencia con `stopNavigation`**: la parada manual ya emite `NAV_STOPPED`. Si la navegación se apaga automáticamente sin emitirlo, el event log queda con un `NAV_STARTED` sin su cierre correspondiente.
2. **Trazabilidad completa**: el event log mostrará la secuencia `TRACK_CLOSED` + `NAV_STOPPED` (o `INCIDENT_RECORDED` + `TRACK_CLOSED` + `NAV_STOPPED` en invalidación), dejando claro qué ocurrió.
3. **El `reason` diferenciado** permite distinguir en auditoría si la parada fue por operador, por capacidad, por cierre manual o por invalidación.

### Orden de emisión por caso

```text
Capacidad:   setState → setStateRaw(TRACK_CLOSED) → setStateRaw(NAV_STOPPED reason:track_closed_capacity)
Manual:      setState → logEvent(TRACK_CLOSED) → setStateRaw(NAV_STOPPED reason:track_closed_manual)  
Invalidación: setState → logEvent(INCIDENT_RECORDED) → setStateRaw(TRACK_CLOSED) → setStateRaw(NAV_STOPPED reason:track_closed_invalidated)
```

## Estado final garantizado en los 3 casos

| Campo | Valor |
|---|---|
| `navigationActive` | `false` |
| `activeSegmentId` | `null` |
| `blockEndPrompt.isOpen` | `true` |
| Event log | `TRACK_CLOSED` + `NAV_STOPPED` emitidos |

## Riesgos

Bajo. Se añade `activeSegmentId: null` a 3 returns existentes y un `setStateRaw` de solo lectura para `NAV_STOPPED`. No se modifica ningún otro flujo.

## Plan de pruebas

**Capacidad**: completar hasta cierre → verificar `navigationActive === false`, `activeSegmentId === null`, event log tiene `NAV_STOPPED { reason: track_closed_capacity }`.

**Manual**: cerrar track → misma verificación con `reason: track_closed_manual`.

**Invalidación**: lanzar `critica_invalida_bloque` → misma verificación con `reason: track_closed_invalidated`, Track N+1 preparado, navegación sigue OFF.

