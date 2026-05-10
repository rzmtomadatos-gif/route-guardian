# Plan: Trimble como grabación continua con auto-captura por cobertura GPS

## Objetivo

Cambiar el modo `TRIMBLE_LIDAR` para que el operador no inicie/cierre tramo a tramo. En su lugar, una grabación continua de la pasada usa el GPS del dispositivo, y al cerrar se generan automáticamente los `SegmentCapture` por análisis de cobertura GPS.

## Alcance (15 bloques)

### 1. Nuevo concepto: `TrimbleRecordingSession`

- Tipo en `src/types/trimble.ts`: `{ id, missionId, runId, startedAt, endedAt, startPosition?, endPosition?, notes? }`.
- `AppState`: `trimbleRecordingSessions: TrimbleRecordingSession[]`, `activeTrimbleRecordingId: string | null`.
- Defaults `[]` y `null` en `createEmptyCampaignState`.
- Zod en `campaign-schema.ts` con `.default([])` / `.default(null)` — no romper campañas antiguas.

### 2. Acciones en `RouteStateContext` / `useRouteState`

- `startTrimbleRecording()` — exige modo Trimble, misión activa, pasada activa, GPS activo. Crea sesión, setea `activeTrimbleRecordingId`. Emite `TRIMBLE_RECORDING_STARTED`.
- `closeTrimbleRecording()` — cierra sesión, dispara análisis de cobertura, genera `SegmentCapture` automáticas, emite `TRIMBLE_RECORDING_CLOSED`, `TRIMBLE_SEGMENT_AUTO_CAPTURED`, `TRIMBLE_SEGMENT_PARTIAL_COVERAGE`. Devuelve resumen `{ autoCaptured, partial, pointsAnalyzed }`.

### 3. `useTrimbleGpsLog` ajustado

- `phase = state.activeTrimbleRecordingId ? 'capture' : 'transport'` — independiente de `findActiveCapture`.
- Cada punto añade `recordingSessionId` y `matchedSegmentId` (calculado con `findCurrentSegmentFromGps`).
- Mantener throttling 10 m, `missionId`, `runId`, etc.

### 4. Detección de tramo actual por GPS

- Nuevo `src/utils/trimble/gps-segment-matcher.ts` con `findCurrentSegmentFromGps(position, segments, { maxDistanceMeters = 25 })` → `{ segmentId, distanceMeters, progress }`.
- Proyección punto-a-polilínea usando `haversineMeters` + interpolación segmentaria.
- Desempate: priorizar tramo que esté en la cola Trimble actual.

### 5. Motor de cobertura GPS

- Nuevo `src/utils/trimble/gps-coverage.ts` con `analyzeTrimbleGpsCoverage(points, segments, options)`.
- Para cada tramo:
  - proyectar puntos, filtrar por `maxDistanceMeters` (25 m).
  - convertir a `progress ∈ [0,1]`.
  - construir intervalos cubiertos con buffer ~12 m, fusionarlos.
  - `coverageRatio = longitudCubierta / longitudTotal`.
- Aceptación (todas): `matchedPoints ≥ 3`, `startProgress ≤ 0.15`, `endProgress ≥ 0.85`, `coverageRatio ≥ 0.70`, dirección creciente, sin huecos > 30 %.
- No tocar estados terminales (`procesado_ok`, `descartado_por_calidad`, `no_capturable`).
- Devuelve `{ captured: [...], partial: [...] }`.

### 6. `SegmentCapture` extendido

- Campos opcionales: `captureSource?: 'manual' | 'gps_auto'`, `recordingSessionId?`, `coverageRatio?`, `matchedPoints?`.
- `fieldNotes` por defecto `'Auto-detectado por cobertura GPS Trimble'` para auto.

### 7. Eventos nuevos en `EVENT_TYPES`

- `TRIMBLE_RECORDING_STARTED`, `TRIMBLE_RECORDING_CLOSED`, `TRIMBLE_SEGMENT_AUTO_CAPTURED`, `TRIMBLE_SEGMENT_PARTIAL_COVERAGE`, `TRIMBLE_CURRENT_SEGMENT_DETECTED`.
- Alinear `eventTypeEnum` Zod (deriva del array).

