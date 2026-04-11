

# Posición visible y reordenación manual en el itinerario del mapa

## Resumen

Añadir a cada tramo en la lista de itinerario del `MapControlPanel` un badge con su posición en la ruta (1, 2, 3…) basado en `optimizedOrder`, y botones de subir/bajar para reordenar manualmente. La posición se actualiza automáticamente cuando cambia el orden optimizado.

## Cambios

### 1. `MapControlPanel.tsx` — Props

Añadir prop `onReorder: (id: string, dir: 'up' | 'down') => void` al interface `Props`.

### 2. `MapControlPanel.tsx` — Badge de posición + flechas

En el bloque de cada tramo del itinerario (líneas 614-674), añadir:

- Un `displayOrderMap` calculado con `buildDisplayOrderMap(optimizedOrder)` via `useMemo`
- Antes del nombre del tramo: un badge compacto con el número de posición (ej. `#3`)
- Al final de cada fila: dos botones pequeños ▲/▼ que llaman a `onReorder(seg.id, 'up'|'down')`, deshabilitados en los extremos

La posición mostrada refleja siempre el `optimizedOrder` actual, por lo que cualquier cambio (optimización, reordenación manual) se refleja automáticamente.

### 3. `MapPage.tsx` — Pasar prop

Pasar `onReorder={reorderSegment}` al `MapControlPanel`. La función `reorderSegment` ya existe en `useRouteState` y mueve el segmento en `optimizedOrder`.

### Archivos afectados

| Archivo | Cambio |
|---------|--------|
| `src/components/MapControlPanel.tsx` | Añadir badge posición, flechas reorden, import `buildDisplayOrderMap` |
| `src/pages/MapPage.tsx` | Pasar prop `onReorder` |

### Riesgo

Mínimo. Usa `reorderSegment` y `buildDisplayOrderMap` ya existentes. Solo cambios visuales en el panel.

