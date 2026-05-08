## 1. Resumen de arquitectura

Se añade el modo `TRIMBLE_LIDAR` como tercer valor de `AcquisitionMode` (definido **únicamente** en `src/types/route.ts`). El modo Trimble vive como **dominio paralelo** —Misión → Pasada → Captura → Entregable— sin reutilizar `TrackSession` ni el flujo F5/F7/F9, y con su propio GPS log independiente.

VialRoute sigue siendo cuaderno de bitácora: registra qué se intenta capturar, con qué pasada, incidencias y entregable externo (procesado fuera, en TBC/POSPac/TMX). La calidad final (`procesado_ok`, `procesado_con_observaciones`, `descartado_por_calidad`) **sólo la fija gabinete** mediante `qaStatus`; campo no puede asignarla (constraint TS + Zod).

Persistencia: todas las nuevas colecciones viven en `AppState` (sin tablas SQLite nuevas), serializadas dentro del JSON principal `app_state`. Entregables son **referencias/metadatos** únicamente — nunca binarios.

```text
Campaign (mode=TRIMBLE_LIDAR)
  └─ CaptureMission (día / vehículo / sensor)
       ├─ CaptureRun #1 (pasada: ida)
       │     └─ SegmentCapture[] (link por runId, NO array invertido)
       ├─ CaptureRun #2 (pasada: vuelta)
       └─ TrimbleIncident[]
  └─ TrimbleDeliverable[] (referencias externas)
  └─ trimbleGpsLogsByRun (GPS propio Trimble)
```

`activeCaptureId` **no** existe en `AppState`. Se deriva siempre:

```ts
const activeCapture = trimbleSegmentCaptures.find(
  c => c.runId === activeRunId && c.endedAt === null
);
```

**Invariante**: como máximo una captura abierta por `runId`. Validado en hook + test.

## 2. Archivos a tocar / crear

**Crear:**

- `src/types/trimble.ts` — tipos del dominio Trimble. Importa **solo** `LatLng` desde `@/types/route` (no `AcquisitionMode`).
- `src/hooks/useTrimbleMission.ts` — orquestación misión/pasada/captura. Consume `**useRouteStateContext()**`.
- `src/hooks/useTrimbleGpsLog.ts` — GPS propio Trimble (independiente de `TrackSession`).
- `src/components/TrimbleGpsLogger.tsx` — wrapper sin UI.
- `src/components/trimble/TrimbleMissionPanel.tsx`
- `src/components/trimble/TrimbleRunControls.tsx`
- `src/components/trimble/TrimbleIncidentDialog.tsx`
- `src/components/trimble/TrimbleDeliverableDialog.tsx`
- `src/components/gabinete/TrimbleMissionsTable.tsx`
- `src/components/gabinete/TrimbleRunsTable.tsx`
- `src/components/gabinete/TrimbleCoverageTable.tsx`
- `src/components/gabinete/TrimbleIncidentsTable.tsx`
- `src/components/gabinete/TrimbleDeliverablesTable.tsx`
- `src/utils/trimble/coverage.ts`
- `src/utils/trimble/excel-trimble.ts`
- `src/utils/trimble/kml-export.ts`
- `src/utils/trimble/mode-change-guard.ts`
- `src/test/trimble-mission.test.ts`
- `src/test/trimble-coverage.test.ts`
- `src/test/trimble-export.test.ts`
- `src/test/trimble-gps-log.test.ts`
- `src/test/trimble-mode-change.test.ts`
- `src/test/trimble-event-type-alignment.test.ts` — falla si existe `EventType` TS no aceptado por Zod.
- `src/test/campaign-import-legacy.test.ts`

**Editar:**

- `src/types/route.ts` — extender `AcquisitionMode`, añadir colecciones Trimble a `AppState`.
- `src/utils/storage.ts` — `createEmptyCampaignState` inicializa colecciones Trimble vacías.
- `src/hooks/useRouteState.ts` — acciones Trimble; `setAcquisitionMode` consulta el guard.
- `src/hooks/useTrackGpsLog.ts` — **early return si `acquisitionMode === 'TRIMBLE_LIDAR'**`.
- `src/utils/persistence/types.ts` — nuevos `EventType` con prefijo `TRIMBLE_*`.
- `src/utils/persistence/campaign-schema.ts` — Zod ampliado, defaults, límites Trimble.
- `src/components/MapControlPanel.tsx` — selector con 3 modos; panel Trimble cuando activo.
- `src/pages/MapPage.tsx` — montar `TrimbleGpsLogger` en modo Trimble.
- `src/pages/GabinetePage.tsx` — pestaña "Trimble".
- `src/utils/excel-export-v2.ts` — invocar hojas Trimble **solo si hay datos** Trimble.
- `src/pages/SettingsPage.tsx` — selector modo + aviso si bloqueado.

