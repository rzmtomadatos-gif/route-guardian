import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { pwaUpdateBus } from '@/lib/pwa-update-bus';

/** Versión inyectada en build-time por vite (define) */
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

const SESSION_DISMISS_KEY = 'vialroute_update_dismissed';
const VERSION_ENDPOINTS = [
  '/version.json',
  '/.well-known/vialroute-version.json',
  '/app-version.json',
] as const;

interface VersionInfo {
  version: string;
  buildTime: string;
}

export type VersionFileStatus = 'unchecked' | 'ok' | '404' | 'no-json' | 'error';

export interface ServiceWorkerDiagnostics {
  registered: boolean;
  activeScriptURL: string | null;
  waiting: boolean;
  scope: string | null;
}

export interface VersionFileDiagnostics {
  status: VersionFileStatus;
  httpStatus: number | null;
  contentType: string | null;
  url: string | null;
  error: string | null;
  serviceWorker: ServiceWorkerDiagnostics;
}

interface VersionReadResult {
  info: VersionInfo | null;
  diagnostics: VersionFileDiagnostics;
}

export type RepairUpdateResult =
  | { status: 'applied'; message: string }
  | { status: 'cleaned'; message: string; clearedCaches: string[] }
  | { status: 'no-action'; message: string }
  | { status: 'no-sw'; message: string };

interface UsePwaUpdateResult {
  /** Hay nueva versión esperando aplicarse (Service Worker waiting) */
  needRefresh: boolean;
  /** Versión actualmente instalada (build inyectada) */
  currentVersion: string;
  /** Build time legible */
  currentBuildTime: string;
  /** Última versión observada en un endpoint de versión válido */
  latestVersion: string | null;
  /** Aplica la actualización si hay SW waiting. Devuelve true si pudo aplicar. */
  applyUpdate: () => Promise<boolean>;
  /**
   * Combinación robusta: comprueba primero el SW, espera brevemente a que aparezca
   * un waiting si está descargándose, y aplica si puede. Devuelve estado legible.
   */
  prepareAndApplyUpdate: () => Promise<PrepareAndApplyResult>;
  /** Recuperación segura para PWA instalada con SW/caché antiguos. No toca IndexedDB/localStorage. */
  repairUpdate: () => Promise<RepairUpdateResult>;
  /** Aplaza el aviso durante esta sesión */
  dismiss: () => void;
  /** Si fue aplazado en esta sesión */
  dismissed: boolean;
  /** Comprobación manual de actualización */
  checkForUpdate: () => Promise<void>;
  /** En curso una comprobación manual */
  checking: boolean;
  /** En curso una reparación segura */
  repairing: boolean;
  /** True si la última lectura de versión falló (404 / red / HTML / JSON inválido). */
  versionFileUnavailable: boolean;
  /** Diagnóstico visible de versión + Service Worker */
  versionDiagnostics: VersionFileDiagnostics;
  /** Última comprobación realizada */
  lastChecked: Date | null;
}

export type PrepareAndApplyResult =
  | { status: 'applied' }
  | { status: 'no-waiting'; message: string }
  | { status: 'no-sw'; message: string };

const EMPTY_SW_DIAGNOSTICS: ServiceWorkerDiagnostics = {
  registered: false,
  activeScriptURL: null,
  waiting: false,
  scope: null,
};

const EMPTY_VERSION_DIAGNOSTICS: VersionFileDiagnostics = {
  status: 'unchecked',
  httpStatus: null,
  contentType: null,
  url: null,
  error: null,
  serviceWorker: EMPTY_SW_DIAGNOSTICS,
};

async function getServiceWorkerDiagnostics(): Promise<ServiceWorkerDiagnostics> {
  if (!('serviceWorker' in navigator)) return EMPTY_SW_DIAGNOSTICS;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return EMPTY_SW_DIAGNOSTICS;
    return {
      registered: true,
      activeScriptURL: reg.active?.scriptURL ?? null,
      waiting: Boolean(reg.waiting),
      scope: reg.scope ?? null,
    };
  } catch {
    return EMPTY_SW_DIAGNOSTICS;
  }
}

