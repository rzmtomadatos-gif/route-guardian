# Plan: Selección operativa Trimble + overlay con acciones manuales (entrega completa)

## Objetivo

En modo `TRIMBLE_LIDAR`, el operador selecciona cualquier tramo cargado en el mapa, ve un overlay arriba‑izquierda con info y acciones, y manda al conductor solo ese tramo (INICIO/FIN). Se desactiva de verdad el autoenvío de lotes de 4 en Trimble. RST/Garmin no cambian.

Entrega única funcional. Internamente puede dividirse en commits, pero no se cierra hasta que todos los criterios de aceptación pasan.

## Definiciones base

- **Captura activa** = `SegmentCapture` con `voidedAt == null`. Toda lógica de estado, resumen, cola, gabinete y exportación ignora capturas voided salvo en detalle técnico/trazabilidad.
- **QA** (`qaStatus != null`) **nunca** se sobreescribe ni se voidea desde campo.

## 1. Estado nuevo (AppState / useRouteState)

- `trimbleOperationalSelectedSegmentId: string | null`
- `trimbleSegmentDirectionOverrides: Record<segmentId, 'normal' | 'reversed'>`
- `trimbleRecordingSegmentOverrides: Record<recordingSessionId, Record<segmentId, 'force_pending' | 'force_captured' | 'force_no_capturable'>>`

Acciones:

- `setTrimbleOperationalSelected(id|null)`
- `toggleTrimbleSegmentDirection(segmentId)`
- `setTrimbleRecordingSegmentOverride(recordingSessionId, segmentId, override|null)`
- `voidTrimbleCapturesForSegment(segmentId, reason)` — **scope estricto**: solo anula capturas cuyo `runId === activeRunId` y, si `activeTrimbleRecordingId != null`, también `recordingSessionId === activeTrimbleRecordingId`. Nunca toca capturas de runs anteriores ni capturas con `qaStatus`.
- `markTrimbleSegmentNoCapturable(segmentId)` — funciona con o sin grabación activa, siempre que haya misión y pasada activas. Si no hay misión/pasada → error claro al usuario.
- `markTrimbleSegmentManuallyCaptured(segmentId)` — misma regla de prerequisitos.

## 2. "Volver a pendiente" (incluye grabación activa)

- Aplica `trimbleRecordingSegmentOverrides[sessionId][segmentId] = 'force_pending'` si hay sesión activa.
- Si existe captura `gps_auto` ya generada (caso intermedio), voidea esa captura **además** de aplicar el override.
- Sin grabación activa: voidea capturas activas del tramo en el run actual (regla §1).
- Efecto inmediato: el tramo deja de verse como `live_covered`/`live_partial`/`live_current`. La capa live consulta los overrides en cada render.
- Evento: `TRIMBLE_SEGMENT_RESET_TO_PENDING` con `voidedCaptureIds`, `recordingSessionId` si aplica.

## 3. "No grabable" durante grabación activa

- Aplica `force_no_capturable`. Visualmente el tramo pasa a `no_capturable` de inmediato.
- Voidea capturas activas del tramo en la run actual (regla §1).
- Crea/actualiza `SegmentCapture` `no_capturable` (`captureSource='operator_override'`, fallback `'manual'` con `fieldNotes` explícito — ver §6).
- `closeTrimbleRecording` no creará `gps_auto` para él (ver §4).

## 4. `closeTrimbleRecording()` respeta overrides

Antes de generar `gps_auto`, filtra `coverage.captured` por overrides de la sesión:

- `force_pending` → no crear gps_auto.
- `force_no_capturable` → no crear gps_auto; asegurar captura `no_capturable` activa (si no existe).
- `force_captured` → forzar captura `capturado_pendiente_proceso` aunque la cobertura no llegue al umbral.
Antes de cualquier creación, voidear las `gps_auto` activas previas del mismo `(segmentId, runId, recordingSessionId)` para evitar duplicados (ver §11).

