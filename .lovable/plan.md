# Plan técnico — Confirmación explícita de inicio y final de track

## Para entender sin ser informático

Actualmente el operario no ve claramente cuándo empieza o termina un track (archivo de vídeo). El cambio añade avisos visibles: un mensaje flotante al iniciar cada track indicando "Día X · Track Y iniciado", y en el diálogo de cierre se especifica claramente qué track se acaba de terminar y cuál es el siguiente a preparar.

---

## Cambios propuestos

### 1. Confirmación al abrir track — Toast informativo

**Dónde**: `src/hooks/useRouteState.ts`, justo después de crear una nueva `trackSession` (líneas 415-426).

**Qué se añade**: 
- Importar `toast` de 'sonner'
- Mostrar toast con duración extendida (6-8 segundos) cuando se detecta que se acaba de crear un nuevo track (primer tramo del track)

**Texto**: `"Día {workDay} · Track {trackNumber} iniciado"`

**Duración**: 8000ms (suficiente para que el operario lo lea sin bloquear la operación)

### 2. Confirmación al cerrar track — Enriquecer EndOfVideoDialog

**Dónde**: 
- `src/components/EndOfVideoDialog.tsx` — añadir prop `workDay` y mostrar contexto
- `src/components/MapControlPanel.tsx` — pasar `workDay` al componente

**Cambios en EndOfVideoDialog**:
- Añadir `workDay: number` a la interfaz Props
- Modificar el título para mostrar: `"Finalizado Día {workDay} · Track {trackNumber}"`
- Modificar el subtítulo para mostrar: `"Prepara nuevo archivo para Día {workDay} · Track {trackNumber + 1}"`

### 3. Garantía anti-silencio

Con estos cambios, todo cambio de track queda cubierto:

| Evento | Mecanismo | Visible al operario |
|---|---|---|
| Primer tramo de un track nuevo | Toast informativo (6-8s) | "Día 2 · Track 1 iniciado" |
| Cierre automático por capacidad | EndOfVideoDialog | "Finalizado Día 2 · Track 3 / Prepara Track 4" |
| Cierre manual del operario | EndOfVideoDialog | Mismo que arriba |
| Cambio de día | Ya existente (WorkDayChangeDialog) | Resetea a Track 1 |

---

## Archivos a tocar

| Archivo | Cambio |
|---|---|
| `src/hooks/useRouteState.ts` | Importar toast, mostrar toast al crear nueva trackSession |
| `src/components/EndOfVideoDialog.tsx` | Añadir prop `workDay`, mostrar día/track finalizado y siguiente |
| `src/components/MapControlPanel.tsx` | Pasar prop `workDay` a EndOfVideoDialog |

---

## Código exacto de los cambios

### useRouteState.ts (línea 1-7 y 415-426)

**Importación:**
```typescript
import { toast } from 'sonner';
```

**Toast al abrir track (dentro de confirmStartSegment, después del logEvent TRACK_OPENED):**
```typescript
// Show toast notification for track start
if (current.trackSession && current.trackSession.segmentIds.length === 1) {
  toast(`Día ${current.workDay} · Track ${current.trackSession.trackNumber} iniciado`, {
    duration: 8000,
    position: 'top-center',
  });
}
```

### EndOfVideoDialog.tsx

**Interface Props (línea 13-19):**
```typescript
interface Props {
  open: boolean;
  trackNumber: number;
  workDay: number;
  rstGroupSize?: number;
  onContinue: () => void;
}
```

**Título y subtítulo (línea 71-76):**
```typescript
<AlertDialogTitle className="text-base leading-tight">
  Finalizado Día {workDay} · Track {trackNumber}
</AlertDialogTitle>
<p className="text-sm text-muted-foreground mt-0.5">
  Prepara nuevo archivo para Día {workDay} · Track {trackNumber + 1}
</p>
```

### MapControlPanel.tsx (línea 745-751)

```typescript
<EndOfVideoDialog
  open={!!videoEndBlocking}
  trackNumber={trackSession?.trackNumber ?? 0}
  workDay={workDay}
  rstGroupSize={rstGroupSize}
  onContinue={() => onVideoEndContinue?.()}
/>
```

---

## Pruebas

1. Iniciar primer tramo del día → aparece toast "Día 1 · Track 1 iniciado" visible durante 8 segundos
2. Completar hasta capacidad → EndOfVideoDialog muestra "Finalizado Día 1 · Track 1" + "Prepara Track 2"
3. Confirmar → iniciar siguiente tramo → toast "Día 1 · Track 2 iniciado"
4. Cierre manual de track → EndOfVideoDialog muestra día/track correctos y el siguiente a preparar
5. Cambiar día → iniciar tramo → toast "Día 2 · Track 1 iniciado"
6. Verificar que en ningún caso el cambio de track es silencioso

---

## Garantías

- Toast no bloqueante: el operario puede ignorarlo si está concentrado en la conducción
- Duración suficiente: 8 segundos permiten leer mientras se prepara la salida
- Posición no obstructiva: top-center no tapa el mapa de navegación
- Sin duplicación: no se muestra toast si el track ya estaba abierto (solo al crear nuevo trackSession)