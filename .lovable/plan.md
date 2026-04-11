

# Mejora visual: badges de posición y botones de reordenación

## Problema

Los botones de subir/bajar son demasiado pequeños (w-3 h-3, sin padding) para uso táctil en móvil/tablet. El badge de posición usa text-[9px] y es difícil de leer.

## Cambios en `src/components/MapControlPanel.tsx`

### 1. Badge de posición más visible
- Cambiar de `text-[9px] text-muted-foreground` a `text-[11px] font-bold bg-primary/20 text-primary rounded` con un ancho mínimo (`min-w-[22px]`), para que destaque como etiqueta.

### 2. Botones de subir/bajar más grandes
- Aumentar los iconos de `w-3 h-3` a `w-5 h-5`.
- Añadir padding táctil: `p-1` en cada botón y área de toque mínima `min-h-[28px] min-w-[28px]`.
- Mejorar el hover/active feedback.

### 3. Verificación de actualización tras re-optimización
- El `displayOrderMap` ya se recalcula con `useMemo(() => buildDisplayOrderMap(optimizedOrder), [optimizedOrder])`. Cuando `optimizedOrder` cambia por re-optimización, React recalcula el mapa y los badges se actualizan automáticamente. **No hay bug aquí — funciona correctamente.**

### Archivo afectado

| Archivo | Cambio |
|---------|--------|
| `src/components/MapControlPanel.tsx` | Agrandar botones ▲/▼, mejorar badge de posición |

### Riesgo
Ninguno. Solo cambios de estilo CSS en elementos existentes.

