

# Diagnóstico y plan: Lógica navegación, track y estados de tramo

---

## 1. Diagnóstico técnico — Por qué ocurre cada problema

### 1.1 Un tramo se puede iniciar sin navegación activa

`confirmStartSegment` (línea 160) solo comprueba dos cosas:
- que exista ruta
- que `blockEndPrompt` no esté abierto

**No comprueba `navigationActive`**. Cualquier botón que llame a `onStartSegment` funciona aunque la navegación esté apagada.

### 1.2 No existe salida limpia para un inicio erróneo

Una vez llamado `confirmStartSegment`, el tramo pasa a `en_progreso`, se le asigna `trackNumber`, `workDay`, `segmentOrder` y se registra en `trackSession.segmentIds`. Las únicas salidas son:
- `completeSegment` → lo marca como completado (falso)
- `addIncident` con impacto crítico → genera incidencia ficticia
- `resetSegment` → limpia el tramo pero **no toca `trackSession`**, dejando la sesión con un segmentId fantasma

No hay función `cancelStartSegment`.

### 1.3 Incoherencias entre `navigationActive`, `trackSession` y `en_progreso`

- `stopNavigation` (línea 115) pone `navigationActive: false` y `activeSegmentId: null`, pero **no cierra el `trackSession`** ni revierte segmentos `en_progreso`. Resultado: puede quedar un track abierto con segmentos "en progreso" sin navegación.
- `resetSegment` (línea 699) limpia todos los campos del segmento pero **no elimina el segmentId de `trackSession.segmentIds`**. El track cree que tiene un segmento que ya no existe.

### 1.4 Reapertura con estado persistido

`restoreState` (línea 1167) hace `setStateRaw(restored)` sin ningún saneamiento. Si la app se cerró con `navigationActive: true`, al reabrir se reanuda la navegación automáticamente con un estado potencialmente corrupto (posición GPS diferente, track a medias, tramo en progreso sin contexto).

### 1.5 Track number tras cierre de bloque

`closeBlockEndPrompt` (línea 733) ya pre-crea una sesión inactiva con `T{N+1}`. Pero `confirmStartSegment` (línea 183-201) verifica `trackSession.active` para decidir si reusar o crear nueva sesión. Si la sesión pre-creada es inactiva, **la ignora y crea otra**, causando que el número calculado en `closeBlockEndPrompt` se desperdicie y salte al N+2.

---

## 2. Reglas operativas objetivo

| Regla | Descripción |
|-------|-------------|
| **R1** | Un tramo no puede iniciarse si `navigationActive === false` |
| **R2** | No puede existir `trackSession.active === true` si `navigationActive === false` |
| **R3** | Al abrir la app, `navigationActive` siempre es `false`. Si había tracks o tramos en progreso, se muestra aviso de recuperación |
| **R4** | `en_progreso` solo es válido mientras la navegación está activa. Al detener navegación, los tramos `en_progreso` deben resolverse |
| **R5** | Debe existir una acción "Cancelar inicio" que revierta limpiamente un tramo iniciado por error |
| **R6** | `resetSegment` debe limpiar también su presencia en `trackSession` |
| **R7** | El número de track post-cierre de bloque debe ser visible inmediatamente y respetado por `confirmStartSegment` |

---

## 3. Propuesta funcional: "Cancelar inicio de tramo"

### Cuándo puede usarse
- Solo cuando el tramo activo tiene `status === 'en_progreso'`
- Solo mientras la navegación está activa
- No disponible si el tramo ya tiene F5 de fin confirmado

### Qué limpia en el segmento
- `status` → `'pendiente'`
- `trackNumber` → `null` (se mueve a `trackHistory` si tenía valor)
- `segmentOrder` → `undefined`
- `workDay` → se mantiene (dato informativo)
- `startedAt`, `timestampInicio` → `null`/`undefined`
- `segmentStartSeconds` → `null`

### Cómo afecta a `trackSession`
- Elimina el `segmentId` de `trackSession.segmentIds`
- Si era el único segmento del track, cierra la sesión con `closedManually: true` (track vacío = no existió)
- Si había otros segmentos en el track, la sesión sigue abierta con capacidad recuperada

### Cómo afecta a `trackNumber` / `segmentOrder`
- El número de track del segmento cancelado se libera. Si era el único del track, el track completo desaparece y el siguiente usará ese mismo número
- Los `segmentOrder` de otros segmentos del mismo track no cambian (no se renumeran — eso sería destructivo)

### Garmin / RST
- RST: si el tramo cancelado tenía `plannedTrackNumber` pre-asignados en hermanos, se limpian también
- Garmin: `segmentStartSeconds` se limpia. El track físico de la cámara sigue corriendo (eso es externo), pero VialRoute no cuenta ese segmento

### Trazabilidad
- Se registra un evento `SEGMENT_CANCELLED` en el eventLog con `segmentId`, `trackNumber` y `reason: 'operator_cancel'`
- No genera incidencia
- No cuenta como intento de grabación (`repeatNumber` no incrementa)

---

## 4. Propuesta para reapertura de app

