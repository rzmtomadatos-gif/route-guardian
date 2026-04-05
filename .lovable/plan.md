

# Corrección: importación rechaza `null` en eventLog

## Cambio único

**Archivo**: `src/utils/persistence/campaign-schema.ts`

Cambiar 3 líneas en `eventSchema` (aprox. líneas 183-185):

```typescript
// ANTES
workDay: z.number().optional(),
trackNumber: z.number().optional(),
segmentId: z.string().optional(),

// DESPUÉS
workDay: z.number().nullable().optional(),
trackNumber: z.number().nullable().optional(),
segmentId: z.string().nullable().optional(),
```

## Por qué

JSON serializa `undefined` como `null`. `.optional()` acepta `undefined` pero rechaza `null`. Añadir `.nullable()` acepta ambos sin afectar ningún otro comportamiento.

## Qué NO se toca

- Ningún otro archivo
- Ningún otro esquema (segmentos, incidencias, ruta, estado)
- Import/export, persistencia, auth — intactos

