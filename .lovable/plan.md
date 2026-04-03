

## Añadir botón "Crear KML" en estados vacíos (sin ruta cargada)

### Situación actual

- **MapPage** (`/map`): Ya tiene un estado vacío con botón "Cargar archivo" → redirige a `/` (upload). No tiene opción de crear KML nuevo.
- **SegmentsPage** (`/segments`): No tiene guarda para `!route` — accede a `route.name` directamente (línea 301), lo que puede causar error si no hay ruta. No hay estado vacío.
- **Index.tsx** (`/`): Solo permite subir KML existente. No tiene opción de crear uno nuevo.

### Cambios propuestos

**1. `src/pages/MapPage.tsx`** — Ampliar el estado vacío (líneas 986-994)
- Mantener el botón "Cargar archivo" existente.
- Añadir un segundo botón "Crear KML nuevo" que llame a `onRouteLoaded` con una ruta vacía (nombre por defecto, sin segmentos, con ProjectCodeDialog para pedir código y nombre).
- Alternativa más simple: redirigir a `/` con un query param `?create=true` que active el flujo de creación.

**2. `src/pages/SegmentsPage.tsx`** — Añadir guarda para `!route`
- Antes del return principal (línea 296), añadir un bloque `if (!route)` que muestre:
  - Mensaje "No hay ruta cargada"
  - Botón "Cargar archivo" → navega a `/`
  - Botón "Crear KML nuevo" → activa flujo de creación

**3. `src/pages/Index.tsx`** — Añadir botón "Crear KML nuevo"
- Debajo del dropzone (tras el bloque de error, ~línea 168), añadir un separador visual y un botón "Crear KML vacío".
- Al pulsar, abrir directamente el `ProjectCodeDialog` para pedir código y nombre de proyecto.
- Al confirmar, crear una ruta vacía con ese código/nombre y navegar a `/map`.

### Flujo de creación de KML vacío

Todos los botones "Crear KML nuevo" convergen en el mismo flujo:
1. Se abre `ProjectCodeDialog` (ya existe en el proyecto).
2. El usuario introduce código de proyecto y nombre.
3. Se crea un objeto `Route` vacío con esos datos (sin segmentos, con `optimizedOrder: []`).
4. Se llama a `onRouteLoaded(route)` y se navega a `/map`.

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `src/pages/Index.tsx` | Añadir botón "Crear KML vacío" + estado para abrir ProjectCodeDialog sin archivo |
| `src/pages/MapPage.tsx` | Ampliar estado vacío con botón "Crear KML nuevo" (navega a `/?create=true`) |
| `src/pages/SegmentsPage.tsx` | Añadir guarda `if (!route)` con estado vacío y botones |

### Detalle técnico

La ruta vacía se construirá así:
```typescript
const emptyRoute: Route = {
  id: crypto.randomUUID(),
  name: projectName,
  fileName: `${code}.kml`,
  projectCode: code,
  segments: [],
  optimizedOrder: [],
};
```

El `ProjectCodeDialog` ya existe y acepta `onConfirm(code, projectName)`, por lo que se reutiliza directamente sin crear componentes nuevos.

