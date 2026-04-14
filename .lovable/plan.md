

# Plan de trazabilidad operativa — IMPLEMENTADO

## Estado: Fases A, B y C completadas

### Fase A — Capacidad correcta + botón reubicado ✅
- `allocateTrackNumber`: cuenta solo `completado` para capacidad
- `confirmStartSegment`: cierre de sesión solo por completados
- `countSegmentsInTrack`: filtra solo `completado`
- `segmentOrder`: provisional, cuenta solo completados (reconsolidación pendiente en `completeSegment`)
- Indicador UI: muestra completados/capacity
- Botón "Cancelar inicio": eliminado de NavigationOverlay, añadido en MapControlPanel
- `canCancelStart` calculado en MapPage y propagado como prop

### Fase B — Exportación limpia ✅
- `trackOrderMap` filtra solo `completado`
- Columnas DIA/TRACK/TOP vacías para estados != completado

### Fase C — Texto EndOfVideoDialog ✅
- Paso 2 actualizado: "Preparar el siguiente archivo de grabación"

### Pendiente
- Reconsolidación definitiva de `segmentOrder` en `completeSegment` (fase futura)
