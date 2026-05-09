## Objetivo

Unificar la UI operativa del mapa: un único panel inferior (`MapControlPanel`) que muta según `acquisitionMode`. Eliminar `TrimbleMapPanel` como overlay independiente, mover la configuración fuera del mapa, y añadir sincronización clara de cola Trimble con el conductor.

---

## 1. Reorganización: configuración fuera del mapa

`**SettingsPage.tsx**` — añadir/consolidar (si no están ya):

- Selector `acquisitionMode` (RST / GARMIN / TRIMBLE_LIDAR).
- Selector de día de trabajo.
- Tamaño de bloque RST / tramos por track.
- Sección "Ajustes RST", "Ajustes Garmin", "Ajustes Trimble" (placeholder si vacío).
- Toggle "Auto-enviar cola al conductor al cambiar" (Trimble).

`**MapControlPanel.tsx**` y `MapPage.tsx` — eliminar de la UI del mapa:

- Selector de día de trabajo.
- Selector de tramos por bloque.
- Botones de cambio de modo de adquisición.
- Cualquier configuración persistente.

(La lógica/handlers se mantiene en el state; sólo se quita la superficie UI del mapa.)

---

## 2. `MapControlPanel` acquisition-aware

Refactor de `MapControlPanel.tsx` a un router por modo:

```tsx
switch (acquisitionMode) {
  case 'RST':           return <RstNavigationPanel ... />;
  case 'GARMIN':        return <GarminNavigationPanel ... />;
  case 'TRIMBLE_LIDAR': return <TrimbleNavigationPanel ... />;
}
```

Crear subcomponentes en `src/components/map-control/`:

- `RstNavigationPanel.tsx` — extrae el flujo RST actual (F5/F7/F9, bloque, etc.).
- `GarminNavigationPanel.tsx` — extrae el flujo Garmin actual.
- `TrimbleNavigationPanel.tsx` — nuevo, integra lo que hoy hace `TrimbleMapPanel` + sincronización conductor.

Visualmente sigue siendo el mismo panel inferior con el mismo chrome (cyclic widths 100% / 360 / 260).

---

## 3. `TrimbleNavigationPanel` (sustituye al overlay)

Reglas de render:

- **Cabecera fija**: modo · misión activa · pasada activa · GPS · estado copiloto · estado sincronización cola.
- **Sin misión**: botón "Abrir misión" + link "Vista avanzada" (`/trimble`).
- **Misión sin pasada**: selector ida/vuelta/otro + "Abrir pasada" + "Cerrar misión".
- **Misión + pasada**:
  - Tramo actual (auto desde cola, no selección manual): nombre, ID empresa, estado, próximos.
  - Acciones: Iniciar / Cerrar / Repetir / No capturable / Incidencia.
  - Bloque "Conductor" con estado de sincronización + botón único `Enviar/Actualizar conductor`.

Reusa `buildTrimbleRecordingQueue`, `trimbleQueueToStops`, `buildGoogleMapsBatchUrl`, `copilot.pushQueue` (sin duplicar lógica).

---

## 4. Sincronización con conductor (fingerprint)

Nuevo util `src/utils/trimble/queue-fingerprint.ts`:

```ts
export function trimbleQueueFingerprint(queue: TrimbleQueueItem[]): string {
  return queue.map(q => `${q.segment.id}:${q.status}`).join('|');
}
```

En `TrimbleNavigationPanel`:

- `lastSentFingerprintRef` guardado en `useRef` + `sessionStorage` (key `trimble.lastQueueFp`).
- Calcular fingerprint actual cada render.
- Si `current !== lastSent` y hay `copilot.session` activa → estado "Ruta desactualizada" (botón en `bg-amber-500` destacado).
- Si igual → "Conductor actualizado" (variante outline).
- Al pulsar enviar: `pushQueue(...)` y actualizar fingerprint.
- Si en Settings está activado "auto-enviar": disparar automáticamente vía `useEffect` con debounce 800 ms.

---

## 5. `SegmentsPage` — columnas y filtros Trimble

Cuando `acquisitionMode === 'TRIMBLE_LIDAR'` o existan capturas:

- Nuevas columnas: Estado Trimble (badge con color del esquema), última misión, última pasada, fecha captura, QA, intentos, entregables (count).
- Nuevos filtros: Pendientes / Capturados pendientes proceso / Repetir / No capturables / QA OK / Descartados.
- Reusa `deriveTrimbleSegmentStatus` y `STATUS_BADGE_CLASS`.