function isVersionInfo(value: unknown): value is VersionInfo {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<VersionInfo>;
  return typeof candidate.version === 'string' && typeof candidate.buildTime === 'string';
}

async function fetchVersionEndpoint(path: string): Promise<Omit<VersionReadResult, 'diagnostics'> & { diagnostics: Omit<VersionFileDiagnostics, 'serviceWorker'> }> {
  const url = `${path}?nocache=${Date.now()}`;
  try {
    const response = await fetch(url, {
      cache: 'reload',
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        Accept: 'application/json',
      },
    });

    const contentType = response.headers.get('content-type');
    if (response.status === 404) {
      return {
        info: null,
        diagnostics: { status: '404', httpStatus: response.status, contentType, url, error: null },
      };
    }
    if (!response.ok) {
      return {
        info: null,
        diagnostics: {
          status: 'error',
          httpStatus: response.status,
          contentType,
          url,
          error: `HTTP ${response.status}`,
        },
      };
    }

    const body = await response.text();
    const trimmed = body.trim().toLowerCase();
    const isJsonContent = contentType?.toLowerCase().includes('application/json') ?? false;
    if (!isJsonContent || trimmed.startsWith('<!doctype') || trimmed.startsWith('<html')) {
      return {
        info: null,
        diagnostics: { status: 'no-json', httpStatus: response.status, contentType, url, error: null },
      };
    }

    try {
      const parsed: unknown = JSON.parse(body);
      if (!isVersionInfo(parsed)) {
        return {
          info: null,
          diagnostics: {
            status: 'no-json',
            httpStatus: response.status,
            contentType,
            url,
            error: 'JSON sin version/buildTime',
          },
        };
      }
      return {
        info: parsed,
        diagnostics: { status: 'ok', httpStatus: response.status, contentType, url, error: null },
      };
    } catch {
      return {
        info: null,
        diagnostics: { status: 'no-json', httpStatus: response.status, contentType, url, error: 'JSON inválido' },
      };
    }
  } catch (error) {
    return {
      info: null,
      diagnostics: {
        status: 'error',
        httpStatus: null,
        contentType: null,
        url,
        error: error instanceof Error ? error.message : 'Error de red',
      },
    };
  }
}

async function readVersionFile(): Promise<VersionReadResult> {
  const serviceWorker = await getServiceWorkerDiagnostics();
  let lastResult: Awaited<ReturnType<typeof fetchVersionEndpoint>> | null = null;

  for (const endpoint of VERSION_ENDPOINTS) {
    const result = await fetchVersionEndpoint(endpoint);
    lastResult = result;
    if (result.info) {
      return {
        info: result.info,
        diagnostics: { ...result.diagnostics, serviceWorker },
      };
    }
  }

  const fallback = lastResult?.diagnostics ?? {
    status: 'error' as const,
    httpStatus: null,
    contentType: null,
    url: null,
    error: 'Sin endpoints de versión disponibles',
  };
  return { info: null, diagnostics: { ...fallback, serviceWorker } };
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

function applyWaitingServiceWorker(waiting: ServiceWorker) {
  const onControllerChange = () => {
    window.location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', onControllerChange, {
    once: true,
  });
  if (pwaUpdateBus.getState().canApply) {
    return pwaUpdateBus.apply();
  }
  waiting.postMessage({ type: 'SKIP_WAITING' });
  return Promise.resolve(true);
}

