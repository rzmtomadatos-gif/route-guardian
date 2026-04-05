

# Diagnóstico y plan de corrección: Mapa offline en blanco, reinicio de GPS/Copiloto, reinicio del mapa

## Diagnóstico

### Problema raíz: React Router desmonta las páginas al navegar

La arquitectura actual usa `<Routes>` estándar de React Router. Cuando navegas de `/map` a `/segments`, `/settings` o `/` (Cargar), **React desmonta completamente `MapPage`**. Cuando vuelves a `/map`, se monta una instancia nueva desde cero. Esto causa los tres problemas:

1. **GPS y Copiloto se reinician**: `useGeolocation` y `useCopilotOperator` viven dentro de `MapPage`. Al desmontar, el watch de GPS se para (`clearWatch`) y la sesión de copiloto se desconecta. Al volver, se crean nuevas instancias vacías.

2. **El mapa se reinicializa**: Tanto `GoogleMapDisplay` como `MapDisplay` (Leaflet) crean la instancia del mapa en un `useEffect` de montaje. Al desmontar, se destruye (`map.remove()`). Al volver, se recrea desde cero (vista por defecto Madrid, zoom 6).

3. **Mapa offline en blanco**: En `MapDisplay`, la función `syncOfflineMap` se pasa como dependencia del `useEffect` de inicialización (línea 314). Como `syncOfflineMap` es un `useCallback` que depende de `segments`, `activeSegmentId` y `allSegments`, cada cambio en esas props **recrea la referencia** de `syncOfflineMap`, lo que potencialmente causa que el `useEffect` de inicialización se ejecute de nuevo pero con la condición `if (mapRef.current) return` que impide la re-creación — o en el peor caso, destruye y recrea el mapa. Además, al crear el blob URL para protomaps-leaflet y luego destruir/recrear el componente, el blob se revoca pero la capa protomaps puede quedar en estado inconsistente, mostrando blanco.

## Plan de cambios

### 1. Elevar GPS y Copiloto a `AppRoutes` (persisten entre pestañas)

**Archivo**: `src/App.tsx`

- Mover `useGeolocation` y `useCopilotOperator` al nivel de `AppRoutes`, fuera de `MapPage`.
- Pasar el estado de GPS (`gpsEnabled`, `setGpsEnabled`, `geo`) y copilot como props a `MapPage` y a cualquier otra página que lo necesite.
- Así, al navegar entre pestañas, el watch de GPS sigue activo y la sesión de copiloto no se desconecta.

### 2. Preservar el mapa entre navegaciones (ocultar en vez de desmontar)

**Archivos**: `src/App.tsx`, `src/pages/MapPage.tsx`

Dos opciones (la primera es la más estable para este proyecto):

**Opción elegida: Renderizar `MapPage` siempre y ocultar con CSS**

- En `AppRoutes`, renderizar `MapPage` siempre (fuera de `<Routes>`) con `display: none` cuando la ruta activa no sea `/map`.
- Esto preserva la instancia del mapa (Google o Leaflet), los tiles cargados, la capa offline, el zoom y la posición del usuario.
- Las demás rutas (`/`, `/segments`, `/settings`) siguen dentro de `<Routes>` normal.
- Cuando se vuelve a `/map`, solo se cambia `display: none` → `display: flex` y se llama `map.invalidateSize()` (Leaflet) o `google.maps.event.trigger(map, 'resize')` para que recalcule el viewport.

### 3. Corregir la dependencia circular en `syncOfflineMap`

**Archivo**: `src/components/MapDisplay.tsx`

- Eliminar `syncOfflineMap` de las dependencias del `useEffect` de inicialización del mapa (línea 260-314).
- Usar un `ref` para `syncOfflineMap` en vez de incluirlo en el array de dependencias, evitando que cambios en segments/activeSegmentId destruyan el mapa.
- Llamar a `syncOfflineMap` desde un `useEffect` separado que responda a cambios en el ID de mapa offline activo.

### 4. Invalidar tamaño del mapa al volver a mostrarlo

**Archivo**: `src/pages/MapPage.tsx` o nuevo wrapper

- Detectar cuando la vista del mapa pasa de oculta a visible.
- Llamar `invalidateSize()` (Leaflet) o `trigger('resize')` (Google Maps) para que los tiles se re-rendericen correctamente.

## Archivos a modificar

| Archivo | Cambio |
|---|---|
| `src/App.tsx` | Elevar GPS y copiloto; renderizar MapPage persistente con CSS toggle |
| `src/pages/MapPage.tsx` | Recibir GPS/copilot como props; añadir lógica de resize al volver visible |
| `src/components/MapDisplay.tsx` | Desacoplar `syncOfflineMap` del useEffect de init; usar ref |
| `src/components/GoogleMapDisplay.tsx` | Añadir resize trigger al volver visible |

## Resultado esperado

- GPS y copiloto **no se reinician** al cambiar de pestaña.
- El mapa **conserva su estado** (zoom, posición, capa offline, tiles cargados).
- El mapa offline PMTiles **no se queda en blanco** al volver a la pestaña.
- La navegación entre pestañas es instantánea.
- No se rompe ningún flujo operativo existente.