Al restaurar estado desde SQLite:

1. **Forzar `navigationActive: false`** siempre
2. **Detectar tramos `en_progreso`** en el estado restaurado
3. Si los hay, mostrar un diálogo de recuperación con opciones:
   - "Restaurar y continuar" → el operador puede decidir tramo a tramo
   - "Cancelar tramos en progreso" → los revierte a `pendiente`
4. **Cerrar `trackSession.active`** si estaba abierto — se re-abrirá al iniciar navegación si procede
5. Registrar evento `NAV_STATE_CHANGED` con payload `{ recovery: true }`

Esto garantiza que la app nunca arranca "navegando" sin contexto GPS real.

---

## 5. Propuesta para cierre de bloque / siguiente track

El problema actual: `closeBlockEndPrompt` crea sesión inactiva con `T{N+1}`, pero `confirmStartSegment` la ignora (solo reutiliza sesiones **activas**).

**Corrección**: en `confirmStartSegment`, cuando detecta una sesión **inactiva** con `segmentIds` vacío y `trackNumber` ya calculado, debe **activarla** en vez de crear una nueva. Cambio en líneas 186-201:

```text
if (!trackSession || !trackSession.active) {
  // Si hay sesión pre-creada (de closeBlockEndPrompt), activarla
  if (trackSession && !trackSession.active && trackSession.segmentIds.length === 0) {
    trackSession = { ...trackSession, active: true, startedAt: now, endedAt: null, segmentIds: [segmentId] };
  } else {
    trackSession = { active: true, trackNumber: nextTrack, ... };
  }
}
```

---

## 6. Riesgos a vigilar

| Riesgo | Causa | Mitigación |
|--------|-------|------------|
| Salto de numeración | `cancelStartSegment` libera track que luego no se reutiliza | Si era el único segmento del track, hacer que `getMaxTrack` no cuente tracks vacíos |
| Duplicación de track | Sesión pre-creada ignorada por `confirmStartSegment` | Test explícito: pre-created session → must be activated |
| Falsos `en_progreso` tras reapertura | Estado restaurado sin sanitizar | Sanitización en `restoreState` obligatoria |
| `trackSession` con segmentId fantasma | `resetSegment` no limpia la sesión | Incluir limpieza de `trackSession` en `resetSegment` |
| Rotura de exportación | Nuevo evento `SEGMENT_CANCELLED` no reconocido por schema | Añadir al enum `eventTypeEnum` en `campaign-schema.ts` |
| Pérdida de trazabilidad | Cancel sin registrar en eventLog | Evento obligatorio en cancelación |

---

## 7. Orden de implementación

### Fase 1 — Protecciones inmediatas (sin cambiar UI)
1. **Guard en `confirmStartSegment`**: rechazar si `!s.navigationActive` → 1 línea
2. **Sanitización en `restoreState`**: forzar `navigationActive: false`, cerrar `trackSession.active` → ~10 líneas
3. **Fix `resetSegment`**: limpiar `segmentId` de `trackSession.segmentIds` → ~5 líneas
4. **Fix `confirmStartSegment`**: detectar sesión pre-creada y activarla → ~8 líneas

### Fase 2 — Cancelar inicio + recuperación
5. **Nueva función `cancelStartSegment`** en `useRouteState.ts` → ~40 líneas
6. **Botón "Cancelar inicio"** en `NavigationOverlay.tsx` cuando estado es `en_progreso` e `idle`/`approaching` → ~10 líneas UI
7. **Evento `SEGMENT_CANCELLED`** en `eventTypeEnum` (schema + types) → 2 líneas
8. **Diálogo de recuperación** al detectar tramos `en_progreso` tras restaurar estado → nuevo componente simple

### Fase 3 — No tocar todavía
- Refactorizar `stopNavigation` para resolver tramos en progreso automáticamente (requiere más análisis de impacto en flujo Garmin)
- Acoplamiento estricto track ↔ navegación (puede afectar al modo GARMIN donde el track físico es externo)

### Archivos afectados (Fases 1-2)
| Archivo | Cambios |
|---------|---------|
| `src/hooks/useRouteState.ts` | Guard en `confirmStartSegment`, sanitización en `restoreState`, fix `resetSegment`, nueva `cancelStartSegment`, fix sesión pre-creada |
| `src/components/NavigationOverlay.tsx` | Botón "Cancelar inicio" |
| `src/utils/persistence/campaign-schema.ts` | Nuevo evento `SEGMENT_CANCELLED` en enum |
| `src/types/route.ts` | (si se añade al tipo F5Event o similar — probablemente no necesario) |
| Nuevo: `src/components/RecoveryDialog.tsx` | Diálogo de recuperación al abrir con estado inconsistente |
| `src/App.tsx` | Mostrar `RecoveryDialog` tras `restoreState` si hay tramos en progreso |

### Qué NO se toca
- Persistencia SQLite / import-export de campañas
- Lógica de incidencias
- Lógica de F5/F7/F9
- Copiloto
- Auth / AuthGuard
- Modo RST completo (solo se protege el inicio)

