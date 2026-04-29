## Problema

`filterIncidentsForTrack` (en `src/utils/gabinete/track-gps-derived.ts`) acepta una incidencia con solo `trackAtIncident` aunque no haya `workDayAtIncident`. Si en otro día se repite el mismo número de track, esa incidencia "huérfana" aparecerá en el track equivocado.

Además, falta resolver, para incidencias antiguas sin `workDayAtIncident`, el día/track real a través del segmento asociado.

## Solución

### 1. `src/utils/gabinete/track-gps-derived.ts` — refactor `filterIncidentsForTrack`

Nueva firma:

```ts
export function filterIncidentsForTrack(
  incidents: Incident[] | undefined | null,
  day: number,
  track: number,
  segmentsById?: Map<string, Segment> | Segment[],
): Incident[]
```

Reglas en orden:

1. Sin `location` → descartar (igual que ahora; sigue siendo requisito de pintado en mapa).
2. Si `workDayAtIncident` es número → debe ser igual a `day`. Si no, descartar.
3. Si `trackAtIncident` es número → debe ser igual a `track`. Si no, descartar.
4. Si **falta** `workDayAtIncident`:
  - Resolver `seg = segmentsById.get(inc.segmentId)`.
  - Aceptar solo si `seg && seg.workDay === day && seg.trackNumber === track`.
  - Si no hay segmento o no coincide → descartar.
5. Si pasa los filtros previos (tiene `workDayAtIncident` y, opcionalmente, `trackAtIncident` coincidente), aceptar.

Esto elimina el caso actual de "solo `trackAtIncident` coincide → aceptar" sin verificación de día.

Internamente, normalizar `segmentsById` a `Map<string, Segment>` aceptando array o map para comodidad de los call-sites.

### 2. `src/components/gabinete/GpsTrackDetailDialog.tsx`

- En el `useMemo` `trackIncidents`, pasar `segmentsById` (ya construido en el componente) como cuarto argumento de `filterIncidentsForTrack`.
- Añadir `segmentsById` a las dependencias del `useMemo`.

### 3. Tests — `src/test/gabinete-gps-derived.test.ts`

Actualizar/añadir casos en el bloque de `filterIncidentsForTrack`:

- Incidencia con `workDayAtIncident=1, trackAtIncident=1` y `day=1, track=1` → aparece.
- Incidencia con `workDayAtIncident=2, trackAtIncident=1` y `day=1, track=1` → NO aparece (mismo track, distinto día).
- Incidencia antigua sin `workDayAtIncident`, con `segmentId` cuyo segmento tiene `workDay=1, trackNumber=1` → aparece cuando `day=1, track=1`.
- Misma incidencia antigua pero el segmento tiene `workDay=2` → NO aparece.
- Incidencia antigua sin `workDayAtIncident` y `segmentId` no presente en `segmentsById` → NO aparece.
- Incidencia sin `location` → NO aparece (regresión).

Ajustar el test existente `'acepta incidencias con solo trackAtIncident si coincide'` que ahora debe invertirse: sin `workDayAtIncident` y sin segmento resoluble → NO aparece (refleja la nueva regla más estricta).

### 4. Verificación de `addIncident`

Ya verificado en `src/hooks/useRouteState.ts` (líneas 904-922): persiste `location`, `trackAtIncident: seg?.trackNumber ?? null` y `workDayAtIncident: s.workDay ?? null`. No requiere cambios. Se documentará en el commit.

## Lo que NO cambia

- Esquema de `Incident` y persistencia (`campaign-schema.ts`).
- Lógica de `addIncident`.
- Exportación Excel (sigue usando `inc.trackAtIncident` directamente).
- Otras funciones de `track-gps-derived.ts`.
- UI del diálogo más allá de pasar el nuevo argumento.

## Criterios de aceptación

- Una incidencia del Día 2 / Track 1 nunca aparece en el mapa del Día 1 / Track 1.
- Incidencias históricas sin `workDayAtIncident` se ubican correctamente vía su segmento asociado, o se descartan si no se puede confirmar.

`tsc --noEmit` y `vitest run` pasan en verde.

&nbsp;

## Añade un ajuste importante: cuando `filterIncidentsForTrack` resuelva incidencias antiguas sin `workDayAtIncident` usando el segmento asociado, debe hacerlo con el dato consolidado si estamos en modo gabinete.

Opciones válidas:

1. Pasar a `filterIncidentsForTrack` un `segmentsById` ya consolidado desde `GabinetePage` / `GpsTrackDetailDialog`.

2. O pasar un resolver `getSegmentForIncident(segmentId)` que devuelva el segmento consolidado.

Regla:

- Si `workDayAtIncident` existe, manda ese valor.

- Si falta `workDayAtIncident`, usar el segmento asociado consolidado:

  - aceptar solo si `segment.workDay === day` y `segment.trackNumber === track`

  - si no hay segmento resoluble, descartar

- Mantener el requisito de `location`.

- Añadir test adicional:

  - incidencia antigua sin `workDayAtIncident`, segmento base con Día 2 / Track 1, pero corrección activa de gabinete a Día 1 / Track 1 → debe aparecer en Día 1 / Track 1 si se pasa el segmento consolidado.

El resto del plan queda aprobado:

- nueva firma de `filterIncidentsForTrack`

- pasar `segmentsById` desde `GpsTrackDetailDialog`

- tests de mismo track distinto día

- descartar incidencias antiguas sin segmento resoluble

- mantener `addIncident` sin cambios si ya guarda `location`, `trackAtIncident` y `workDayAtIncident`.