**No tocar:** flujo F5/F7/F9, `TrackSession`, lógica RST, lógica Garmin, `trackGpsLogsByDay`.

## 3. Tipos TypeScript nuevos (`src/types/trimble.ts`)

```ts
import type { LatLng } from '@/types/route'; // solo LatLng — AcquisitionMode vive en route.ts

export type TrimbleSegmentStatus =
  | 'pendiente'
  | 'en_captura'
  | 'capturado_pendiente_proceso'
  | 'procesado_ok'                  // solo gabinete
  | 'procesado_con_observaciones'   // solo gabinete
  | 'repetir'
  | 'descartado_por_calidad'        // solo gabinete
  | 'no_capturable';

export type TrimbleFieldStatus = Extract<TrimbleSegmentStatus,
  'en_captura' | 'capturado_pendiente_proceso' | 'repetir' | 'no_capturable'>;

export type TrimbleQaStatus = Extract<TrimbleSegmentStatus,
  'procesado_ok' | 'procesado_con_observaciones' | 'descartado_por_calidad'>;

export interface CaptureMission {
  id: string;
  workDay: number;
  startedAt: string;
  endedAt: string | null;
  vehicle?: string;
  sensorRig?: string;
  operator?: string;
  weather?: string;
  notes?: string;
  closedReason?: 'manual' | 'fin_jornada' | 'incidencia';
}

export interface CaptureRun {
  id: string;
  missionId: string;
  index: number;
  direction?: 'ida' | 'vuelta' | 'otro';
  startedAt: string;
  endedAt: string | null;
  startPosition?: LatLng;
  endPosition?: LatLng;
  notes?: string;
  // Capturas se derivan por runId — NO se almacena array invertido.
}

export interface SegmentCapture {
  id: string;
  segmentId: string;
  runId: string;
  missionId: string;
  startedAt: string;
  endedAt: string | null;        // null === captura abierta
  startPosition?: LatLng;
  endPosition?: LatLng;
  fieldStatus: TrimbleFieldStatus;
  fieldNotes?: string;
  qaStatus: TrimbleQaStatus | null;
  qaNotes?: string;
  qaReviewedBy?: string;
  qaReviewedAt?: string;
}

export type TrimbleIncidentCategory =
  | 'gnss_perdida' | 'imu_drift' | 'oclusion_severa' | 'fallo_sensor'
  | 'fallo_almacenamiento' | 'trafico_extremo' | 'climatologia'
  | 'acceso_imposible' | 'otro';

export interface TrimbleIncident {
  id: string;
  missionId: string;
  runId?: string | null;
  segmentId?: string | null;
  category: TrimbleIncidentCategory;
  severity: 'baja' | 'media' | 'alta' | 'bloqueante';
  note?: string;
  timestamp: string;
  location?: LatLng;
  invalidatesRun?: boolean;
}

export type TrimbleDeliverableKind =
  | 'trayectoria' | 'nube_puntos' | 'imagenes' | 'ortho_lane'
  | 'informe_qa' | 'informe_pci_iri' | 'csv' | 'shp' | 'kmz' | 'pdf'
  | 'las' | 'tmx' | 'otro';

export interface TrimbleDeliverable {
  id: string;
  kind: TrimbleDeliverableKind;
  missionId?: string | null;
  runId?: string | null;
  segmentId?: string | null;
  reference: string;            // URL, ruta NAS, ID en TBC — NUNCA binario
  fileName?: string;
  sizeBytes?: number;
  hash?: string;
  uploadedBy?: string;
  uploadedAt: string;
  notes?: string;
}

export interface TrimbleGpsPoint {
  timestamp: string;
  lat: number;
  lng: number;
  accuracy?: number | null;
  speed?: number | null;
  heading?: number | null;
  missionId: string;
  runId: string;
  phase: 'transport' | 'capture';
  segmentId?: string | null;
  source: 'gps';
}

/** Helper compartido — única fuente de verdad para "captura activa". */
export function findActiveCapture(
  captures: SegmentCapture[],
  activeRunId: string | null,
): SegmentCapture | null {
  if (!activeRunId) return null;
  return captures.find(c => c.runId === activeRunId && c.endedAt === null) ?? null;
}
```

