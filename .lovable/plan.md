## Diagnóstico

`routeToKml()` en `src/utils/kml-export.ts` falla con la campaña real porque pasa valores no-string a `escapeXml`, que llama a `.replace()`. En particular `kmlMeta.osmId` es `number` (definido en `src/utils/overpass-api.ts` y validado como `z.number()` en `campaign-schema.ts`). El error se traga porque los handlers del botón **Exportar KML** y **Exportar como…** en `SettingsPage` no tienen `try/catch` → el toast de éxito nunca llega y aparenta "no hacer nada".

## Cambios

### 1. `src/utils/kml-export.ts` — reescritura del serializador

- `escapeXml(value: unknown): string` con coerción segura:
  - `null` / `undefined` → `""`
  - `string` → tal cual
  - `number` / `boolean` → `String(value)`
  - `object` / `array` → `JSON.stringify(value)`, `""` si falla
  - cualquier otro → `String(value)`, `""` si falla
  - solo después aplica los `replace` XML
- `segmentToPlacemark`:
  - filtra `seg.coordinates` con `isValidLatLng` (ya existente en `src/utils/coord-validation.ts`: descarta `NaN`, fuera de rango y `[0,0]`)
  - si quedan `< 2` puntos, devuelve `null` y el placemark se omite
  - usa `escapeXml(seg.kmlId ?? seg.name ?? '')` y `escapeXml(seg.notes ?? '')`
  - `kmlMeta`: omite vacíos/nulos pero deja a `escapeXml` la coerción de tipos
- `routeToKml` filtra los `null` antes de unir, y emite `console.warn` con el conteo de omitidos
- Nuevo `sanitizeKmlFileName(name)` que elimina `/ \ : * ? " < > |`, controles, espacios/puntos finales y fuerza extensión `.kml`
- `downloadKml` aplica `sanitizeKmlFileName` antes de descargar

### 2. `src/pages/SettingsPage.tsx` — feedback real

Envolver con `try/catch` los dos handlers (Exportar KML / Exportar como…):

```ts
try {
  const kml = routeToKml(route);
  downloadKml(kml, ...);
  onMarkClean?.();
  toast.success('… exportado correctamente.');
} catch (e: any) {
  console.error('[Export KML] Error:', e);
  toast.error(`Error exportando KML: ${e?.message || e}`);
}
```

En "Exportar como…", si el `prompt` devuelve cadena vacía o solo espacios → cancelar.

### 3. `src/pages/Index.tsx` — `handleUnsavedExport`

Mismo `try/catch` con `console.error` y `toast.error` (importar `toast` de `sonner` si no lo está). Si el export falla, **no** marcar limpio ni continuar al siguiente archivo: el usuario debe poder reintentar.

### 4. Tests — nuevo `src/test/kml-export.test.ts`

- Segmento con `kmlMeta.osmId: 12345` (number) → no lanza, contiene `<Data name="osmId"><value>12345</value></Data>`
- Caracteres `<`, `>`, `&`, `"`, `'` en `name`, `notes`, `route.name`, `kmlMeta` → escapados a `&lt; &gt; &amp; &quot; &apos;`
- Segmento con coordenadas inválidas: si quedan ≥2 válidas se exporta solo con esas; si quedan <2 se omite el placemark
- `sanitizeKmlFileName`: elimina caracteres reservados, fuerza `.kml`, conserva espacios normales

### 5. Verificación

- `npx tsc --noEmit`
- `bunx vitest run`

## Lo que NO se toca

Importación KML, esquema Zod de campaña, mapa, navegación, RST, optimizador, gabinete.