### 8. UI `TrimbleNavigationPanel`

- Botones principales: **Iniciar grabación** / **Cerrar grabación**.
- Mostrar:
  - Grabación activa sí/no.
  - Puntos GPS capturados de la sesión.
  - Tramo detectado por GPS + progreso + distancia al eje.
  - Resumen al cerrar (`auto-capturados`, `parciales`, `puntos analizados`).
- Mantener acciones manuales (`Repetir`, `No capturable`) como modo emergencia.

### 9. Incidencias asociadas al tramo detectado

- Diálogo de incidencia Trimble: por defecto `segmentId = detectedTrimbleSegmentId` (no `queue[0]`).
- Si no hay detección → permitir incidencia general de pasada.
- Mostrar al operador qué tramo se asociará antes de guardar.

### 10. Recalculo de cola tras cerrar

- Tras `closeTrimbleRecording`: tramos auto-capturados salen de `fullQueue`.
- Parciales y `repetir` permanecen.
- Si `driverBatch` cambia → autoenvío con `reason = 'auto_captured'` (nuevo) o reusar `order_changed`.

### 11. Excel / gabinete

- En `excel-export-v2.ts` (hoja Trimble) y `gabinete`: añadir columnas `ORIGEN_CAPTURA`, `coverageRatio`, `matchedPoints`, `recordingSessionId`. Nulos para capturas manuales antiguas.

### 12. Tests

- `trimble-gps-coverage.test.ts` — los 7 casos del brief (recto, sólo 0–60, sólo 30–100, hueco grande, inverso, dos consecutivos, fuera de eje).
- `trimble-recording-session.test.ts` — start/close, validaciones, integración con `useTrimbleGpsLog`.
- `trimble-current-segment-detection.test.ts` — cerca, lejos, asociación de incidencia.
- `trimble-auto-capture-integration.test.tsx` — flujo completo con GPS sintético y verificación de cola y autoenvío al conductor.

### 13. Verificación final

- `npx tsc --noEmit`.
- Tests Trimble + legacy import/export + Excel.

## Detalles técnicos clave

### Algoritmo proyección a polilínea

```text
para cada subsegmento [A,B] de la polilínea:
  t = clamp( ((P-A)·(B-A)) / |B-A|² , 0, 1 )
  Q = A + t·(B-A)
  d = haversine(P, Q)
quedarse con la mínima d → Q*, con
  progress = (longitudAcumuladaHasta(A*) + t*·|A*B*|) / longitudTotal
```

### Cobertura

```text
matched = puntos con d ≤ maxDistanceMeters (25)
progresos = ordenados ascendentes
intervalos = [(p - bufferRel), (p + bufferRel)] con buffer ~12 m → ratio sobre longitud
fusionar solapados → suma de longitudes / longitudTotal = coverageRatio
detectar hueco interior: gap > 0.30 entre intervalos consecutivos → reason = 'gap_too_large'
direccion: regresión simple sobre (timestamp, progress); pendiente <= 0 → 'reverse_direction'
```

### Migración compatibilidad

- Si campañas antiguas no traen `trimbleRecordingSessions` ni `activeTrimbleRecordingId`, Zod aplica defaults — no se rompe nada.
- `SegmentCapture` antiguos sin `captureSource` se interpretan como `'manual'` por defecto en lectura.

## Archivos previstos

Nuevos:

- `src/utils/trimble/gps-segment-matcher.ts`
- `src/utils/trimble/gps-coverage.ts`
- `src/test/trimble-gps-coverage.test.ts`
- `src/test/trimble-recording-session.test.ts`
- `src/test/trimble-current-segment-detection.test.ts`
- `src/test/trimble-auto-capture-integration.test.tsx`

Editados:

- `src/types/trimble.ts` (TrimbleRecordingSession, SegmentCapture extendido, TrimbleGpsPoint extendido)
- `src/types/route.ts` (AppState)
- `src/utils/storage.ts` (defaults)
- `src/utils/persistence/campaign-schema.ts` (Zod)
- `src/utils/persistence/types.ts` (EVENT_TYPES)
- `src/hooks/useRouteState.ts` (start/closeTrimbleRecording)
- `src/context/RouteStateContext.tsx` (exposición)
- `src/hooks/useTrimbleGpsLog.ts` (phase + recordingSessionId + matchedSegmentId)
- `src/components/map-control/TrimbleNavigationPanel.tsx` (botones, panel detección, autoenvío post-cierre)
- `src/components/IncidentDialog.tsx` o equivalente Trimble (asociación a tramo detectado)
- `src/utils/excel-export-v2.ts` (columnas nuevas)