## 4. Migración de estado

`AppState` añade (todo opcional para restore de campañas antiguas):

```ts
trimbleMissions: CaptureMission[];           // default []
trimbleRuns: CaptureRun[];                   // default []
trimbleSegmentCaptures: SegmentCapture[];    // default []
trimbleIncidents: TrimbleIncident[];         // default []
trimbleDeliverables: TrimbleDeliverable[];   // default []
trimbleGpsLogsByRun: Record<string, TrimbleGpsPoint[]>; // default {}
activeMissionId: string | null;              // default null
activeRunId: string | null;                  // default null
// NO se añade activeCaptureId — se deriva con findActiveCapture().
```

- `createEmptyCampaignState` inicializa los 8 campos.
- **Zod (`campaign-schema.ts`)** — límites fase 1 conservadores:
  - `acquisitionMode: z.enum(['RST', 'GARMIN', 'TRIMBLE_LIDAR']).default('RST')`
  - `trimbleMissions: z.array(...).max(5_000).default([])`
  - `trimbleRuns: z.array(...).max(50_000).default([])`
  - `trimbleSegmentCaptures: z.array(...).max(100_000).default([])`
  - `trimbleIncidents: z.array(...).max(10_000).default([])`
  - `trimbleDeliverables: z.array(...).max(50_000).default([])`
  - `trimbleGpsLogsByRun: z.record(z.string(), z.array(trimbleGpsPointSchema).max(100_000)).default({})`
  - `activeMissionId / activeRunId`: `.string().nullable().default(null)`
- **Avisos blandos en runtime** (no en Zod) cuando se alcanzan umbrales:
  - 80% del límite → toast "Cierra el run/misión o exporta la campaña".
  - 100% → bloquear append y forzar cierre.
- Campañas antiguas RST/Garmin importan sin error (todo `.default(...)`).
- **No** se crea tabla SQLite nueva.
- `SegmentStatus` clásico **no** se amplía.

## 5. Componentes UI nuevos

**Campo (modo Trimble):**

- `TrimbleMissionPanel`, `TrimbleRunControls`, `TrimbleIncidentDialog`, `TrimbleDeliverableDialog`.
- `TrimbleRunControls` muestra captura activa derivada y deshabilita "Abrir captura" si ya existe una abierta en el run.

**Gabinete (`GabinetePage` pestaña Trimble):**
Misiones → Pasadas → Cobertura por tramo → Incidencias → Entregables. Acciones gabinete: fijar `qaStatus`, marcar repetir, asociar entregable.

## 6. Eventos nuevos del Event Log

**Antes** de añadir nada, alinear `EventType` (TS) ↔ `eventTypeEnum` (Zod). Hay desalineación previa que también se corrige (p. ej. `SEGMENT_REACTIVATED_FOR_FIELD`, `SEGMENT_DUPLICATED` están en TS pero no en Zod).

Test nuevo `trimble-event-type-alignment.test.ts`:

```ts
// Importa EventType y eventTypeEnum, asserta:
//   - todo valor del union TS está en eventTypeEnum.options
//   - todo valor de eventTypeEnum.options es un EventType válido (mismo set)
// Falla si hay drift.
```

Después se añaden a **ambos** ficheros, con prefijo `TRIMBLE_*`:

```text
TRIMBLE_MISSION_STARTED, TRIMBLE_MISSION_CLOSED
TRIMBLE_RUN_STARTED, TRIMBLE_RUN_CLOSED, TRIMBLE_RUN_INVALIDATED
TRIMBLE_CAPTURE_STARTED, TRIMBLE_CAPTURE_CLOSED
TRIMBLE_CAPTURE_MARKED_PENDING_PROCESS
TRIMBLE_CAPTURE_MARKED_REPEAT
TRIMBLE_CAPTURE_MARKED_NON_CAPTURABLE
TRIMBLE_INCIDENT_RECORDED
TRIMBLE_DELIVERABLE_LINKED, TRIMBLE_DELIVERABLE_UNLINKED
TRIMBLE_QA_STATUS_SET
TRIMBLE_MODE_ACTIVATED
```

## 7. Cambios en exportación

