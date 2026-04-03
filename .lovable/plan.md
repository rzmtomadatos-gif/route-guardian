

## Mover botón "Guardar" de la barra de navegación a Configuración

### Resumen

El botón "Guardar" (exportar KML) actualmente ocupa espacio en la barra de navegación inferior, donde compite con los 4 tabs principales. Moverlo a la página de Configuración es más coherente: guardar/exportar es una acción puntual, no navegación frecuente.

### Cambios

**1. `src/components/AppLayout.tsx`**
- Eliminar todo el bloque del botón "Guardar" (líneas 79-104) y las props relacionadas (`route`, `isDirty`, `onMarkClean`).
- Eliminar imports no usados (`Save`, `routeToKml`, `downloadKml`, `toast`).
- La interfaz Props se simplifica: solo `children`, `selectedCount`, `onClearSelection`.

**2. `src/pages/SettingsPage.tsx`**
- Añadir props `isDirty` y `onMarkClean` a la interfaz.
- Añadir una nueva sección "Exportar ruta" con dos botones:
  - **Guardar KML** — exporta con el nombre actual (indicador visual de cambios pendientes si `isDirty`).
  - **Guardar como…** — permite elegir nuevo nombre.
- Ubicar esta sección después de "Campaña" y antes de "Datos", agrupada con el mismo estilo visual (icono `Save`, tarjeta con borde).

**3. `src/App.tsx`**
- Dejar de pasar `route`, `isDirty`, `onMarkClean` a `AppLayout`.
- Pasar `isDirty` y `onMarkClean` a `SettingsPage`.

### Ubicación en Settings

La sección quedará así:

```text
┌─────────────────────────────┐
│ 💾  Exportar ruta            │
│                             │
│ Exporta la ruta actual como │
│ archivo KML.                │
│                             │
│ [● Guardar KML]  [Guardar…] │
└─────────────────────────────┘
```

El indicador de cambios pendientes (punto rojo) se mostrará junto al texto del botón en lugar de en la barra de navegación.

