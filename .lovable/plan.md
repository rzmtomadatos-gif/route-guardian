

# Añadir búsqueda por ID empresa en /segments

## Cambio

En `src/pages/SegmentsPage.tsx`, línea 153-159, añadir `companySegmentId` al filtro de búsqueda. La comparación ya usa `.toLowerCase()` así que solo hace falta añadir el campo.

```typescript
segs = segs.filter(
  (s) =>
    s.name.toLowerCase().includes(q) ||
    s.kmlId.toLowerCase().includes(q) ||
    String(s.trackNumber).includes(q) ||
    (s.layer || '').toLowerCase().includes(q) ||
    (s.companySegmentId || '').toLowerCase().includes(q)
);
```

Un solo archivo, una sola línea añadida. Sin riesgo.

