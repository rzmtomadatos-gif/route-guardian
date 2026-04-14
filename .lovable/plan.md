
# Implementación — Confirmación explícita de inicio y final de track

## Cambios exactos

### 1. `src/hooks/useRouteState.ts`
- **Línea 1**: Añadir `import { toast } from 'sonner';`
- **Líneas 417-426**: Después del `logEvent('TRACK_OPENED', ...)`, añadir toast:
```typescript
toast(`Día ${current.workDay} · Track ${current.trackSession.trackNumber} iniciado`, {
  duration: 8000,
  position: 'top-center',
});
```

### 2. `src/components/EndOfVideoDialog.tsx`
- **Props**: Añadir `workDay: number` a la interfaz
- **Línea 43**: Desestructurar `workDay` en la firma del componente
- **Líneas 71-74**: Cambiar título y subtítulo:
  - Título: `Finalizado Día {workDay} · Track {trackNumber}`
  - Subtítulo: `Prepara nuevo archivo para Día {workDay} · Track {trackNumber + 1}`

### 3. `src/components/MapControlPanel.tsx`
- **Línea 748**: Añadir prop `workDay={workDay}` al `<EndOfVideoDialog>`

## Archivos tocados
| Archivo | Cambio |
|---|---|
| `src/hooks/useRouteState.ts` | Import sonner + toast tras TRACK_OPENED |
| `src/components/EndOfVideoDialog.tsx` | Prop workDay + título/subtítulo con día/track |
| `src/components/MapControlPanel.tsx` | Pasar workDay a EndOfVideoDialog |

Tres ediciones pequeñas, sin riesgo de regresión.
