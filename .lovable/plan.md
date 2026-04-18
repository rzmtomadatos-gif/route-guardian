

# Corrección final — Persistencia de tracks consumidos vacíos

## 1. Diagnóstico del caso

`getMaxTrack` calcula el máximo `trackNumber` mirando segmentos del día con track asignado y `trackHistory`. Si un track se abre y se cierra **sin asociar ningún tramo**, no deja huella en `route.segments`. Tras `closeBlockEndPrompt` (que pone `trackSession: null`) y un nuevo `prepareNavigationStart`, el cálculo devolvería el mismo número → **Track 1 reaparece**.

`blockEndPrompt.trackNumber` ya se usaba como guardia parcial, pero se limpia al cerrar el prompt. No persiste hasta el siguiente inicio.

## 2. Fuente de verdad nueva: `lastConsumedTrackByDay`

Añadir al `AppState`:

```typescript
lastConsumedTrackByDay: Record<number, number>;
// Ej: { 1: 3, 2: 1 } → día 1 ha consumido hasta Track 3, día 2 hasta Track 1
```

Persiste en SQLite igual que el resto del estado. Se inicializa `{}`.

### Reglas de actualización

| Función | Acción sobre `lastConsumedTrackByDay` |
|---|---|
| `confirmNavigationStart` | Al abrir Track Y en día X: `lastConsumedTrackByDay[X] = max(actual, Y)` |
| `confirmStopNavigation` | No toca (ya se actualizó al abrir) |
| `completeSegment` (cierre por capacidad) | No toca (ya se actualizó al abrir) |
| `closeBlockEndPrompt` | No toca (debe persistir) |
| Cambio de día (workDay → N+1) | No toca el día anterior (queda como histórico) |
| Invalidación crítica que cierra track | No toca (ya se actualizó al abrir) |

**Clave**: el contador se incrementa al **abrir** el track, no al cerrarlo. Así, aunque el track se cierre vacío inmediatamente, el número ya quedó consumido.

## 3. Cálculo del siguiente track

`prepareNavigationStart` y la revalidación atómica de `confirmNavigationStart` usarán:

```typescript
const nextTrack = Math.max(
  getMaxTrack(s.route.segments, s.trackSession, s.workDay),
  s.blockEndPrompt.trackNumber ?? 0,
  s.lastConsumedTrackByDay[s.workDay] ?? 0
) + 1;
```

Triple guardia:
- `getMaxTrack`: tracks con tramos completados
- `blockEndPrompt.trackNumber`: track recién cerrado pendiente de confirmar prompt
- `lastConsumedTrackByDay[workDay]`: tracks abiertos del día (incluso vacíos cerrados)

## 4. Impacto por función

| Función | Cambio |
|---|---|
| `prepareNavigationStart` | Usa la fórmula triple-Math.max |
| `confirmNavigationStart` | Misma fórmula en revalidación + escribe `lastConsumedTrackByDay[workDay] = expectedTrackNumber` al mutar |
| `confirmStopNavigation` | Sin cambios (la marca ya existe desde la apertura) |
| `closeBlockEndPrompt` | Sin cambios sobre `lastConsumedTrackByDay` (debe persistir) |
| `getDefaultState` | Añadir `lastConsumedTrackByDay: {}` |
| `campaign-schema.ts` | Añadir campo opcional al schema Zod (default `{}` si falta, para compatibilidad con campañas antiguas) |

## 5. Garantía contra Track 1 fantasma

Tras el flujo del caso problema:
1. Abrir Track 1 → `lastConsumedTrackByDay = { 1: 1 }`
2. Cerrar manual → estado persiste
3. `closeBlockEndPrompt` → `trackSession: null`, `blockEndPrompt` limpio, **`lastConsumedTrackByDay = { 1: 1 }` intacto**
4. Nuevo `prepareNavigationStart` → `Math.max(0, 0, 1) + 1 = 2` ✅

## 6. Riesgos

| Riesgo | Mitigación |
|---|---|
| Campañas antiguas sin el campo | Schema Zod con default `{}` + migración silenciosa al cargar |
| Cambio de día retrocede contador | El registro es por día (`Record<number, number>`), días distintos son independientes |
| Reset manual de día (workDay decrementa) | Fuera del modelo actual (workday es secuencial); no aplica |
| Importar campaña exportada con contador | Se respeta el estado importado tal cual |
| Race entre apertura y cierre rápido | La escritura ocurre dentro del mismo `setState` que abre el track: atómica |

## 7. Plan de pruebas

**Prueba obligatoria del usuario**:
1. Iniciar navegación → confirmar Track 1
2. No iniciar ningún tramo
3. Detener navegación → confirmar cierre
4. Cerrar `blockEndPrompt`
5. Iniciar navegación → diálogo debe mostrar **Track 2** ✅

**Pruebas adicionales**:
- Track 1 abierto + 3 tramos completados + manual stop → próximo = Track 2 (ya funcionaba, sigue funcionando)
- Día 1 con Track 5 consumido → cambiar a Día 2 → primer inicio Día 2 ofrece Track 1 (independencia por día)
- Abrir/cerrar Track 1 vacío 3 veces seguidas → contador llega a Track 4
- Importar campaña antigua sin `lastConsumedTrackByDay` → no rompe, se inicializa `{}` y `getMaxTrack` cubre los tracks ya completados
- Cierre por capacidad en Track 2 → próximo Track 3 (ya funcionaba vía `getMaxTrack`, ahora doblemente blindado)

## 8. Archivos a tocar (añadidos al plan previo)

| Archivo | Cambio adicional |
|---|---|
| `src/types/route.ts` | +`lastConsumedTrackByDay: Record<number, number>` en `AppState` |
| `src/utils/storage.ts` | `getDefaultState`: añadir `lastConsumedTrackByDay: {}` |
| `src/utils/persistence/campaign-schema.ts` | Campo Zod opcional con default `{}` |
| `src/hooks/useRouteState.ts` | Fórmula triple-Math.max en preview y revalidación; escritura en `confirmNavigationStart` |

