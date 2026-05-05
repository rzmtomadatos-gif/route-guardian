import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { pwaUpdateBus } from '@/lib/pwa-update-bus';

/** Versión inyectada en build-time por vite (define) */
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

const SESSION_DISMISS_KEY = 'vialroute_update_dismissed';

interface VersionInfo {
  version: string;
  buildTime: string;
}

interface UsePwaUpdateResult {
  /** Hay nueva versión esperando aplicarse (Service Worker waiting) */
  needRefresh: boolean;
  /** Versión actualmente instalada (build inyectada) */
  currentVersion: string;
  /** Build time legible */
  currentBuildTime: string;
  /** Última versión observada en /version.json (puede ser igual o mayor) */
  latestVersion: string | null;
  /** Aplica la actualización si hay SW waiting. Devuelve true si pudo aplicar. */
  applyUpdate: () => Promise<boolean>;
  /**
   * Combinación robusta: comprueba primero el SW, espera brevemente a que aparezca
   * un waiting si está descargándose, y aplica si puede. Devuelve estado legible.
   */
  prepareAndApplyUpdate: () => Promise<PrepareAndApplyResult>;
  /** Aplaza el aviso durante esta sesión */
  dismiss: () => void;
  /** Si fue aplazado en esta sesión */
  dismissed: boolean;
  /** Comprobación manual de actualización */
  checkForUpdate: () => Promise<void>;
  /** En curso una comprobación manual */
  checking: boolean;
  /** True si la última lectura de /version.json falló (404 / red / JSON inválido). */
  versionFileUnavailable: boolean;
  /** Última comprobación realizada */
  lastChecked: Date | null;
}

export type PrepareAndApplyResult =
  | { status: 'applied' }
  | { status: 'no-waiting'; message: string }
  | { status: 'no-sw'; message: string };

function readVersionFile(): Promise<VersionInfo | null> {
  // Cache-busting con timestamp para evitar respuesta cacheada del SW/HTTP
  return fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
}

/** Espera hasta `timeoutMs` a que aparezca un SW waiting tras llamar a update(). */
async function waitForWaitingSW(timeoutMs = 4000): Promise<ServiceWorker | null> {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return null;
  if (reg.waiting) return reg.waiting;

  return new Promise<ServiceWorker | null>((resolve) => {
    let done = false;
    const finish = (sw: ServiceWorker | null) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(sw);
    };
    const onUpdateFound = () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && reg.waiting) {
          finish(reg.waiting);
        }
      });
    };
    const cleanup = () => {
      reg.removeEventListener('updatefound', onUpdateFound);
      clearTimeout(timer);
    };
    reg.addEventListener('updatefound', onUpdateFound);
    const timer = setTimeout(() => finish(reg.waiting ?? null), timeoutMs);
  });
}

