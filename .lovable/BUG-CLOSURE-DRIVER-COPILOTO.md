# Cierre formal — Bloque Driver/Copiloto

**Fecha de cierre:** 2025-05-24
**Entorno:** Preview operativo (pruebas reales en campo)
**Estado del bloque:** CERRADO. No se reabre salvo nueva reproducción confirmada.
**Próxima fase autorizada:** Desde este estado cerrado únicamente.

---

## Causa raíz principal

El constraint `copilot_session_events_event_type_check` no incluía `OPERATOR_BATCH_SENT`, aunque las RPCs `operator_send_batch` y `operator_update_session` lo emitían. Esto abortaba la transacción completa y enmascaraba problemas de sincronización Driver/Copiloto.

Tras corregir el constraint (migración `20260520213629_7b203067-afba-436d-be3a-ea5e60997456.sql`), el flujo Driver/Copiloto quedó operativo.

---

## Bugs cerrados

| ID | Estado | Descripción | Corrección aplicada | Evidencia de smoke test |
|----|--------|-------------|---------------------|------------------------|
| BUG-DRIVER-EVENT-001 | Cerrado | `OPERATOR_BATCH_SENT` bloqueado por constraint | Migración PostgreSQL que añade `OPERATOR_BATCH_SENT` al CHECK constraint | `operator_send_batch` ya no aborta; evento se registra correctamente |
| BUG-DRIVER-SYNC-001 | Cerrado | Lote no llega a Driver o no se actualiza | Eliminación del aborto por constraint; `batch_number` como revisión operativa | 1er lote llega a Driver Mini; 2do lote actualiza; Google Maps se abre; `last_route_opened_batch` se actualiza |
| BUG-DRIVER-SEC-002 | Cerrado | Token de sesión expuesto en URL QR | URLs cambiadas a `/driver-mini?p=<nonce>`; eliminado `session=` del QR | URL sin `session=`; sin `undefined`; sin `driver_token` en URL |
| BUG-DRIVER-PAIR-001 | Cerrado | Emparejamiento genérico o fallo de rol | `claim_driver_pairing` devuelve 7 razones distintas; diferenciación de errores | Usuario conductor válido empareja OK; usuario sin rol recibe `role_not_allowed`; claim inválido detectado |
| BUG-COPILOT-START-001 | Cerrado | Inicio de Copiloto bloqueado o estado fantasma | `active=true && session=null` imposible; diagnóstico RPC claro | Operador inicia Copiloto; sesión previa no bloquea; error backend traducible |
| QA-DRIVER-OBS-001 | Validado / Cerrado | Falta de visibilidad de estado en depuración | Paneles DEV en CopilotPanel, DriverPage, DriverMiniPage con prefijos truncados | Diagnóstico útil en campo; tokens/nonce no expuestos completos |

---

## Flujo validado en entorno real

1. Operador inicia Copiloto.
2. Operador genera QR seguro (`/driver-mini?p=<nonce>`).
3. Conductor escanea QR con usuario autenticado y rol conductor válido.
4. Emparejamiento exitoso; Driver Mini muestra estado actualizado.
5. Operador envía lote de tramos.
6. Driver Mini recibe actualización (cambio de color/estado).
7. Conductor pulsa botón amarillo → abre Google Maps con `noopener,noreferrer`.
8. Se registra apertura de ruta (`driver_mark_route_opened`).
9. Operador envía segundo lote; Driver Mini vuelve a actualizar.
10. Sesión puede finalizarse desde operador; Driver Mini muestra "SESIÓN FINALIZADA".
11. Usuario sin rol recibe error controlado al intentar activar Copiloto o emparejar.

---

## No regresión confirmada

El cierre de este bloque no ha roto:

- Modo RST (F5/F7/F9, TrackSession, NavStarted).
- Modo Garmin/Dacia (cronómetro, sin RST).
- Modo Trimble/LiDAR.
- Copiloto operador (envío de lotes, QR seguro).
- Driver completo y Driver Mini.
- Supabase RPCs (sin uso de RPCs legacy).
- Event log local (SQLite WASM).
- Seguridad de QR (no exposición de token).
- Sistema de roles operador/conductor.

---

## Notas de no regresión

- **No reactivar el flujo legacy de `session=` en URLs.** Cualquier referencia a `session.token` en el frontend es obsoleta.
- **No eliminar `OPERATOR_BATCH_SENT` del constraint.** Si se añaden nuevos event types, deben incluirse en el CHECK antes de usarlo en RPCs.
- **Mantener `batch_number` como revisión operativa.** El driver confía en este número para detectar lotes nuevos.
- **Conservar paneles DEV en build de desarrollo.** Son necesarios para diagnóstico en campo sin exponer tokens completos.

---

## Archivos modificados durante el cierre

- `supabase/migrations/20260520213629_7b203067-afba-436d-be3a-ea5e60997456.sql` — migración del constraint.
- `src/hooks/useCopilotSession.ts` — eliminación de `session.token` del flujo legacy.
- `src/components/CopilotPanel.tsx` — URLs con `?p=<nonce>`, diagnóstico DEV.
- `src/pages/DriverPage.tsx` / `src/pages/DriverMiniPage.tsx` — flujo `claim_driver_pairing`, `driver_read_session`, `driver_mark_route_opened`.
- `src/pages/AuthPage.tsx` — manejo de `next=` para redirección post-login.
- `src/test/copilot-pairing-flow.test.tsx` — tests del flujo seguro.

---

## Recomendación del siguiente paso

El bloque Driver/Copiloto queda cerrado y operativo. El proyecto puede avanzar a la siguiente fase de forma controlada desde este estado. La siguiente fase sugerida es la continuación del plan Trimble (Fase 1: Tipos + Schema + Eventos) ya documentado en `.lovable/plan.md`, o cualquier otra prioridad operativa que el equipo defina.
