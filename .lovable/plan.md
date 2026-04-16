
# Plan — Completado

Todos los planes anteriores han sido implementados:
- ✅ `reason: 'invalidated'` en `BlockEndPrompt`
- ✅ Blindaje `Math.max(getMaxTrack(...), blockEndPrompt.trackNumber ?? 0) + 1` en `closeBlockEndPrompt`
- ✅ `navigationActive: false` + `activeSegmentId: null` en los 3 cierres de track
- ✅ Emisión de `NAV_STOPPED` fuera del updater con reasons diferenciados
- ✅ `TRACK_CLOSED` emitido fuera del updater en `addIncident` (patrón `setStateRaw`)
- ✅ Texto diferenciado en `EndOfVideoDialog` para invalidación
- ✅ Schema Zod actualizado con `reason: 'invalidated'`
