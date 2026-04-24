# Plan — Atajo de búsqueda + Refrescar mapa (con corrección obligatoria)

## Objetivo

Añadir dos controles flotantes en la vista de mapa, sin tocar la lógica operativa existente:

1. **Botón Buscar (FAB)** + atajos de teclado (`/` y `Ctrl/Cmd+K`) que abren y enfocan `MapSearchBox`.
2. **Botón Refrescar mapa (FAB)** que fuerza un repintado seguro de overlays y, si detecta el mapa "perdido" (centro [0,0] o sin polilíneas pintadas), ejecuta una recuperación con `smartFit` sobre los tramos visibles.

Ambos botones se ocultan en modos críticos (creación manual, selección por área, navegación con overlay activo) para no estorbar.

## Cambios funcionales

### 1. `src/components/MapSearchBox.tsx`
- Convertir a `forwardRef` exponiendo vía `useImperativeHandle`:
  ```ts
  export interface MapSearchBoxHandle {
    focus: () => void;
  }
  ```
- `focus()` hace: `setOpen(true)` + `inputRef.current?.focus()` + `select()` del texto actual. **No** toca el query ni el modo activo.

### 2. `src/pages/MapPage.tsx`
- `searchBoxRef = useRef<MapSearchBoxHandle>(null)`.
- `const [mapRefreshRequest, setMapRefreshRequest] = useState(0)`.
- `handleFocusSearch = () => searchBoxRef.current?.focus()`.
- `handleRefreshMap = () => { setMapRefreshRequest(n => n + 1); toast.success('Mapa actualizado', { duration: 1200 }); }`.
- **Atajos de teclado** (`useEffect` global con `keydown`):
  - Activos solo si `visible === true`.
  - Ignorados si el `event.target` es `INPUT/TEXTAREA/SELECT/[contenteditable]`.
  - Ignorados si `creatorMode`, `areaSelectionMode`, diálogos abiertos o `state.isNavigating` con overlay activo.
  - `/` (sin modificadores) o `Ctrl/Cmd+K` → `handleFocusSearch()` + `preventDefault()`.
- **Dos FAB nuevos** integrados en la columna derecha existente (junto a "Centrar GPS"/"Orientación"), respetando el patrón visual ya documentado en `mem://ui/map/floating-controls`:
  - Icono `Search` (lucide) — `title="Buscar (/)"`.
  - Icono `RefreshCw` (lucide) — `title="Refrescar mapa"`.
  - **Visibles únicamente** cuando `!creatorMode && !areaSelectionMode` y la barra superior `MapSearchBox` está renderizada.
- Pasar `mapRefreshRequest` como prop al `<GoogleMapDisplay>` y al fallback `<MapDisplay>`.

### 3. `src/components/GoogleMapDisplay.tsx` y `src/components/MapDisplay.tsx`

Nueva prop opcional `mapRefreshRequest?: number` (default 0).

**Repintado real (corrección obligatoria):**
- Añadir `mapRefreshRequest` al array de dependencias del `useEffect` principal de dibujo de overlays (el que compara `prevFingerprintRef`).
- Dentro de un `useEffect` previo dedicado a `mapRefreshRequest`:
  1. Si `mapRefreshRequest === 0` o el contenedor no es visible → no hacer nada.
  2. Resetear `prevFingerprintRef.current = '__force_repaint__'` para que el efecto de dibujo reconstruya polilíneas/marcadores aunque el fingerprint no haya cambiado.
  3. Disparar resize del proveedor:
     - Google: `google.maps.event.trigger(map, 'resize')`.
     - Leaflet: `map.invalidateSize()`.
  4. **Recuperación segura** (solo si procede):
     - Calcular `visibleSegs = getVisibleMapSegments(segments, hiddenLayers)`.
     - Considerar "mapa perdido" si:
       - el centro actual está en `[0,0]` (con tolerancia `< 0.01`), o
       - no hay polilíneas dibujadas (`polylinesRef.current.size === 0` / equivalente Leaflet) **a pesar de que** `visibleSegs.length > 0`.
     - Si está perdido y hay `visibleSegs`: llamar `smartFit(visibleSegs, { animate: false })`.
     - Si no está perdido: **no mover el mapa**, solo repintar.

**Importante:** nunca usar `[0,0]` como destino. La recuperación delega siempre en `smartFit` con `getVisibleMapSegments`, que ya filtra coordenadas inválidas (utilidades existentes `coord-validation` + `map-visible-segments`).

## Detalles técnicos

- **Sin cambios en estado operativo**: refrescar no modifica `route.segments`, `hiddenLayers`, selección, navegación, modo RST, bloque ni track. Es puramente render.
- **Sin cambios en KML/Overpass**: no se vuelve a parsear ni a consultar nada.
- **No interfiere con creación manual**: los FAB se ocultan cuando `creatorMode` está activo, así no roban clics.
- **Compatible con persistent viewport** (`mem://architecture/persistent-viewports`): el repintado se invoca aunque `MapPage` haya estado oculto, porque cuando el usuario pulsa Refrescar el contenedor ya es visible.
- **Accesibilidad**: ambos FAB con `aria-label` y `title` en español; foco visible por defecto Radix/shadcn.

## Pruebas a realizar

1. **Atajo `/`**: con foco en el body abre y enfoca el buscador. Con foco en un input cualquiera, no actúa.
2. **`Ctrl+K` / `Cmd+K`**: idéntico, evita acción del navegador con `preventDefault`.
3. **Botón Buscar**: abre el panel y enfoca; no altera el query previo.
4. **Refrescar con KML visible**: no mueve el mapa, no borra tramos, no cambia estado; toast breve.
5. **Refrescar con mapa "perdido"** (simulado vaciando `polylinesRef`): repinta y recentra con `smartFit` sobre tramos visibles. Nunca centra en [0,0].
6. **Cambiar capa → borrar tramo → volver al mapa → Refrescar**: si la vista quedó mal, recupera; si estaba bien, no la mueve.
7. **Modos críticos**: en creación manual, área y navegación, los FAB no se muestran y los atajos no actúan.
8. **Typecheck** (`tsc --noEmit`) y **tests** (`vitest run`) verdes.

## Archivos modificados

- `src/components/MapSearchBox.tsx` — `forwardRef` + `useImperativeHandle`.
- `src/pages/MapPage.tsx` — ref, estado `mapRefreshRequest`, handlers, atajos, dos FAB.
- `src/components/GoogleMapDisplay.tsx` — prop + efecto de repintado/recuperación.
- `src/components/MapDisplay.tsx` — prop + efecto de repintado/recuperación (Leaflet).

## Limitaciones conocidas

- La heurística de "mapa perdido" se basa en centro ≈ [0,0] o ausencia total de polilíneas con datos disponibles. No detecta casos sutiles (p. ej. zoom equivocado pero centro correcto): en esos casos el botón solo repinta y el operador puede usar el buscador o "Centrar GPS" para reencuadrar.
- Los atajos de teclado solo actúan en escritorio; en móvil el acceso es vía FAB.
