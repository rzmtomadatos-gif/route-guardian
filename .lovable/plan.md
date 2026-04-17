

# Plan — Confirmación obligatoria al detener navegación con track activo

## 1. Diagnóstico del flujo actual

`StopNavigationDialog` existe ya (`src/components/StopNavigationDialog.tsx`) pero solo se muestra cuando hay tramos `en_progreso`. Props actuales:
- `open`, `inProgressCount`, `onCancelAndStop`, `onGoBack`

El plan anterior hacía que `stopNavigation` cerrase track inmediatamente. Eso permite cierre accidental por pulsación errónea del botón "Detener navegación".

## 2. Decisión: reutilizar y ampliar `StopNavigationDialog`

Se amplía el diálogo existente, no se crea uno nuevo. Nuevas props:
- `workDay: number`
- `trackNumber: number | null` — null si no hay track activo
- `inProgressCount: number` — sigue existiendo

Texto adaptativo según contexto:

| Caso | Título / cuerpo |
|---|---|
| Track activo, sin tramo en progreso | "Se va a cerrar **Día X · Track Y**" |
| Track activo + tramo en progreso | "Se cancelarán los inicios en progreso y se cerrará **Día X · Track Y**" |
| Sin track activo + tramo en progreso (residual) | Texto actual sobre cancelación de inicios |

Botones: "Volver a navegación" / "Confirmar y detener".

## 3. Separación en dos funciones del hook

Para evitar cierre accidental, se rompe el flujo en preview + ejecución, equivalente al patrón de `prepareNavigationStart` / `confirmNavigationStart`:

### 3a. `prepareStopNavigation()` — no muta

Devuelve:
```typescript
{
  needsConfirmation: boolean;  // true si hay track activo o tramo en progreso
  workDay: number;
  trackNumber: number | null;
  inProgressCount: number;
}
```

### 3b. `confirmStopNavigation()` — ejecución real

Solo se llama tras confirmación. Realiza el cierre completo (lógica que estaba propuesta en el plan anterior para `stopNavigation`).

### 3c. `stopNavigation()` legacy

Se mantiene como wrapper que internamente:
- llama `prepareStopNavigation`
- si `needsConfirmation === false` → llama directo a `confirmStopNavigation`
- si `needsConfirmation === true` → no hace nada, MapPage gestiona el diálogo

Esto protege llamadas internas que no pasan por UI (si las hay).

## 4. Flujo exacto por caso

### Caso 1: nav activa + track activo + sin tramo en progreso
1. Operador pulsa "Detener navegación"
2. MapPage llama `prepareStopNavigation()` → `{ needsConfirmation: true, trackNumber: Y, inProgressCount: 0 }`
3. MapPage abre `StopNavigationDialog` con texto "Se va a cerrar Día X · Track Y"
4. Si **cancela** → cierra diálogo, nada cambia, **cero eventos emitidos**
5. Si **confirma** → MapPage llama `confirmStopNavigation()`:
   - `navigationActive: false`
   - `activeSegmentId: null`
   - `trackSession`: cerrada (`active: false`, `endedAt`, `closedManually: true`)
   - `blockEndPrompt: { isOpen: true, trackNumber: Y, reason: 'manual' }`
   - Vía `setStateRaw`: emite `TRACK_CLOSED` (reason: `manual_via_stop_navigation`) + `NAV_STOPPED` (reason: `track_closed_manual`)

### Caso 2: nav activa + track activo + tramo en progreso
1. Pulsar "Detener navegación"
2. `prepareStopNavigation()` → `{ needsConfirmation: true, trackNumber: Y, inProgressCount: N }`
3. Diálogo muestra: "Se cancelarán {N} inicio(s) en progreso y se cerrará Día X · Track Y"
4. Cancelar → nada cambia
5. Confirmar → `confirmStopNavigation()`:
   - Revierte tramos `en_progreso` → `pendiente`
   - Cierra track, navegación OFF, prompt abierto
   - Emite `TRACK_CLOSED` + `NAV_STOPPED`