export function usePwaUpdate(): UsePwaUpdateResult {
  const busState = useSyncExternalStore(
    (cb) => pwaUpdateBus.subscribe(cb),
    () => pwaUpdateBus.getState().needRefresh,
    () => false,
  );

  const currentVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
  const currentBuildTime = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '';

  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(SESSION_DISMISS_KEY) === 'true';
    } catch {
      return false;
    }
  });

  /** Pide al SW que compruebe si hay nueva versión + lee version.json */
  const checkForUpdate = useCallback(async () => {
    setChecking(true);
    try {
      const tasks: Promise<unknown>[] = [];
      // 1) SW: forzar comprobación. Esto disparará onNeedRefresh si hay nuevo SW.
      if ('serviceWorker' in navigator) {
        tasks.push(
          navigator.serviceWorker.getRegistration().then((reg) => reg?.update()).catch(() => null),
        );
      }
      // 2) version.json: aporta visibilidad incluso si el SW aún no ha detectado el cambio.
      tasks.push(
        readVersionFile().then((info) => {
          if (info?.version) setLatestVersion(info.version);
        }),
      );
      await Promise.all(tasks);
      setLastChecked(new Date());
    } finally {
      setChecking(false);
    }
  }, []);

  // Comprobar al volver a primer plano
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        checkForUpdate();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [checkForUpdate]);

  // Comprobación periódica (30 min) además del intervalo de 60 min ya existente en main.tsx.
  // No es redundante: aquí también refrescamos /version.json para mostrar info al usuario.
  useEffect(() => {
    const id = setInterval(() => {
      checkForUpdate();
    }, 30 * 60 * 1000);
    return () => clearInterval(id);
  }, [checkForUpdate]);

  // Primera lectura de version.json al montar
  useEffect(() => {
    readVersionFile().then((info) => {
      if (info?.version) setLatestVersion(info.version);
      setLastChecked(new Date());
    });
  }, []);

  // Si llega un nuevo needRefresh, deshacer "dismissed" para que vuelva a verse
  useEffect(() => {
    if (busState) {
      try {
        sessionStorage.removeItem(SESSION_DISMISS_KEY);
      } catch {
        /* ignore */
      }
      setDismissed(false);
    }
  }, [busState]);

  const applyUpdate = useCallback(async (): Promise<boolean> => {
    const applied = await pwaUpdateBus.apply();
    return applied;
  }, []);

  /**
   * Flujo robusto de actualización:
   * 1. Si el bus ya tiene applyFn registrada (SW waiting detectado por main.tsx) → aplicar.
   * 2. Si no, forzar registration.update() y esperar brevemente a que aparezca un waiting.
   * 3. Si tras la espera hay waiting, postMessage SKIP_WAITING + recargar al activarse.
   * 4. Si NO hay waiting, NO recargar a ciegas. Devolver mensaje claro.
   */
  const prepareAndApplyUpdate = useCallback(async (): Promise<PrepareAndApplyResult> => {
    // Camino feliz: el SW ya tiene una versión esperando y main.tsx registró applyFn.
    if (pwaUpdateBus.getState().canApply) {
      const ok = await pwaUpdateBus.apply();
      if (ok) return { status: 'applied' };
    }

    if (!('serviceWorker' in navigator)) {
      return {
        status: 'no-sw',
        message:
          'Este navegador no soporta Service Worker. Cierra y vuelve a abrir la app para cargar la nueva versión.',
      };
    }

    // Forzar comprobación contra el servidor
    setChecking(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        return {
          status: 'no-sw',
          message:
            'No hay Service Worker registrado en este contexto. Cierra y vuelve a abrir la app.',
        };
      }
      try {
        await reg.update();
      } catch {
        /* update() puede fallar si offline; seguimos con lo que haya */
      }

      const waiting = await waitForWaitingSW(4000);

      if (waiting) {
        // Programar reload cuando el nuevo SW tome el control
        const onControllerChange = () => {
          window.location.reload();
        };
        navigator.serviceWorker.addEventListener('controllerchange', onControllerChange, {
          once: true,
        });
        // Si el bus tiene applyFn (más fiable: usa updateSW(true) de vite-plugin-pwa)
        if (pwaUpdateBus.getState().canApply) {
          await pwaUpdateBus.apply();
        } else {
          // Fallback directo: pedir al SW waiting que active
          waiting.postMessage({ type: 'SKIP_WAITING' });
        }
        return { status: 'applied' };
      }

      return {
        status: 'no-waiting',
        message:
          'La nueva versión está publicada pero todavía no está lista para aplicar. Cierra y vuelve a abrir la app o inténtalo de nuevo en unos segundos.',
      };
    } finally {
      setLastChecked(new Date());
      setChecking(false);
    }
  }, []);

  const dismiss = useCallback(() => {
    try {
      sessionStorage.setItem(SESSION_DISMISS_KEY, 'true');
    } catch {
      /* ignore */
    }
    setDismissed(true);
  }, []);

  return {
    needRefresh: busState,
    currentVersion,
    currentBuildTime,
    latestVersion,
    applyUpdate,
    prepareAndApplyUpdate,
    dismiss,
    dismissed,
    checkForUpdate,
    checking,
    lastChecked,
  };
}
