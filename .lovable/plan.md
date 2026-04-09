

# Información ampliada en lista de tramos (/segments)

## Situación actual

Cada fila de tramo en `LayerPanel.tsx` muestra:
- Orden en ruta (displayOrder)
- ID empresa (`companySegmentId`) — si existe
- Nombre
- Badge de estado
- Distancia al vehículo
- PK inicial → PK final (si hay kmlMeta)
- Número de incidencias (solo cantidad)
- Track number (`T{n}`)

**Falta**: carretera, posición dentro del track (`segmentOrder`), día de trabajo (`workDay`), y el motivo/categoría de cada incidencia.

## Cambios propuestos

### Archivo: `src/components/LayerPanel.tsx`

Modificar el bloque de renderizado de cada segmento (líneas ~405-447) para añadir los campos solicitados en un layout de dos líneas:

**Línea 1** (identificación):
- `companySegmentId` (ID cliente) — ya existe
- `name` — ya existe
- `kmlMeta.carretera` — **nuevo**, si existe

**Línea 2** (operativa):
- Badge de estado — ya existe
- Track + posición: `T{trackNumber}.{segmentOrder}` — **nuevo formato combinado**
- Día de trabajo: `D{workDay}` — **nuevo**
- Incidencias con categoría: icono + categoría(s) del incidente — **nuevo** (en vez de solo el conteo)

### Detalle de implementación

1. **Carretera**: leer `seg.kmlMeta?.carretera` y mostrar como chip gris al lado del nombre.

2. **Track + posición**: combinar `seg.trackNumber` y `seg.segmentOrder` en formato `T3.2` (track 3, posición 2). Si no hay track, no se muestra.

3. **Día de trabajo**: mostrar `D{seg.workDay}` como chip si `workDay` existe y es > 0.

4. **Incidencias con motivo**: en vez de solo mostrar el conteo, buscar las incidencias del segmento en `incidents` y mostrar la categoría. Si hay varias, mostrar la más grave (crítica > informativa) con su categoría traducida.

Mapa de traducción de categorías (inline):
```
lluvia → Lluvia, niebla → Niebla, bache → Bache, obra → Obra,
carretera_cortada → Cortada, inundacion → Inundación, accidente → Accidente,
obstaculo → Obstáculo, acceso_imposible → Sin acceso, trafico_extremo → Tráfico,
error_sistema_pc360 → Err PC360, error_sistema_pc2 → Err PC2,
error_sistema_linux → Err Linux, otro → Otro
```

5. **Layout**: mantener compacto (2 líneas por tramo). La primera línea lleva ID + nombre + carretera. La segunda líneva estado + T/posición + día + incidencia.

### Archivos afectados

| Archivo | Cambio |
|---------|--------|
| `src/components/LayerPanel.tsx` | Ampliar renderizado de segmento con carretera, track.orden, workDay, categoría incidencia |

No se tocan tipos, persistencia ni lógica de estado. Solo visualización.

### Riesgo

Ninguno. Es un cambio puramente visual en el componente de listado. No afecta a navegación, tracks ni trazabilidad.

