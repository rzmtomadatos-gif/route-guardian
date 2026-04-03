

## El mapa tapa los controles — forzar z-index correcto

### Problema

El contenedor del mapa (Leaflet/Google Maps) crea su propio contexto de apilamiento con z-index altos internos. Aunque los FABs y el panel de control usan `z-20`/`z-30`, el canvas del mapa puede sobreponerse visualmente a estos elementos porque el contenedor del mapa no tiene un z-index explícito inferior.

### Solución

Asignar `z-0` al contenedor del mapa y asegurar que todos los overlays operativos están en una capa superior con `z-10` o más.

### Cambios

**`src/pages/MapPage.tsx`** — línea 1003

Cambiar el div contenedor del mapa de:
```html
<div className="flex-1">
```
a:
```html
<div className="flex-1 relative z-0">
```

Esto fuerza un nuevo contexto de apilamiento para el mapa con `z-0`, haciendo que todo lo que tenga `z-10` o superior (indicador de modo, debug, FABs `z-20`, paneles `z-30`, MapControlPanel) quede siempre por encima, independientemente de los z-index internos de Leaflet o Google Maps.

### Impacto

- Cero cambios en lógica ni funcionalidad.
- Los controles de zoom de Leaflet (+/−) seguirán visibles dentro del mapa.
- Todos los botones operativos (FABs, panel de control, overlays de navegación) quedarán siempre accesibles por encima del mapa.

