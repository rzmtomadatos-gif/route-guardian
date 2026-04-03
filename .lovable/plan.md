

## Problema

1. **El enlace a protomaps.com/downloads no funciona** — la página está vacía o no existe tal cual.
2. **Archivos de 130 GB no caben en IndexedDB** — `file.arrayBuffer()` intenta cargar todo en RAM y falla. No hay límite de tamaño ni feedback al usuario.
3. **No hay forma de ver el estado real de la caché de tiles online** — el usuario no sabe cuántas tiles tiene en caché ni cuánto pesan.
4. **La sección explicativa "¿Qué diferencia hay?" no aporta valor operativo** — solo texto teórico sin datos reales.

## Plan

### 1. Reemplazar guía de descarga con enlaces directos funcionales

Sustituir el desplegable actual por una sección con enlaces directos a extractos regionales de Protomaps en su CDN pública (maps.protomaps.com). Incluir un catálogo precargado con los países/regiones más relevantes para el proyecto (España, Portugal, Francia) con tamaños aproximados y URLs directas.

Flujo propuesto:
- El usuario ve una lista de regiones disponibles con su tamaño estimado.
- Pulsa "Descargar" → se descarga el `.pmtiles` directamente desde la URL pública vía `fetch` con barra de progreso.
- Al completarse, se importa automáticamente en IndexedDB sin paso intermedio de selección de archivo.

**Archivo**: `src/components/OfflineMapsManager.tsx`

### 2. Añadir descarga directa con progreso desde URL

Nueva función `downloadAndImportPMTiles(url, name)` en `src/utils/offline-tiles.ts`:
- Usa `fetch` con `ReadableStream` para medir progreso.
- Valida tamaño máximo (~2 GB, límite práctico de IndexedDB).
- Muestra barra de progreso en la UI.
- Al terminar, importa automáticamente como si fuera un archivo local.

**Archivos**: `src/utils/offline-tiles.ts`, `src/components/OfflineMapsManager.tsx`

### 3. Límite de tamaño en importación local

En `addOfflineTileSource`, añadir validación antes de `file.arrayBuffer()`:
- Si `file.size > 2 * 1024 * 1024 * 1024` (2 GB), rechazar con mensaje claro: "El archivo es demasiado grande para almacenar offline. Usa un extracto regional más pequeño."

**Archivo**: `src/utils/offline-tiles.ts`

### 4. Mostrar estado real de la caché de tiles online

Reemplazar la sección teórica "¿Qué diferencia hay?" por un panel con datos reales:
- Consultar `caches.open('map-tiles')` y contar las entradas con `.keys()`.
- Mostrar: número de tiles en caché, fecha aproximada de las más antiguas.
- Botón "Limpiar caché" para vaciarla.

**Archivo**: `src/components/OfflineMapsManager.tsx` (nueva sección al final)

### 5. Catálogo de regiones predefinidas

Definir un array estático de regiones con URLs de descarga directa. Fuente: builds públicos de Protomaps (e.g. `https://build.protomaps.com/`). Regiones iniciales:

| Región | Tamaño aprox. |
|---|---|
| España | ~600 MB |
| Portugal | ~100 MB |
| Francia | ~800 MB |
| Península Ibérica | ~700 MB |

**Archivo**: `src/utils/offline-tiles.ts` (constante `REGION_CATALOG`)

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `src/utils/offline-tiles.ts` | Catálogo de regiones, función de descarga con progreso, validación de tamaño |
| `src/components/OfflineMapsManager.tsx` | UI de catálogo con descarga directa, barra de progreso, estado de caché real, eliminar sección teórica |

### Detalle técnico

La descarga directa usa `fetch` + `Response.body.getReader()` para streaming con progreso:
```typescript
const response = await fetch(url);
const total = Number(response.headers.get('content-length'));
const reader = response.body.getReader();
const chunks: Uint8Array[] = [];
let received = 0;
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  chunks.push(value);
  received += value.length;
  onProgress?.(received / total);
}
```

Para la caché de tiles:
```typescript
const cache = await caches.open('map-tiles');
const keys = await cache.keys();
// keys.length = número de tiles en caché
```