`excel-export-v2.ts`:

```ts
const hasTrimbleData =
  state.trimbleMissions.length > 0 ||
  state.trimbleSegmentCaptures.length > 0;
if (hasTrimbleData) addTrimbleSheets(workbook, state);
```

Hojas RST/Garmin no se modifican. Hojas Trimble: Misiones, Pasadas, Cobertura por tramo, Incidencias, Entregables.

`kml-export.ts` Trimble: polilíneas por run desde `trimbleGpsLogsByRun[runId]` + incidencias como puntos. Disponible solo si hay datos Trimble.

## 8. Guard de cambio de modo (ampliado)

`utils/trimble/mode-change-guard.ts`:

```ts
export function canChangeAcquisitionMode(s: AppState): { ok: boolean; reason?: string } {
  // Estado operativo activo
  if (s.navigationActive) return { ok: false, reason: 'Navegación activa' };
  if (s.activeSegmentId) return { ok: false, reason: 'Hay un tramo activo' };
  if (s.trackSession?.active) return { ok: false, reason: 'Track abierto' };
  if (s.blockEndPrompt?.isOpen) return { ok: false, reason: 'Hay un prompt de cierre de bloque abierto' };

  // Datos RST/Garmin
  if (s.route?.segments.some(seg => seg.status === 'completado' || seg.status === 'en_progreso'))
    return { ok: false, reason: 'Existen tramos en progreso o completados' };
  if (s.incidents.length > 0) return { ok: false, reason: 'Existen incidencias registradas' };
  if (s.segmentCorrections.length > 0) return { ok: false, reason: 'Existen correcciones de gabinete' };
  if (Object.values(s.lastConsumedTrackByDay ?? {}).some(n => n > 0))
    return { ok: false, reason: 'Hay tracks consumidos en algún día' };

  // GPS RST/Garmin: comprobar puntos reales, no solo claves
  for (const byTrack of Object.values(s.trackGpsLogsByDay ?? {})) {
    for (const pts of Object.values(byTrack ?? {})) {
      if (pts && pts.length > 0) return { ok: false, reason: 'Existen puntos GPS registrados' };
    }
  }

  // Datos Trimble
  if (s.trimbleMissions.length > 0) return { ok: false, reason: 'Existen misiones Trimble' };
  if (s.trimbleRuns.length > 0) return { ok: false, reason: 'Existen pasadas Trimble' };
  if (s.trimbleSegmentCaptures.length > 0) return { ok: false, reason: 'Existen capturas Trimble' };
  if (s.trimbleIncidents.length > 0) return { ok: false, reason: 'Existen incidencias Trimble' };
  if (s.trimbleDeliverables.length > 0) return { ok: false, reason: 'Existen entregables Trimble' };
  if (s.activeMissionId || s.activeRunId) return { ok: false, reason: 'Misión/pasada Trimble abierta' };

  // GPS Trimble: comprobar puntos reales
  for (const pts of Object.values(s.trimbleGpsLogsByRun ?? {})) {
    if (pts && pts.length > 0) return { ok: false, reason: 'Existen puntos GPS Trimble' };
  }

  return { ok: true };
}
```

`setAcquisitionMode` consulta el guard; si `!ok`, no aplica y devuelve la razón al UI (toast). Modo se elige al **crear/cargar** campaña o cuando esté **vacía**.

## 9. GPS doble — separación estricta por modo

`useTrackGpsLog` (editado):

```ts
// Early return: en modo Trimble, este hook NO registra nada.
if (state.acquisitionMode === 'TRIMBLE_LIDAR') return;
// resto igual: requiere navigationActive + trackSession.active...
```

`useTrimbleGpsLog` (nuevo):

- Registra **solo si** `acquisitionMode === 'TRIMBLE_LIDAR'` && `activeMissionId` && `activeRunId`.
- Push a `trimbleGpsLogsByRun[activeRunId]` con throttling ≥10 m.
- `phase`: `'capture'` si `findActiveCapture(...)` no es null, si no `'transport'`.
- `segmentId` desde la captura activa derivada.
- Bloquea append y avisa cuando `points.length >= 100_000`.

Criterios de aceptación cubiertos por `trimble-gps-log.test.ts`:

