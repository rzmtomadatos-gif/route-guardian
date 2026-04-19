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
  /** Hay nueva versión esperando aplicarse */
  needRefresh: boolean;
  /** Versión actualmente instalada (build inyectada) */
  currentVersion: string;
  /** Build time legible */
  currentBuildTime: string;
  /** Última versión observada en /version.json (puede ser igual o mayor) */
  latestVersion: string | null;
  /** Aplica la actualización: skipWaiting + reload */
  applyUpdate: () => Promise<void>;
  /** Aplaza el aviso durante esta sesión */
  dismiss: () => void;
  /** Si fue aplazado en esta sesión */
  dismissed: boolean;
  /** Comprobación manual de actualización */
  checkForUpdate: () => Promise<void>;
  /** En curso una comprobación manual */
  checking: boolean;
  /** Última comprobación realizada */
  lastChecked: Date | null;
}

function readVersionFile(): Promise<VersionInfo | null> {
  // Cache-busting con timestamp para evitar respuesta cacheada del SW/HTTP
  return fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
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

  const applyUpdate = useCallback(async () => {
    await pwaUpdateBus.apply();
    // El propio updateSW(true) recarga; este reload es defensivo si no hay SW.
    if (!('serviceWorker' in navigator)) {
      window.location.reload();
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
    dismiss,
    dismissed,
    checkForUpdate,
    checking,
    lastChecked,
  };
}