### Caso 3: nav activa sin track activo
1. Pulsar "Detener navegación"
2. `prepareStopNavigation()` → `{ needsConfirmation: false, trackNumber: null, inProgressCount: 0 }`
3. MapPage llama directamente `confirmStopNavigation()` sin diálogo
4. Solo: `navigationActive: false`, `activeSegmentId: null`, emite `NAV_STOPPED` (reason: `manual`)
5. **No** se emite `TRACK_CLOSED` (no hay track que cerrar)
6. **No** se abre `blockEndPrompt`

Este es el único caso sin confirmación, por coherencia: no hay nada destructivo que confirmar.

## 5. Punto exacto de emisión de eventos

Todos los eventos van **dentro de `confirmStopNavigation`**, vía `setStateRaw` después del `setState`:

```typescript
setStateRaw((current) => {
  if (trackToClose !== null) {
    logEvent('TRACK_CLOSED', {
      workDay: current.workDay,
      trackNumber: trackToClose,
      payload: { reason: 'manual_via_stop_navigation' }
    });
  }
  logEvent('NAV_STOPPED', {
    payload: {
      reason: trackToClose !== null ? 'track_closed_manual' : 'manual',
      trackNumber: trackToClose ?? undefined
    }
  });
  return current;
});
```

Garantía: hasta que `confirmStopNavigation` no se invoca, **cero efectos**: cero mutaciones, cero eventos, cero `blockEndPrompt`.

## 6. Garantía contra pulsación accidental

| Capa | Protección |
|---|---|
| Hook | `prepareStopNavigation` es no mutante; `confirmStopNavigation` solo se llama explícitamente desde MapPage tras confirmación |
| UI | Diálogo modal sin cierre por overlay; dos botones explícitos |
| Texto | Muestra Día y Track concretos para que el operador vea qué va a cerrar |
| Estado | Si el operador pulsa accidentalmente y luego cancela: estado idéntico al anterior, ningún log |

## 7. Archivos a tocar

| Archivo | Cambio |
|---|---|
| `src/hooks/useRouteState.ts` | +`prepareStopNavigation`, +`confirmStopNavigation`, modificar `stopNavigation` como wrapper |
| `src/components/StopNavigationDialog.tsx` | Ampliar props (`workDay`, `trackNumber`); texto adaptativo |
| `src/pages/MapPage.tsx` | Estado del diálogo unificado: en lugar de mostrar diálogo solo si hay tramos en progreso, mostrarlo si `needsConfirmation === true` |

## 8. Plan de pruebas

**Caso 1 cancelar**: nav activa, track 1 abierto, sin tramos. Pulsar Detener → diálogo "Día 1 · Track 1". Cancelar → estado idéntico, log sin entradas nuevas.

**Caso 1 confirmar**: igual setup. Confirmar → nav OFF, `activeSegmentId === null`, track cerrado, prompt abierto, log tiene `TRACK_CLOSED` + `NAV_STOPPED`.

**Caso 2 cancelar**: nav activa, tramo en progreso. Pulsar Detener → diálogo menciona inicios e Día/Track. Cancelar → tramo sigue en progreso, track sigue abierto, sin eventos.

**Caso 2 confirmar**: igual. Confirmar → tramo revertido a pendiente, track cerrado, prompt abierto, eventos emitidos.

**Caso 3 (sin track)**: estado anómalo de nav activa sin trackSession. Pulsar Detener → no hay diálogo, nav OFF directa, solo `NAV_STOPPED` (sin `TRACK_CLOSED`).

**Pulsación accidental**: pulsar Detener varias veces seguidas → diálogo aparece una vez. Cerrar sin confirmar → cero cambios, cero eventos.

**Coherencia post-cierre**: tras Caso 1/2 confirmado, confirmar prompt → `trackSession: null`. Próximo `prepareNavigationStart` ofrece Track Y+1.