## 5. Prioridad de decisión (`deriveTrimbleSegmentStatus`)

Estricta de mayor a menor:

```
1. QA gabinete (qaStatus != null en última cerrada NO voided)
2. no_capturable manual activo (no voided)
3. force_pending (override sesión activa)
4. force_captured (override sesión activa)
5. gps_auto activa (no voided)
6. Otras capturas de campo activas (no voided)
7. pendiente
```

## 6. Tipo `SegmentCapture` (`src/types/trimble.ts`)

Añadir:

- `voidedAt?: string | null`
- `voidedReason?: string | null`
- `voidedBy?: 'operator' | 'gabinete' | null`
- Ampliar `captureSource` a `'manual' | 'gps_auto' | 'operator_override'`. Si introducir el nuevo literal complica ramas downstream (Excel, gabinete, schema), fallback: usar `'manual'` con `fieldNotes` exactamente "Marcado manualmente por operador desde overlay Trimble". El plan privilegia `'operator_override'` cuando viable.

## 7. Schema Zod (`campaign-schema.ts`)

- `trimbleCaptureSchema`: añadir `voidedAt/voidedReason/voidedBy` opcionales y ampliar `captureSource` enum si se adopta `'operator_override'`.
- `appStateSchema` con `.default()` para no romper campañas previas:
  - `trimbleOperationalSelectedSegmentId` (default `null`)
  - `trimbleSegmentDirectionOverrides` (default `{}`)
  - `trimbleRecordingSegmentOverrides` (default `{}`)

## 8. Componente nuevo: `TrimbleSelectedSegmentOverlay.tsx`

- Posición: `absolute top-2 left-2 z-30`, ancho compacto, scroll interno.
- Visible si:
  - `acquisitionMode === 'TRIMBLE_LIDAR'`
  - `trimbleOperationalSelectedSegmentId !== null`
  - **NO** modos: edición / merge / creación manual / multiselección (guard explícito).
- Funciona para **cualquier tramo cargado/visible** en modo Trimble, no solo los de la cola.
- Contenido: nombre, companySegmentId, estado derivado, % cobertura live, puntos GPS, distancia/progreso, badge gps_auto/manual/operator_override, aviso paralelo cercano, sentido operativo actual.
- Botones: **Mandar a conductor**, **No grabable**, **Volver a pendiente**, **Capturado pdte. proceso**, **Invertir sentido**, **Deseleccionar**. Si no hay copiloto activo, "Mandar a conductor" muestra CTA de activación (no falla en silencio).

## 9. MapPage / GoogleMapDisplay / MapDisplay

- Click en polilínea en modo Trimble → `setTrimbleOperationalSelected(id)`. **No** pisa selección de edición/multi.
- Halo/borde para el seleccionado (segunda polilínea o `strokeWeight` extra). **El color base no cambia**: sigue siendo live/status/base. Halo = solo marcador de selección operativa.

## 10. Detección de "paralelo cercano"

Helper en `parallel-coverage.ts` (o `live-coverage.ts`): para el seleccionado, marca `hasNearbyParallelCoverage` si otro tramo con `live_covered`/`live_partial` tiene geometría a ≲ ~30 m promedio. Consumido por el overlay.

## 11. Anti‑duplicados

Para `(segmentId, runId, recordingSessionId)` no más de **una** captura activa (no voided). Helpers de creación/actualización:

- Si el operador corrige una `gps_auto`, primero **voidear** la `gps_auto` y después crear/actualizar la manual/operator_override.
- Tests cubren la unicidad.

## 12. Filtrado de voided en lógica derivada

Filtrar `voidedAt != null` en:

- `deriveTrimbleSegmentStatus`
- `buildTrimbleSegmentSummary`
- `buildTrimbleRecordingQueue`
- consumidores de `analyzeTrimbleGpsCoverage`
- `closeTrimbleRecording`
- contadores y vistas de **gabinete** (estado activo).
- exportadores Excel/KML (estado activo).

