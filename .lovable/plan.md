

# Decisión de diseño: `changeWorkDay` — Opción A

## Elección: Opción A (una sola acción con dos pasos)

Razón: mantiene una única función en la API del hook, evita proliferación de métodos y es coherente con el patrón ya usado en el proyecto (acciones que validan y ejecutan según contexto).

## Firma

```text
changeWorkDay(targetDay: number, options?: { force?: boolean })
  → { allowed: boolean, reason?: string, requiresConfirmation?: boolean, hasInProgress?: boolean }
```

## Flujo exacto

```text
MapControlPanel                    MapPage                          useRouteState
─────────────                    ────────                         ──────────────
Botón "Siguiente →"
  onClick(workDay + 1)  ──────→  handleChangeWorkDay(target)
                                   │
                                   ├─ llama changeWorkDay(target)     ← sin force
                                   │    hook valida canChangeWorkDay()
                                   │    NO muta estado
                                   │    devuelve resultado
                                   │
                                   ├─ si !allowed → toast(reason)
                                   │
                                   ├─ si requiresConfirmation:
                                   │    abre WorkDayChangeDialog
                                   │    (muestra hasInProgress si aplica)
                                   │
                                   └─ si allowed && !requiresConfirmation:
                                        llama changeWorkDay(target, { force: true })
                                        hook muta workDay → hecho

WorkDayChangeDialog
  onConfirm  ─────────────────→  handleConfirmDayChange()
                                   │
                                   ├─ si hasInProgress:
                                   │    cancelAllInProgress('day_change_cancel')
                                   │
                                   └─ changeWorkDay(target, { force: true })
                                        hook muta workDay → hecho
```

## Momentos exactos

| Momento | Qué ocurre |
|---|---|
| `changeWorkDay(target)` sin force | Solo valida. NO muta nada. Devuelve resultado estructurado |
| Confirmación del diálogo | MapPage llama `cancelAllInProgress('day_change_cancel')` si `hasInProgress` |
| `changeWorkDay(target, { force: true })` | Muta `workDay`, cierra `trackSession`, pone `navigationActive: false` si aplica |

## Detalle clave

`cancelAllInProgress` se llama **antes** de `changeWorkDay(force: true)`, desde MapPage. El hook no lo hace internamente para mantener la separación: la UI gestiona la secuencia (confirmar → cancelar → aplicar), el hook solo valida o ejecuta.

Esto evita que el hook tenga lógica de diálogo implícita y mantiene el flujo predecible y testeable.