async function clearSafePwaCaches(): Promise<string[]> {
  if (!('caches' in window)) return [];
  const safePatterns = [
    /workbox/i,
    /precache/i,
    /pwa-(manifest|icons)/i,
    /vite/i,
    /app-shell/i,
    /html/i,
    /version/i,
  ];
  const names = await caches.keys();
  const selected = names.filter((name) => safePatterns.some((pattern) => pattern.test(name)));
  await Promise.all(selected.map((name) => caches.delete(name)));
  return selected;
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
  const [versionFileUnavailable, setVersionFileUnavailable] = useState(false);
  const [versionDiagnostics, setVersionDiagnostics] = useState<VersionFileDiagnostics>(EMPTY_VERSION_DIAGNOSTICS);
  const [checking, setChecking] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(SESSION_DISMISS_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const updateVersionState = useCallback((result: VersionReadResult) => {
    setVersionDiagnostics(result.diagnostics);
    if (result.info?.version) {
      setLatestVersion(result.info.version);
      setVersionFileUnavailable(false);
    } else {
      setVersionFileUnavailable(true);
    }
  }, []);

  /** Pide al SW que compruebe si hay nueva versión + lee endpoints de versión */
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
      // 2) Version JSON: aporta visibilidad incluso si el SW aún no ha detectado el cambio.
      tasks.push(readVersionFile().then(updateVersionState));
      await Promise.all(tasks);
      setLastChecked(new Date());
    } finally {
      setChecking(false);
    }
  }, [updateVersionState]);

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
  // No es redundante: aquí también refrescamos version JSON para mostrar info al usuario.
  useEffect(() => {
    const id = setInterval(() => {
      checkForUpdate();
    }, 30 * 60 * 1000);
    return () => clearInterval(id);
  }, [checkForUpdate]);

  // Primera lectura de versión al montar
  useEffect(() => {
    readVersionFile().then((result) => {
      updateVersionState(result);
      setLastChecked(new Date());
    });
  }, [updateVersionState]);

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
        await applyWaitingServiceWorker(waiting);
        return { status: 'applied' };
      }

      return {
        status: 'no-waiting',
        message:
          'La nueva versión está publicada pero todavía no está lista para aplicar. Cierra y vuelve a abrir la app o inténtalo de nuevo en unos segundos.',
      };
    } finally {
      const result = await readVersionFile();
      updateVersionState(result);
      setLastChecked(new Date());
      setChecking(false);
    }
  }, [updateVersionState]);

  const repairUpdate = useCallback(async (): Promise<RepairUpdateResult> => {
    setRepairing(true);
    try {
      if (!('serviceWorker' in navigator)) {
        return {
          status: 'no-sw',
          message: 'Este navegador no tiene Service Worker disponible. Cierra y vuelve a abrir la app.',
        };
      }

      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        const result = await readVersionFile();
        updateVersionState(result);
        return {
          status: 'no-sw',
          message: 'No hay Service Worker registrado. Se ha vuelto a comprobar la versión publicada.',
        };
      }

      try {
        await reg.update();
      } catch {
        /* Puede estar offline o bloqueado por el SW antiguo. Continuamos con limpieza segura. */
      }

      const waiting = await waitForWaitingSW(5000);
      if (waiting) {
        await applyWaitingServiceWorker(waiting);
        return { status: 'applied', message: 'Actualización preparada. Recargando…' };
      }

      const clearedCaches = await clearSafePwaCaches();
      const result = await readVersionFile();
      updateVersionState(result);
      setLastChecked(new Date());

      if (clearedCaches.length > 0) {
        window.setTimeout(() => window.location.reload(), 250);
        return {
          status: 'cleaned',
          clearedCaches,
          message: 'Caché de actualización reparada. Recargando sin borrar datos de campaña…',
        };
      }

      return {
        status: 'no-action',
        message: 'No había cachés PWA seguras que limpiar. Cierra y vuelve a abrir la app si sigue sin actualizar.',
      };
    } finally {
      setRepairing(false);
    }
  }, [updateVersionState]);

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
    repairUpdate,
    dismiss,
    dismissed,
    checkForUpdate,
    checking,
    repairing,
    lastChecked,
    versionFileUnavailable,
    versionDiagnostics,
  };
}