1. Modo `TRIMBLE_LIDAR` + run abierto → `useTrimbleGpsLog` añade a `trimbleGpsLogsByRun`.
2. Modo `TRIMBLE_LIDAR` → `useTrackGpsLog` NO añade a `trackGpsLogsByDay`.
3. Modo `RST` → `useTrimbleGpsLog` no añade nada.
4. Modo `GARMIN` → `useTrimbleGpsLog` no añade nada.
5. Modo `RST`/`GARMIN` con track abierto → `useTrackGpsLog` sigue funcionando como antes (regresión).

## 10. Integridad de capturas

Reglas en `useTrimbleMission`:

- `openCapture(segmentId)`:
  - Si `findActiveCapture(captures, activeRunId)` ≠ null → **rechaza** con error "Hay una captura abierta. Ciérrala antes de abrir otra."
  - Requiere `activeRunId` ≠ null.
- `closeCapture(captureId, fieldStatus)`:
  - Marca `endedAt = now`, `fieldStatus`.
  - Emite `TRIMBLE_CAPTURE_CLOSED`.
- `closeRun(runId)`:
  - Cierra automáticamente cualquier captura abierta del run con `fieldStatus = 'capturado_pendiente_proceso'` por defecto (configurable).
- `closeMission(missionId)`:
  - Cierra runs abiertos → cierra capturas abiertas en cascada.

Test `trimble-mission.test.ts` cubre:

- Abrir 2ª captura sin cerrar la 1ª → throw + estado intacto.
- Cerrar run con captura abierta → captura se cierra automáticamente.
- Marcar `procesado_ok` desde campo (`fieldStatus`) → imposible por TS; intento vía RPC genérica → rechazado en runtime.

## 11. Pruebas

Vitest:

- `trimble-mission.test.ts` — apertura/cierre, **invariante de única captura abierta por run**, cascada de cierre, separación field/qa.
- `trimble-coverage.test.ts` — derivación de estado por tramo (último qa > último field).
- `trimble-export.test.ts` — Excel Trimble se añade solo si hay datos; sin Trimble = idéntico (snapshot).
- `trimble-gps-log.test.ts` — los 5 criterios de §9.
- `trimble-mode-change.test.ts` — guard rechaza con cada caso de §8 (incluye `blockEndPrompt`, `lastConsumedTrackByDay > 0`, GPS con puntos reales aunque haya claves vacías, runs/incidencias/deliverables Trimble); permite en campaña vacía.
- `trimble-event-type-alignment.test.ts` — paridad estricta `EventType` ↔ `eventTypeEnum`.
- `campaign-import-legacy.test.ts` — fixture RST antiguo y Garmin antiguo importan OK; roundtrip Trimble export→import.
- `campaign-isolation.test.ts` (extender) — nueva campaña Trimble nace con colecciones vacías y `activeMissionId/RunId = null`.
- Regresión completa: garantizar RST/Garmin intactos, `useTrackGpsLog` y `excel-export` clásicos sin cambios.

## 12. Riesgos detectados

- **Cambio de modo destructivo**: mitigado con guard estricto (§8).
- **Volumen GPS/capturas**: límites Zod conservadores fase 1 + avisos al 80%/bloqueo al 100%.
- **Entregables como referencias externas**: si el NAS cambia, la referencia rompe — aceptado y documentado.
- **Auto-marcado falso de calidad**: imposible por tipos + Zod.
- **Drift `EventType` ↔ Zod**: cubierto por test de alineación.
- **Crecimiento `app_state` JSON**: con límites de §4 acotado; fase 2 podrá mover GPS Trimble a tabla propia si hace falta.

## 13. Fuera de esta primera fase

- Procesado de nube de puntos (LAS/LAZ) en cliente.
- Cálculo PCI/IRI en VialRoute.
- Subida real de binarios.
- Integración API directa con TBC / TMX / POSPac.
- Visor 3D de nube de puntos.
- Cobertura métrica precisa por tolerancia X m (solo proximidad básica).
- Firmas/hash criptográfico de entregables.
- Tabla SQLite dedicada para entregables o GPS Trimble.
- Sincronización multi-dispositivo de misiones.

# Orden de implementación obligatorio:

Primero se implementarán tipos, Zod, defaults de AppState, EventType alignment y tests de importación legacy. 

Hasta que esos tests pasen, no se tocará la UI de campo ni gabinete.

Las acciones Trimble deben ser atómicas: si una acción falla a mitad de camino, no debe dejar misión, run, captura o GPS en estado parcial. En caso de error, el estado anterior debe permanecer intacto.