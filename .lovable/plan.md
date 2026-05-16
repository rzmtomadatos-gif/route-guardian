# Diagnóstico inicial

## Estado actual

**`src/types/trimble.ts`** (258 líneas)
- `CaptureMission`: tiene `id, workDay, startedAt, endedAt, vehicle, sensorRig, operator, weather, notes, closedReason`. **Falta todo lo nuevo** (modelo, container, DMI/GNSS, firmware/versiones, checkpoints precheck/system/gpsTime, cola estática, offload, POS folder, datum/CRS, trayectoria).
- `CaptureRun`: tiene `id, missionId, index, direction, startedAt, endedAt, startPosition, endPosition, notes, invalidated`. **Falta**: GUIDs externos, flags GPS/sistema, distancia, cola estática, contadores wifi/gnss/sensor/storage, entorno (urban canyon/tunnel/canopy), integrityStatus, operatorNotes.
- `TrimbleDeliverable`: tiene `id, kind, missionId, runId, segmentId, reference, fileName, sizeBytes, hash, uploadedBy, uploadedAt, notes`. **Falta**: storageType, version, processedBy/At, trajectoryMethod, trajectoryAccepted, datumCrs, geoidModel, processingStage.

**`src/utils/persistence/types.ts` (EVENT_TYPES)**
- Existen 30+ eventos Trimble. **Faltan los 11 nuevos**: `TRIMBLE_PRECHECK_COMPLETED`, `TRIMBLE_SYSTEM_READY_CONFIRMED`, `TRIMBLE_GPS_TIME_VALID_CONFIRMED`, `TRIMBLE_STATIC_TAIL_CONFIRMED`, `TRIMBLE_STATIC_TAIL_OVERRIDDEN`, `TRIMBLE_DATA_OFFLOADED`, `TRIMBLE_MISSION_METADATA_UPDATED`, `TRIMBLE_RUN_METADATA_UPDATED`, `TRIMBLE_TRAJECTORY_DELIVERABLE_LINKED` (reusable parcialmente con `TRIMBLE_DELIVERABLE_LINKED`), `TRIMBLE_TRAJECTORY_ACCEPTED`, `TRIMBLE_TRAJECTORY_REJECTED`.

**`src/hooks/useRouteState.ts`** (2768 líneas)
- Existen: `startTrimbleMission`, `closeTrimbleMission`, `startTrimbleRun`, `closeTrimbleRun`, `linkTrimbleDeliverable`, `unlinkTrimbleDeliverable`, etc. Todas con patrón `{ ok, reason? }` y `acquisitionMode === 'TRIMBLE_LIDAR'` guard.
- **Faltan**: las 9 acciones nuevas de checkpoint/metadata.

**`src/utils/persistence/campaign-schema.ts`**
- `trimbleMissionSchema`, `trimbleRunSchema`, `trimbleDeliverableSchema` son `.strict()` → **bloquearán campañas con campos nuevos hasta ampliarlos**, pero campañas antiguas (sin campos nuevos) seguirán cargando porque todo nuevo será `.optional()`.

**UI**
- `TrimbleFieldPanel.tsx` (398L): no tiene bloque de checkpoints; hay que añadirlo.
- `GabineteTrimblePanel.tsx` (594L): tiene gestión de entregables pero no sección dedicada a trayectoria con método/datum/aceptar/rechazar.

**Tests**: 42 archivos Trimble + `campaign-import-legacy.test.ts`. No hay tests de checkpoints.

## No tocar (evitar regresión)
- Toda la lógica RST/Garmin (F5/F7/F9, TrackSession, NavStarted).
- Cobertura GPS auto, live coverage, parallel coverage.
- Selección operativa Trimble, overlay, copiloto single-segment.
- KML/KMZ, persistencia offline, eventos Trimble existentes.
- Schemas existentes (solo ampliar añadiendo `.optional()`, no `.strict()` rompe nada porque ampliamos el propio object schema).

---

# Plan de implementación (fases pequeñas y verificables)

## Fase 1 — Tipos + Schema + Eventos
- Ampliar `CaptureMission`, `CaptureRun`, `TrimbleDeliverable` en `src/types/trimble.ts` con todos los campos opcionales del spec.
- Ampliar `trimbleMissionSchema`, `trimbleRunSchema`, `trimbleDeliverableSchema` en `campaign-schema.ts` (todos `.optional()`).
- Añadir 11 EVENT_TYPES nuevos en `src/utils/persistence/types.ts`.