## Fuera de alcance (esta iteración)

- Soporte explícito de dirección inversa como captura válida.
- Reproducción visual de la traza GPS sobre el mapa (puede venir después).
- Edición manual de cobertura tramo por tramo desde gabinete.

## El plan está bien orientado y ya ataca el problema correcto: **Trimble debe ser grabación continua + auto-captura por cobertura GPS**, no captura manual tramo a tramo.

Yo lo aprobaría **con ajustes obligatorios** antes de que Lovable lo implemente. El punto más importante: ahora `useTrimbleGpsLog` ya guarda GPS cada ≥10 m, pero todavía decide `phase='capture'` según `findActiveCapture` y mete `segmentId` desde la captura activa manual . Eso confirma que el cambio propuesto es necesario.

## Añadir al plan antes de aprobar

### 1. No eliminar todavía la captura manual

No quites del todo `startTrimbleCapture/closeTrimbleCapture`. Déjalo como **modo emergencia / corrección manual**.

Añade:

```text
La captura manual por tramo no se elimina. Queda disponible como modo emergencia desde vista avanzada o gabinete, pero el flujo principal de campo será `Iniciar grabación` / `Cerrar grabación`.

```

Motivo: si el GPS falla, si hay mala cobertura urbana o si el operador necesita forzar un tramo, no debemos dejarlo sin herramienta.

---

### 2. La grabación debe ser por `runId`, pero el análisis por `recordingSessionId`

El plan lo dice, pero hay que hacerlo explícito:

```text
`trimbleGpsLogsByRun[runId]` sigue siendo el contenedor físico de puntos GPS.
`recordingSessionId` se usa para filtrar qué puntos pertenecen a una grabación concreta.
No crear `trimbleGpsLogsByRecordingSession` en esta fase.

```

Así evitamos duplicar almacenamiento.

---

### 3. Añadir `currentMatchedSegment` como derivado, no necesariamente persistido

No hace falta guardar en `AppState` cada vez el tramo actual detectado; puede derivarse desde GPS + cola en UI.

Añade:

```text
`detectedTrimbleSegmentId`, distancia y progreso pueden ser estado local/memoizado en `TrimbleNavigationPanel`, no necesariamente persistidos en `AppState`.
Solo se persiste en eventos o incidencias cuando el operador registra algo.

```

Esto reduce riesgo de estado ruidoso.

---

### 4. Añadir control de precisión GPS

Muy importante. Si el GPS del dispositivo tiene mala precisión, puede marcar tramos falsos.

Añade:

```text
No usar puntos GPS con `accuracy > 25 m` para auto-captura, salvo que no haya accuracy disponible. 
Si accuracy > 25 m, guardar el punto, pero marcarlo como baja precisión y excluirlo del análisis de cobertura.

```

O mejor:

```ts
maxAllowedAccuracyMeters: 25

```

En `analyzeTrimbleGpsCoverage`.

---

### 5. No auto-capturar tramos con geometría insuficiente

Añade:

```text
Excluir de análisis automático segmentos con menos de 2 coordenadas o longitud inferior a un umbral mínimo configurable, por ejemplo 20 m.
Registrar finding parcial `invalid_geometry` o `too_short`.

```

---

### 6. Direccionalidad: cuidado con ida/vuelta

Tu plan dice que recorrido al revés no cuenta. Correcto para primera fase.

Pero añade:

```text
Si el tramo tiene `direction` o metadato que permita sentido inverso, en esta fase NO se interpreta automáticamente. Todo recorrido inverso queda como parcial `reverse_direction`.

```

Así no se inventa lógica.

---

### 7. No modificar tramos con incidencia no grabable

Añade:

```text
Si un tramo ya fue marcado `no_capturable` o tiene incidencia bloqueante asociada, no debe auto-capturarse aunque el GPS pase por encima.

```