En **detalle técnico/export** (Excel hoja de capturas, ficha gabinete del tramo) las voided sí aparecen con columnas/campos `VOIDED_AT`, `VOIDED_REASON`, `VOIDED_BY` para trazabilidad.

## 13. Copiloto: envío individual + sentido + activación + fallo

- `sendSingleSegmentToCopilot(segment)`:
  - Calcula `effectiveStart`/`effectiveEnd` según `trimbleSegmentDirectionOverrides[segmentId]`. Si `reversed`: INICIO = último punto geométrico, FIN = primer punto. **Nunca** modifica `coordinates` ni KML.
  - Construye queue de **2 puntos** (`INICIO · {name}`, `FIN · {name}`) y `batchUrl` Google Maps con esos dos puntos.
  - Llama `onCopilotPushQueue`. Si éxito → evento `TRIMBLE_COPILOT_SINGLE_SEGMENT_SENT`.
  - Si error/red caída/sin sesión copiloto activa → **no** marcar como enviado, evento `TRIMBLE_COPILOT_SINGLE_SEGMENT_SEND_FAILED` con `error`, mostrar toast con CTA reintentar.
- Sin sesión de copiloto activa: el botón ofrece activarla (patrón existente). Tras activar, reintenta.

## 14. Override de sentido (no destructivo)

- `toggleTrimbleSegmentDirection(segmentId)` alterna `'normal'`/`'reversed'`.
- No modifica `segment.coordinates` ni geometría KML.
- Afecta sólo a: orden INICIO/FIN al copiloto, etiqueta INICIO/FIN del overlay, navegación operativa Trimble. Reversible.

## 15. Desactivar autoenvío de lote en Trimble (de verdad)

En `TrimbleNavigationPanel` y todo punto de auto‑push:

- Si `acquisitionMode === 'TRIMBLE_LIDAR'`:
  - **No ejecutar** auto‑push para reasons: `two_completed`, `auto_captured`, `order_changed`, `layer_changed`, `optimized`.
  - **No mostrar** CTA principal "Actualizar conductor · 4 tramos".
  - Único flujo principal de copiloto = "Mandar a conductor" del overlay.
  - Envío de lote queda como modo avanzado opcional (manual), nunca automático.
- RST/Garmin: comportamiento intacto.

## 16. Event Log (`persistence/types.ts` `EVENT_TYPES` + Zod enum)

Nuevos:

- `TRIMBLE_COPILOT_SINGLE_SEGMENT_SENT`
- `TRIMBLE_COPILOT_SINGLE_SEGMENT_SEND_FAILED`
- `TRIMBLE_SEGMENT_MANUAL_NO_CAPTURABLE`
- `TRIMBLE_SEGMENT_RESET_TO_PENDING`
- `TRIMBLE_SEGMENT_MANUAL_CAPTURED`
- `TRIMBLE_SEGMENT_DIRECTION_OVERRIDE_SET`
- `TRIMBLE_SEGMENT_OPERATIONAL_SELECTED`
- `TRIMBLE_SEGMENT_OPERATIONAL_DESELECTED`
- `TRIMBLE_SEGMENT_CAPTURE_VOIDED`

## 17. Tests

Mantener:

- `trimble-selected-segment-overlay.test.tsx`
- `trimble-copilot-single-segment.test.tsx`
- `trimble-manual-status-actions.test.ts`
- `trimble-parallel-false-positive.test.ts`
- `trimble-direction-override.test.ts`
- `trimble-rst-garmin-regression.test.tsx`

Añadir:

