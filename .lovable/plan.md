

# Hotfix Sub-bloque 3 — Fuente única de routeState vía Context

## 1. Diagnóstico corto

Existen **dos instancias paralelas** de `useRouteState()` vivas a la vez:

- **A (real)**: creada en `App.tsx` dentro de `AppRoutes`. Contiene la campaña cargada (incluido el tramo `ygqrfumw`). Se pasa por props a `GabinetePage`.
- **B (fantasma)**: creada cada vez que se monta `useSegmentCorrections()` (en los diálogos de gabinete). Su `useState` interno arranca con `getDefaultState()` y nunca recibe la campaña, así que `state.route` es `null` y `segments` está vacío.

Resultado: la UI muestra el tramo (instancia A), pero el hook valida contra la instancia B vacía y lanza `"Segmento no encontrado en estado: ygqrfumw"`.

## 2. Por qué está pasando el error

`useRouteState` es un hook con `useState` propio. Cada llamada en un componente distinto crea su **propio estado aislado**. No hay nada en React que sincronice dos llamadas a `useState` en árboles distintos. La capa de persistencia (IndexedDB / SQLite) hidrata cada instancia de forma independiente, pero los diálogos de gabinete se montan después del arranque y reciben un estado vacío sin esperar la rehidratación.

Verificación rápida en código:

```ts
// useSegmentCorrections.ts (línea ~286)
const { state, setSegmentCorrections, readCommittedState } = useRouteState();
```

Esa llamada es la fuente del bug. Cualquier corrección aplicada desde un diálogo:
- valida contra una instancia vacía → falla con "Segmento no encontrado",
- o si pasara el guard, escribiría en una instancia que la UI nunca lee.

## 3. Solución técnica exacta

### Crear `src/context/RouteStateContext.tsx`

```tsx
import { createContext, useContext, type ReactNode } from 'react';
import type { useRouteState } from '@/hooks/useRouteState';

type RouteStateValue = ReturnType<typeof useRouteState>;

const RouteStateContext = createContext<RouteStateValue | null>(null);

export function RouteStateProvider({
  value,
  children,
}: {
  value: RouteStateValue;
  children: ReactNode;
}) {
  return (
    <RouteStateContext.Provider value={value}>
      {children}
    </RouteStateContext.Provider>
  );
}

/**
 * Acceso a la instancia ÚNICA de routeState creada en AppRoutes.
 * Lanza si se usa fuera del provider — defensa contra instancias paralelas.
 */
export function useRouteStateContext(): RouteStateValue {
  const ctx = useContext(RouteStateContext);
  if (!ctx) {
    throw new Error(
      'useRouteStateContext debe usarse dentro de <RouteStateProvider>.',
    );
  }
  return ctx;
}
```

### Envolver el árbol en `App.tsx`

`AppRoutes` ya crea la instancia real. Solo se añade el provider:

```tsx
const routeState = useRouteState();
// ...resto igual...
return (
  <RouteStateProvider value={routeState}>
    <RecoveryDialog ... />
    <AppLayout ...>
      <Routes>...</Routes>
    </AppLayout>
  </RouteStateProvider>
);
```

Cero cambios en cómo se pasan las props existentes. El provider coexiste con el paso por props.

### Refactor de `useSegmentCorrections.ts`

Cambio mínimo en una sola línea efectiva:

```ts
// ANTES
import { useRouteState } from '@/hooks/useRouteState';
const { state, setSegmentCorrections, readCommittedState } = useRouteState();

// DESPUÉS
import { useRouteStateContext } from '@/context/RouteStateContext';
const { state, setSegmentCorrections, readCommittedState } = useRouteStateContext();
```

El resto del archivo (engine, `createSegmentCorrectionsApi`, tests con deps mockeadas) **no cambia**. La separación entre el hook React y la API pura ya estaba bien diseñada.

### Garantía de fuente única

- `useRouteState()` queda invocado **una sola vez** en todo el árbol React (en `AppRoutes`).
- `useRouteStateContext()` solo lee del contexto, nunca crea estado.
- Si alguien añade un nuevo `useRouteState()` por error en otro componente, no romperá el contexto, pero el JSDoc de `useRouteState` se actualiza con un aviso explícito: *"Solo `AppRoutes` debe invocar este hook. Resto: `useRouteStateContext`."*
- Test de no-regresión: usar `useSegmentCorrections` fuera del provider lanza error inmediato y claro.