## Fase 2 — Acciones / checkpoints en `useRouteState`
Implementar 9 acciones nuevas siguiendo patrón existente (`{ ok, reason? }`, guard de modo, mutación inmutable del mission/run activo, `logEvent`):
- `completeTrimblePrecheck(payload)`
- `confirmTrimbleSystemReady(payload)`
- `confirmTrimbleGpsTimeValid(payload)`
- `confirmTrimbleStaticTail(payload)`
- `overrideTrimbleStaticTail(reason)` (obliga `reason` no vacío)
- `markTrimbleDataOffloaded(payload)`
- `linkTrimbleTrajectoryDeliverable(payload)` (envuelve `linkTrimbleDeliverable` con `kind:'trayectoria'`, setea `trajectoryDeliverableId` en misión + evento)
- `updateTrimbleMissionMetadata(payload)`
- `updateTrimbleRunMetadata(payload)`
- Plus aceptar/rechazar trayectoria (`acceptTrimbleTrajectory`, `rejectTrimbleTrajectory`) — solo gabinete (registra `source:'gabinete'`).
- `startTrimbleRun`: si `mission.gpsTimeValidAt` está vacío devuelve `{ ok:true, reason:'warning_no_gps_time' }` (warning, no bloqueante).

## Fase 3 — UI campo (`TrimbleFieldPanel`)
- Bloque "Checkpoints de misión" colapsable arriba del panel:
  - 7 filas (Precheck / Sistema listo / Hora GPS válida / Misión / Run / Cola estática / Offload), con estado visual (pendiente/completado/advertencia/override).
  - Botones de acción correspondientes + diálogo simple para `staticTailSeconds` y `overrideReason`.
- Avisos visuales si run sin gpsTime / cierre misión sin static tail (no bloquean).
- Textos: "GPS VialRoute: traza auxiliar de campo, no trayectoria final."

## Fase 4 — UI gabinete (`GabineteTrimblePanel`)
- Sección "Trayectoria y datum" por misión:
  - Vincular deliverable trayectoria (selector kind=trayectoria), seleccionar `trajectoryMethod`, `datumCrs`, `geoidModel`.
  - Botones aceptar/rechazar (registran source:'gabinete').
  - Banner amarillo si no hay trayectoria procesada vinculada.
  - Disclaimer "La traza GPS de VialRoute es auxiliar, no es la trayectoria final".

## Fase 5 — Tests
- `trimble-mission-checkpoints.test.ts`: precheck, system ready, gps time valid, run sin gps → warning, static tail confirm, override sin motivo → fail, offload, metadata.
- `trimble-trajectory-deliverable.test.ts`: link como trayectoria, accept/reject solo gabinete, no se puede marcar GPS auxiliar como final.
- `campaign-import-legacy.test.ts`: verificar (ya pasa) que campañas sin nuevos campos siguen cargando.
- `campaign-schema-trimble-checkpoints.test.ts`: round-trip de los nuevos campos.

## Fase 6 — Verificación
- `npx tsc --noEmit`
- `npx vitest run src/test/trimble-* src/test/campaign-*`
- `npx vitest run src/test/trimble-mode-change.test.ts` (no regresión RST/Garmin)

## Detalles técnicos

- Todos los nuevos campos son `?:` y schema `.optional()`. Campañas antiguas no rompen.
- Eventos siempre `acquisitionMode:'TRIMBLE_LIDAR'`, `missionId`, `runId?`, `source`, `notes?` en payload.
- Acciones gabinete (accept/reject trayectoria) requieren llamarse desde panel gabinete; el hook no comprueba rol (no hay rol en runtime del hook), pero el evento se etiqueta `source:'gabinete'` y la UI solo expone botón en `GabineteTrimblePanel`.
- No se modifica `appendTrimbleGpsPoint` ni `findActiveCapture`. La trayectoria final SIEMPRE es un `TrimbleDeliverable` externo separado de `trimbleGpsLogsByRun`.

## Riesgos
- `useRouteState` tiene 2768 líneas → el diff de añadir 9 acciones será grande pero localizado y sin tocar lógica existente.
- Diff de `GabineteTrimblePanel` puede crecer si añado UI compleja; mantendré la sección compacta.
- No voy a inventar comportamiento oficial del MX60 (los enums incluyen `'unknown' | 'other'` como pediste).

¿Procedo con Fase 1?