Esto respeta operación real: pasar por un tramo cortado o no grabable no significa que sea válido.

---

### 8. Guardar parciales de forma consultable

El plan menciona evento `TRIMBLE_SEGMENT_PARTIAL_COVERAGE`, pero en gabinete luego será difícil explotar solo eventos.

Añade una de estas dos opciones:

Opción ligera:

```text
En fase 1, los parciales se guardan como eventos append-only y se muestran en gabinete desde Event Log.

```

Opción mejor:

```text
Añadir colección `trimbleCoverageFindings` en AppState para parciales/no contados.

```

Mi recomendación: **opción ligera ahora**, porque ya llevamos muchas migraciones.

---

### 9. Autoenvío conductor: añadir reason específico

Tu plan dice `auto_captured` nuevo o reusar `order_changed`. Mejor específico.

Añade:

```text
Añadir reason `auto_captured` a `TrimbleDriverSendReason`.
Después de cerrar grabación, si el driverBatch cambia por capturas GPS automáticas, autoenviar con reason `auto_captured`.

```

---

### 10. Hacer primero motor puro, luego UI

Pediría orden de implementación estricto:

```text
Orden obligatorio:
1. Tipos + Zod + defaults.
2. Utilidades puras `gps-segment-matcher` y `gps-coverage`.
3. Tests de cobertura GPS.
4. Acciones start/close recording.
5. Ajuste `useTrimbleGpsLog`.
6. UI.
7. Excel/gabinete.

```

No dejaría que empiece por UI, porque aquí el riesgo está en el algoritmo.

## Texto que añadiría al plan

```text
Añadidos obligatorios antes de implementar:

1. Mantener captura manual por tramo como modo emergencia. El flujo principal será grabación continua, pero `startTrimbleCapture/closeTrimbleCapture` no se eliminan.

2. `trimbleGpsLogsByRun[runId]` sigue siendo el almacén físico. `recordingSessionId` solo etiqueta los puntos de una grabación concreta.

3. El tramo detectado por GPS puede ser derivado en UI; no persistir continuamente en AppState salvo en eventos/incidencias.

4. Añadir control de precisión GPS:
   - Guardar puntos aunque tengan accuracy alta.
   - Excluir del análisis automático puntos con `accuracy > 25 m`, salvo `accuracy == null`.
   - Reportar cuántos puntos fueron descartados por baja precisión.

5. Excluir segmentos con geometría insuficiente:
   - menos de 2 coordenadas;
   - longitud menor que umbral mínimo, por ejemplo 20 m.
   - registrar parcial/finding `invalid_geometry` o `too_short`.

6. No auto-capturar tramos ya terminales:
   - `capturado_pendiente_proceso`;
   - `procesado_ok`;
   - `descartado_por_calidad`;
   - `no_capturable`.
   Tampoco auto-capturar tramos con incidencia bloqueante/no grabable.

7. Recorrido inverso no se acepta en esta fase. Debe quedar como parcial con reason `reverse_direction`.

8. Añadir reason específico de autoenvío:
   - `auto_captured`
   Después de cerrar grabación, si se generan capturas automáticas y cambia el `driverBatch`, autoenviar lote conductor con reason `auto_captured`.

9. Parciales:
   - En esta fase pueden guardarse como eventos `TRIMBLE_SEGMENT_PARTIAL_COVERAGE`.
   - Deben ser visibles en resumen de cierre y posteriormente en gabinete o Event Log.

10. Orden de implementación obligatorio:
   - tipos/defaults/Zod;
   - utilidades puras GPS;
   - tests de cobertura;
   - acciones start/close recording;
   - ajuste de `useTrimbleGpsLog`;
   - UI;
   - Excel/gabinete.

11. Añadir tests adicionales:
   - puntos con accuracy > 25 m no cuentan para cobertura;
   - tramo con geometría insuficiente no se auto-captura;
   - tramo con estado `no_capturable` no se auto-captura aunque el GPS lo recorra;
   - autoenvío post-cierre usa reason `auto_captured`.

```

## Veredicto

**Aprobaría el plan solo con esos añadidos.**  
La arquitectura es correcta, pero sin control de precisión GPS y sin protección de estados/incidencias, puede marcar falsos “grabados” en ciudad.