- `trimble-active-recording-overrides.test.ts` — overrides aplican durante grabación; `closeTrimbleRecording` los respeta; prioridad QA > no_capturable > force_pending > force_captured > gps_auto.
- `trimble-disable-driver-batch-in-trimble.test.tsx` — en Trimble no se ejecuta auto‑push por las 5 reasons; RST/Garmin sí.
- `trimble-selected-overlay-edit-mode-guard.test.tsx` — overlay no aparece en edición/merge/creación manual/multiselección.
- `trimble-force-pending-clears-live.test.ts` — `force_pending` durante grabación activa quita color live (`live_covered`/`live_partial`/`live_current`) en el render inmediato.
- `trimble-force-no-capturable-blocks-gps-auto.test.ts` — `force_no_capturable` se ve inmediatamente como no_capturable y al cerrar no se crea gps_auto; capturas previas quedan voided.
- `trimble-single-segment-reversed-effective-endpoints.test.ts` — envío individual con `reversed` usa final→inicio geométrico y no modifica `coordinates`.
- `trimble-overlay-opens-for-any-loaded-segment.test.tsx` — overlay se abre para un tramo visible aunque no esté en `fullQueue`.
- `trimble-voided-captures-traceability.test.ts` — voided no cuentan como estado activo en gabinete/export, pero aparecen en detalle técnico con `VOIDED_AT`/`VOIDED_REASON`/`VOIDED_BY`.
- `trimble-single-segment-send-failure.test.tsx` — fallo de envío registra `TRIMBLE_COPILOT_SINGLE_SEGMENT_SEND_FAILED`, no marca como enviado, permite reintento.

## 18. Compatibilidad import/export

- Schema con `.default()` para los tres campos nuevos en `AppState`.
- Capturas antiguas sin `voidedAt` → activas por defecto.
- Campañas RST/Garmin antiguas cargan sin tocar Trimble.

## No se toca

RST/Garmin, selección de edición/multi, gabinete (solo se añade visualización de voided en detalle), geometría KML original, motor de cobertura GPS (solo añade filtro voided + helper paralelo + respeto de overrides), capturas `gps_auto` históricas, reglas QA.

## Criterios de aceptación

1. En Trimble el operador puede seleccionar cualquier tramo visible/cargado en el mapa.
2. Aparece overlay arriba‑izquierda con info y acciones.
3. "Mandar a conductor" envía solo INICIO/FIN del seleccionado (2 puntos), no lote de 4.
4. Si no hay copiloto activo, el botón ofrece activarlo en lugar de fallar.
5. Si el envío individual falla, queda registrado `TRIMBLE_COPILOT_SINGLE_SEGMENT_SEND_FAILED`, no se marca como enviado y el operador puede reintentar.
6. En Trimble no se ejecuta ningún auto‑push de lote por las reasons listadas.
7. "Volver a pendiente" durante grabación activa: aplica `force_pending`; el color live desaparece de inmediato; al cerrar no se crea `gps_auto` para ese tramo aunque la cobertura supere umbral.
8. "Volver a pendiente" sobre un tramo con `gps_auto` ya creada voidea esa captura sin tocar QA.
9. "No grabable" durante grabación activa: el tramo se ve inmediatamente como no_capturable y al cerrar no se crea `gps_auto`.
10. "No grabable" y "Capturado pdte. proceso" funcionan con o sin grabación activa siempre que haya misión y pasada activas; sin ellas, error claro.
11. `voidTrimbleCapturesForSegment` solo anula capturas del run/sesión activos; nunca runs anteriores ni QA.
12. Sin duplicados activos para `(segmentId, runId, recordingSessionId)`.
13. "Invertir sentido" cambia el orden enviado al conductor (INICIO=fin geométrico) y la visualización INICIO/FIN; **no** modifica geometría KML; reversible.
14. Halo de selección visible; color de cobertura/estado/base intacto.
15. Overlay nunca aparece en modos edición/merge/creación manual/multiselección.
16. Capturas voided no cuentan como estado activo en gabinete/export, pero aparecen en detalle técnico con `VOIDED_AT`/`VOIDED_REASON`/`VOIDED_BY`.
17. Eventos quedan en Event Log.
18. Campañas antiguas siguen cargando.
19. RST y Garmin no cambian.
20. Caso clave de paralelos: durante grabación activa, motor marca tramo paralelo cubierto, operador pulsa "Volver a pendiente"; al cerrar la grabación ese tramo sigue pendiente y no se crea `gps_auto` para él.
21. `bun test` (Trimble + import/export + RST/Garmin) y `tsc --noEmit` limpios.

