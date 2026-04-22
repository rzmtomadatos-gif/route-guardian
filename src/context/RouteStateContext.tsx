import { createContext, useContext, type ReactNode } from 'react';
import type { useRouteState } from '@/hooks/useRouteState';

/**
 * Tipo derivado del retorno real de `useRouteState`. Cualquier cambio en el
 * hook se propaga aquí automáticamente.
 */
type RouteStateValue = ReturnType<typeof useRouteState>;

const RouteStateContext = createContext<RouteStateValue | null>(null);

/**
 * Provider de la instancia ÚNICA de `routeState`.
 *
 * Debe envolver toda la app desde `AppRoutes`, donde se crea la única
 * llamada a `useRouteState()`. Cualquier consumidor downstream
 * (hooks, componentes, diálogos) debe leer vía `useRouteStateContext`
 * para evitar instancias paralelas con estado divergente.
 */
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
 * Acceso a la instancia única de `routeState`.
 *
 * Lanza si se usa fuera del provider — es defensa explícita contra el
 * patrón antiguo de invocar `useRouteState()` directamente en hooks
 * downstream, que generaba instancias fantasma vacías y errores tipo
 * "Segmento no encontrado en estado".
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