Helper `src/utils/trimble/segment-summary.ts` para derivar última misión/pasada/fecha por tramo desde `trimbleSegmentCaptures`.

---

## 6. `GabineteTrimblePanel` — 3 vistas

Refactor con tabs internos:

- **Resumen** (existente, mantener cards de KPIs).
- **Por tramo** (nueva, primaria): tabla — ID empresa · nombre · capa · estado campo · estado QA · última misión · última pasada · intentos · incidencia · entregables · acción QA.
- **Entregables**: tabla — tipo · tramo · misión · pasada · referencia · archivo · subido por · fecha.
- "Capturas (detalle técnico)" pasa a tab secundario.

---

## 7. Leyenda Trimble en mapa

Pequeño componente `TrimbleLegend.tsx` mostrado en `MapPage` solo si `acquisitionMode === 'TRIMBLE_LIDAR'`. Posición: esquina inferior izquierda, colapsable. Usa `TRIMBLE_STATUS_COLOR` ya existente en `segment-colors.ts` (exportarlo).

---

## 8. Limpieza

- Borrar import y render de `TrimbleMapPanel` en `MapPage.tsx`.
- Mantener el archivo `TrimbleMapPanel.tsx` solo si se reutiliza en `/trimble` como vista avanzada; si no, eliminarlo.
- En modo RST/Garmin: panel no muestra nada Trimble; en modo Trimble: nada RST/F5/bloque ni Garmin.

---

## 9. Tests

Nuevos en `src/test/`:

- `map-control-panel-mode-switch.test.tsx` — render por modo, ausencia de controles ajenos.
- `trimble-queue-fingerprint.test.ts` — cambia con cierres.
- `trimble-driver-sync.test.tsx` — fingerprint cambia → botón destacado; click → `pushQueue` llamado.
- `segments-page-trimble-columns.test.tsx` — columnas y filtros visibles en modo Trimble.
- `gabinete-trimble-by-segment.test.tsx` — tab "Por tramo" presente.

Mantener tests legacy: `trimble-recording-queue.test.ts`, `trimble-segment-status.test.ts`, `trimble-copilot-batch.test.ts`, suites RST/Garmin/Excel sin cambios.

---

## 10. Verificación final

`tsc --noEmit` (vía build automático del harness) + `bunx vitest run` filtrando por:

- `trimble-`
- `map-control`
- `copilot`
- `excel-export` (aislado)

---

## Archivos afectados (resumen)

**Crear**:

- `src/components/map-control/RstNavigationPanel.tsx`
- `src/components/map-control/GarminNavigationPanel.tsx`
- `src/components/map-control/TrimbleNavigationPanel.tsx`
- `src/components/map/TrimbleLegend.tsx`
- `src/utils/trimble/queue-fingerprint.ts`
- `src/utils/trimble/segment-summary.ts`
- 5 tests nuevos.

**Editar**:

- `src/components/MapControlPanel.tsx` (router por modo, extraer subpaneles).
- `src/pages/MapPage.tsx` (quitar `TrimbleMapPanel`, añadir leyenda, quitar selectores de configuración).
- `src/pages/SettingsPage.tsx` (consolidar selectores movidos).
- `src/pages/SegmentsPage.tsx` (columnas + filtros Trimble).
- `src/components/gabinete/GabineteTrimblePanel.tsx` (3 tabs).
- `src/utils/segment-colors.ts` (exportar `TRIMBLE_STATUS_COLOR`).

**Eliminar (si no se reutiliza)**:

- `src/components/trimble/TrimbleMapPanel.tsx`.

## Antes de considerar terminado el refactor, debe existir una checklist de paridad funcional para RST y Garmin.

RST debe conservar:

- iniciar/detener navegación;

- tramo actual / siguiente;

- inicio y finalización de tramo;

- incidencias;

- repetir/reactivar;

- salto de tramo;

- cancelación de inicio si existe;

- copiloto;

- progreso de bloque/track;

- cierre/finalización de track;

- GPS;

- estado de fin de vídeo;

- base;

- optimización;

- anterior/siguiente;

- modo colapsado/expandido y cambio de ancho.

Garmin debe conservar:

- navegación;

- registro operativo;

- copiloto;

- estados visibles;

- GPS;

- acciones propias sin mostrar controles RST innecesarios.

No se aprueba si RST o Garmin pierden funcionalidad respecto al panel actual.