## Ejecuta este plan. No quiero otro plan ni una reformulación. Quiero implementación completa sobre el código.

Condiciones obligatorias:

1. Implementa todos los puntos del plan en una sola entrega funcional.

2. Si detectas que algún nombre exacto de archivo, tipo, función o prop no coincide con el código real, adapta la implementación al código existente manteniendo el objetivo funcional.

3. No rompas RST ni Garmin. Todo lo nuevo debe estar protegido por `acquisitionMode === 'TRIMBLE_LIDAR'`.

4. No cambies geometría KML ni `segment.coordinates` al invertir sentido. El override solo afecta al envío operativo INICIO/FIN al conductor y a la UI Trimble.

5. No vuelvas a implementar autoenvío de lotes de 4 en Trimble. En modo Trimble el flujo principal de copiloto es exclusivamente por tramo seleccionado desde el overlay.

6. El overlay operativo Trimble debe ser selección operativa independiente de edición/multiselección. No debe pisar `selectedSegmentIds` ni lógica de edición existente.

7. El overlay debe abrirse al hacer click en cualquier tramo visible/cargado del mapa en modo Trimble, aunque ese tramo no esté en la cola pendiente.

8. El botón “Mandar a conductor” debe enviar solo dos paradas: INICIO y FIN del tramo seleccionado. Si el sentido está invertido, INICIO debe ser el final geométrico y FIN el inicio geométrico.

9. Si no hay sesión copiloto activa, el botón debe ofrecer activar copiloto y después enviar el tramo; no debe fallar en silencio.

10. Las capturas `voidedAt != null` no cuentan como estado activo en ningún cálculo, pero sí deben conservarse para trazabilidad.

11. QA de gabinete nunca se modifica ni se voidea desde campo.

12. “Volver a pendiente” durante grabación activa debe tener efecto visual inmediato: el tramo no puede seguir pintándose como cubierto en vivo.

13. “No grabable” durante grabación activa debe tener efecto visual inmediato y bloquear la creación de `gps_auto` al cerrar.

14. “Capturado pdte. proceso” debe permitir corrección manual/operator override sin duplicar capturas activas.

15. Debe existir como máximo una captura activa no voided por `(segmentId, runId, recordingSessionId)`.

16. Las campañas antiguas deben seguir cargando: añade defaults Zod y defaults de estado para todos los campos nuevos.

17. Añade los eventos nuevos al `EVENT_TYPES` y asegúrate de que el enum Zod queda alineado.

18. Añade todos los tests indicados en el plan, incluidos los de guard de edición, envío individual, sentido invertido, force_pending, force_no_capturable, voided y no regresión RST/Garmin.

19. Ejecuta verificación final:

   - `npx tsc --noEmit`

   - tests Trimble

   - tests import/export legacy

   - tests Excel en aislamiento

   - tests RST/Garmin afectados

20. Si aparece un fallo por timeout flaky conocido de Excel, vuelve a ejecutar ese test en aislamiento y repórtalo claramente. No lo confundas con fallo funcional de Trimble.

Entrega esperada:

- Lista de archivos creados/editados.

- Resumen corto de comportamiento implementado.

- Resultado de typecheck.

- Resultado de tests.

- Confirmación explícita de que:

  - RST/Garmin no cambian.

  - Trimble ya no autoenvía lotes de 4.

  - El overlay manda solo el tramo seleccionado.

  - “Volver a pendiente” bloquea gps_auto al cerrar grabación.

  - Invertir sentido no modifica la geometría.

  - Campañas antiguas siguen cargando.