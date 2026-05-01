// Singleton bus que conecta `virtual:pwa-register` (módulo no-React) con los hooks React.
// Evita race conditions: si el SW dispara onNeedRefresh ANTES de que el hook se monte,
// el estado queda guardado y el hook lo lee al suscribirse.
//
// Único punto donde se decide aplicar la actualización (skipWaiting + reload).

type ApplyFn = () => Promise<void> | void;
type Listener = () => void;

let needRefresh = false;
let applyFn: ApplyFn | null = null;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

export const pwaUpdateBus = {
  /** Llamado desde main.tsx cuando el SW tiene una nueva versión esperando */
  notifyNeedRefresh(apply: ApplyFn) {
    needRefresh = true;
    applyFn = apply;
    emit();
  },
  /** Llamado por el hook si el usuario aplaza */
  dismiss() {
    // No limpiamos `needRefresh`: queda disponible si el usuario quiere actualizar después.
    // El hook gestiona el "silenciado" por sesión.
    emit();
  },
  /**
   * Aplica la actualización si está disponible.
   * Devuelve true si pudo invocar la función real de aplicación,
   * false si no hay applyFn registrada (no hay SW waiting).
   * NO hace fallback a window.location.reload(): eso debe decidirlo el caller
   * para evitar recargas ciegas que sirvan la misma versión antigua.
   */
  async apply(): Promise<boolean> {
    if (applyFn) {
      await applyFn();
      return true;
    }
    return false;
  },
  getState() {
    return { needRefresh, canApply: applyFn !== null };
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
