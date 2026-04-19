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
  /** Llamado por el hook al confirmar */
  async apply() {
    if (applyFn) {
      await applyFn();
    } else {
      // Fallback: forzar recarga si por alguna razón no hay applyFn
      window.location.reload();
    }
  },
  getState() {
    return { needRefresh };
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
