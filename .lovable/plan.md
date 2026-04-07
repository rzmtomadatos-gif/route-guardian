

# Bloque operativo: Mapas + UX de campo

## Resumen ejecutivo

6 cambios ordenados por impacto real en campo. Ninguno toca persistencia SQLite, campaña local ni copiloto.

---

## Cambios por orden de prioridad

### 1. Track indicator — mostrar T{N+1} al confirmar equipo preparado
**Problema**: `closeBlockEndPrompt` (línea 731 de `useRouteState.ts`) solo cierra el modal. La nueva sesión se crea en `confirmStartSegment`, así que entre "equipo preparado" e "iniciar tramo" la UI muestra el track anterior.

**Solución**: En `closeBlockEndPrompt`, calcular `nextTrack = getMaxTrack(...) + 1` y crear una `trackSession` inactiva con ese número. Cuando `confirmStartSegment` detecte una sesión inactiva con el número correcto, la activa en vez de crear otra.

**Archivos**: `src/hooks/useRouteState.ts` — función `closeBlockEndPrompt` (~5 líneas) + ajuste menor en `confirmStartSegment` para respetar sesión pre-creada.

**Riesgo**: Si `allocateTrackNumber` no detecta la sesión inactiva, podría saltar un número. Se mitigará incluyendo sesiones inactivas en `getMaxTrack` (que ya lo hace, línea 44).

---

### 2. Pausar PMTiles — desactivar carga por defecto
**Problema**: `syncOfflineMap` en `MapDisplay.tsx` (línea 137) carga el PMTiles completo como `ArrayBuffer` → `Blob` → `URL.createObjectURL`. Archivos de cientos de MB revientan la RAM en móviles.

**Solución**: Modificar `syncOfflineMap` para que **no cargue PMTiles** salvo que el usuario lo fuerce explícitamente desde un nuevo toggle "Avanzado" en Configuración. El flujo automático (`shouldUseOfflineMap`) se apoyará únicamente en la caché de teselas del Service Worker.

**Archivos**: 
- `src/components/MapDisplay.tsx` — `syncOfflineMap`: skip bloque de carga PMTiles si modo no es `'offline-pmtiles'`
- `src/utils/offline-tiles.ts` — renombrar modo `'offline'` a `'offline-pmtiles'`, modo por defecto pasa a `'auto'` (solo caché SW)
- `src/components/OfflineMapsManager.tsx` — la sección PMTiles se mueve bajo desplegable "Avanzado" con aviso de limitaciones de memoria

**Riesgo bajo**: El código PMTiles se mantiene intacto, solo se desactiva el trigger automático.

---

### 3. Eliminar botón "Cuenta" del layout
**Problema**: La 5ª pestaña en la barra inferior solo abre `LogoutDialog`. Ya existe logout en Configuración.

**Solución**: Eliminar el bloque del botón usuario (líneas 65-83 de `AppLayout.tsx`) y la importación de `LogoutDialog` del layout. Mover el indicador "Local" (modo offline) a un badge sutil en el icono de Config cuando `isOfflineMode` sea true.

**Archivos**: `src/components/AppLayout.tsx` — eliminar botón + `LogoutDialog`, añadir indicador offline en icono Config.

**Riesgo**: Perder visibilidad del modo offline. Se mitiga con el badge en Config.

---

### 4. Aumentar caché de teselas a 5000 entradas
**Problema**: Límite actual de 2000 teselas puede quedarse corto para zonas extensas.

**Solución**: Cambiar `maxEntries: 2000` a `maxEntries: 5000` en `vite.config.ts` (línea ~75).

**Archivos**: `vite.config.ts` — 1 línea.

**Riesgo**: Ninguno. ~250MB máximo en caché, asumible.

---

### 5. Selector de tema claro/oscuro para mapa
**Problema**: El tema `dark_all` de CartoDB no se ve bien con sol directo.

**Solución**: Nuevo selector en Configuración con 2 opciones:
- **Claro**: `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png`
- **Oscuro**: `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png` (actual)

El valor se guarda en `localStorage` (`vialroute_map_theme`). `MapDisplay.tsx` lee la preferencia al crear el `tileLayer` (línea 275) y escucha cambios via evento custom para actualizar sin recargar.

Sin opción satélite (descartada por el usuario).

**Archivos**:
- `src/pages/SettingsPage.tsx` — nueva sección "Tema de mapa" con toggle/selector
- `src/components/MapDisplay.tsx` — leer preferencia en init + listener para cambio en caliente
- `src/components/GoogleMapDisplay.tsx` — aplicar estilo equivalente si aplica

**Riesgo**: Las teselas claras y oscuras son URLs distintas, así que la caché de un tema no sirve para el otro. Se avisará al usuario en la UI: "Al cambiar de tema, la caché offline se reconstruirá con las nuevas teselas al navegar con conexión".

---

### 6. Contador de caché — refrescar y hacer útil
**Problema**: `getTileCacheInfo()` se ejecuta una sola vez al montar `OfflineMapsManager`. El SW solo existe en producción (PWA instalada), no en preview.

**Solución**:
- Refrescar el contador cada 30 segundos con `setInterval`
- Si no hay SW registrado, mostrar "Caché disponible solo en la app instalada" en vez de un "0" confuso
- Añadir botón "Actualizar" manual junto al contador

**Archivos**: `src/components/OfflineMapsManager.tsx` — sección de caché (~15 líneas).

---

## Qué NO se toca

- `useAuth.ts`, `AuthGuard.tsx` — sin cambios
- Persistencia SQLite / campaña local — intacta
- Copiloto / navegación — sin cambios
- Lógica RST — sin cambios (salvo el pre-cálculo de track en `closeBlockEndPrompt`)
- `src/integrations/supabase/*` — intacto

## Riesgos globales

| Área | Riesgo | Mitigación |
|------|--------|------------|
| Track pre-creado | Duplicar número si `confirmStart` no detecta sesión inactiva | `getMaxTrack` ya incluye `trackSession.trackNumber` |
| Desactivar PMTiles | Usuario con PMTiles activo pierde mapa sin aviso | Degradación limpia: al desactivar, se restaura tile layer online |
| Cambio tema mapa | Caché del tema anterior inutilizada | Aviso en UI + la caché se reconstruye al navegar |
| Eliminar botón Cuenta | Pérdida indicador offline | Badge en icono Config |

## Propuesta de implementación

**Bloque 1** (una iteración): puntos 1, 2, 3, 4 — correcciones críticas de confianza y estabilidad.

**Bloque 2** (siguiente iteración): puntos 5, 6 — mejoras de usabilidad en campo.