## 4. Archivos exactos

### Nuevos
- `src/context/RouteStateContext.tsx`
- `src/test/gabinete-context-wiring.test.tsx`

### Modificados
- `src/App.tsx` — envolver `AppRoutes` con `RouteStateProvider`. ~3 líneas.
- `src/hooks/useSegmentCorrections.ts` — sustituir import + llamada. ~2 líneas efectivas.
- `src/hooks/useRouteState.ts` — solo añadir comentario JSDoc de uso (sin cambios de lógica).

### NO se tocan
- `GabinetePage`, `GabineteSegmentsTable`, `GabineteSegmentDetailDialog`, `CorrectionApplyDialog`, `CorrectionRevertDialog`, `CorrectionFieldEditor`, `SegmentCorrectionsPanel`. Todos consumen el estado vía `useSegmentCorrections` (hook) o por props desde `GabinetePage`. El cambio es transparente.
- Engine `consolidate.ts`, `field-labels.ts`, tipos.
- `AppLayout`, `useUserRole`, lógica de campo, navegación, mapas.

## 5. Prueba mínima obligatoria

`src/test/gabinete-context-wiring.test.tsx`:

```tsx
/**
 * Demuestra que useSegmentCorrections lee del MISMO routeState que
 * la UI consume. Sin contexto compartido, este test reproduce el bug
 * "Segmento no encontrado en estado: ygqrfumw".
 */

it('apply desde gabinete usa el routeState compartido y persiste corrección', async () => {
  const segment = makeSegment({ id: 'ygqrfumw', name: 'Calle de González Dávila' });
  const route = makeRoute({ segments: [segment] });

  // Harness: monta <RouteStateProvider value={useRouteState()}> con la ruta
  // restaurada y un componente espía que invoca applySegmentCorrection.
  const harness = renderGabineteHarness({ initialRoute: route });

  // 1. Aplicar corrección sobre 'name' (campo descriptivo, motivo opcional).
  await harness.apply({
    segment,
    field: 'name',
    newValue: 'Calle de González Dávila 1',
    reason: '',
  });

  // 2. NO aparece el error "Segmento no encontrado en estado".
  expect(harness.lastError).toBeNull();

  // 3. La corrección se persiste en el state compartido.
  const corrections = harness.getState().segmentCorrections;
  expect(corrections).toHaveLength(1);
  expect(corrections[0].newValue).toBe('Calle de González Dávila 1');
  expect(corrections[0].previousValue).toBe('Calle de González Dávila');

  // 4. El consolidado refleja el cambio.
  const consolidated = harness.getConsolidated('ygqrfumw');
  expect(consolidated.name).toBe('Calle de González Dávila 1');

  // 5. El original base permanece intacto.
  const base = harness.getState().route!.segments.find(s => s.id === 'ygqrfumw');
  expect(base!.name).toBe('Calle de González Dávila');
});

it('useSegmentCorrections fuera del provider lanza error claro (no-regresión)', () => {
  expect(() => renderHook(() => useSegmentCorrections())).toThrow(
    /useRouteStateContext debe usarse dentro de <RouteStateProvider>/,
  );
});
```

Si RTL no estuviera disponible, el harness se implementa en estilo funcional puro montando el provider con un componente espía mínimo (mismo patrón que `gabinete-corrections-hook.test.ts` pero envolviendo en provider). La validación funcional se cumple igual.

## 6. Riesgos reales

1. **Tests existentes de `createSegmentCorrectionsApi`**: no se tocan. Pasan deps mockeadas, no usan ni hook ni contexto. Cero impacto.
2. **Otros consumidores futuros de `useRouteState`**: si alguien añade una segunda llamada por error, vuelve el bug. Mitigación: comentario JSDoc explícito en `useRouteState`.
3. **Orden de montaje**: el provider envuelve todo el árbol bajo `AppLayout`, así que cualquier ruta que monte componentes que consuman `useSegmentCorrections` queda cubierta.

## 7. Lo que NO se hace en este hotfix

- No guard de ruta `/gabinete` (sub-bloque siguiente, ya planeado).
- No smoke tests de UI más allá del wiring mínimo.
- No tocar Excel, resúmenes día/track, lógica de campo, navegación.

