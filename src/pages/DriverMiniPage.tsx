import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  useCopilotDriver,
  claimDriverPairing,
  getStoredDriverToken,
  clearStoredDriverToken,
} from '@/hooks/useCopilotSession';
import { useAuth } from '@/hooks/useAuth';
import { Loader2, WifiOff, RefreshCw } from 'lucide-react';

const PENDING_NONCE_KEY = 'vialroute_pending_driver_nonce';
const LS_SEEN_REV = 'driver-mini-seen-rev';

export default function DriverMiniPage() {
  const [params] = useSearchParams();
  const nonce = params.get('p');
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [driverToken, setDriverToken] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);

  // 1) Pairing claim flow when ?p=<nonce> is present.
  useEffect(() => {
    if (authLoading) return;

    // Capture nonce, then clean URL so refreshes don't re-trigger claim.
    if (nonce) {
      try { sessionStorage.setItem(PENDING_NONCE_KEY, nonce); } catch { /* ignore */ }
    }

    // Not authenticated: redirect to login keeping the nonce in URL.
    if (!user) {
      if (nonce) {
        const next = `/driver-mini?p=${encodeURIComponent(nonce)}`;
        navigate(`/auth?next=${encodeURIComponent(next)}`, { replace: true });
      }
      return;
    }

    // Authenticated: pick up pending nonce and consume it once.
    let pending: string | null = null;
    try { pending = sessionStorage.getItem(PENDING_NONCE_KEY); } catch { /* ignore */ }

    if (pending) {
      setClaiming(true);
      claimDriverPairing(pending)
        .then((res) => {
          if (!res) { setClaimError('Emparejamiento inválido o caducado'); return; }
          setDriverToken(res.driver_token);
          setSessionId(res.session_id);
          setClaimError(null);
        })
        .finally(() => {
          setClaiming(false);
          try { sessionStorage.removeItem(PENDING_NONCE_KEY); } catch { /* ignore */ }
          // Drop ?p from the URL so it isn't replayed.
          if (nonce) {
            const url = new URL(window.location.href);
            url.searchParams.delete('p');
            window.history.replaceState({}, '', url.toString());
          }
        });
      return;
    }

    // No pending nonce: recover stored token from previous pairing.
    const stored = getStoredDriverToken();
    if (stored) {
      setDriverToken(stored.driver_token);
      setSessionId(stored.session_id);
    }
  }, [nonce, user, authLoading, navigate]);

  const { status, session, markRouteOpened } = useCopilotDriver(driverToken);

  const [seenRev, setSeenRev] = useState(0);
  useEffect(() => {
    if (!sessionId) return;
    try {
      const v = parseInt(localStorage.getItem(`${LS_SEEN_REV}-${sessionId}`) || '0', 10);
      setSeenRev(Number.isFinite(v) ? v : 0);
    } catch { setSeenRev(0); }
  }, [sessionId]);

  const currentRev = session?.batch_number ?? 0;
  const hasNew = currentRev > seenRev && currentRev > 0;
  const hasBatch = !!session?.batch_url;
  const noPending = !!session && !session.batch_url && session.status !== 'waiting';

  // Vibrate on new revision.
  const prevRevRef = useRef(0);
  useEffect(() => {
    if (currentRev > prevRevRef.current && prevRevRef.current > 0) {
      try { navigator.vibrate?.([300, 100, 300]); } catch { /* ignore */ }
    }
    prevRevRef.current = currentRev;
  }, [currentRev]);

  const handlePress = async () => {
    if (!session?.batch_url || !sessionId) return;
    setSeenRev(currentRev);
    try { localStorage.setItem(`${LS_SEEN_REV}-${sessionId}`, String(currentRev)); } catch { /* ignore */ }
    // Notify backend that the route was opened, then open Maps in a safe tab.
    void markRouteOpened(currentRev);
    window.open(session.batch_url, '_blank', 'noopener,noreferrer');
  };

  // ── Render states ──
  if (authLoading || claiming) {
    return <FullScreenCenter><Loader2 className="w-8 h-8 animate-spin text-neutral-400" /></FullScreenCenter>;
  }

  if (!user) {
    return (
      <FullScreenCenter>
        <WifiOff className="w-10 h-10 text-neutral-500 mx-auto" />
        <p className="text-neutral-400 text-sm">Inicia sesión para conectarte</p>
      </FullScreenCenter>
    );
  }

  if (claimError) {
    return (
      <FullScreenCenter>
        <WifiOff className="w-10 h-10 text-red-500 mx-auto" />
        <p className="text-neutral-300 text-sm">Escanea un QR nuevo</p>
        <p className="text-neutral-500 text-xs">{claimError}</p>
      </FullScreenCenter>
    );
  }

  if (!driverToken) {
    return (
      <FullScreenCenter>
        <WifiOff className="w-10 h-10 text-neutral-500 mx-auto" />
        <p className="text-neutral-300 text-sm">Sin sesión</p>
        <p className="text-neutral-500 text-xs">Pide al operador un QR de emparejamiento</p>
      </FullScreenCenter>
    );
  }

  if (status === 'loading') {
    return <FullScreenCenter><Loader2 className="w-8 h-8 animate-spin text-neutral-400" /></FullScreenCenter>;
  }

  if (status === 'invalid_token' || status === 'expired') {
    return (
      <FullScreenCenter>
        <WifiOff className="w-10 h-10 text-red-500 mx-auto" />
        <p className="text-neutral-300 text-sm">Escanea un QR nuevo</p>
        <button
          onClick={() => { clearStoredDriverToken(); setDriverToken(null); setSessionId(null); }}
          className="text-xs text-neutral-400 underline mt-2 inline-flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> Reiniciar
        </button>
      </FullScreenCenter>
    );
  }

  if (status === 'ended' || session?.status === 'ended') {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black">
        <p className="text-neutral-500 text-lg font-bold">SESIÓN FINALIZADA</p>
      </div>
    );
  }

  if (status === 'error' || !session) {
    return (
      <FullScreenCenter>
        <WifiOff className="w-10 h-10 text-amber-500 mx-auto" />
        <p className="text-neutral-300 text-sm">Reintentando…</p>
      </FullScreenCenter>
    );
  }

  // Active button state
  let bgColor = 'bg-emerald-600';
  let label = 'OK';
  if (!hasBatch && session.status === 'waiting') {
    bgColor = 'bg-neutral-700';
    label = 'ESPERANDO…';
  } else if (noPending) {
    bgColor = 'bg-neutral-600';
    label = 'SIN TRAMOS';
  } else if (hasNew) {
    bgColor = 'bg-amber-500';
    label = 'ACTUALIZAR\nRUTA';
  }

  return (
    <div className="h-screen w-screen bg-black p-2 flex flex-col safe-area-top safe-area-bottom">
      <button
        onClick={handlePress}
        disabled={!hasBatch}
        className={`flex-1 rounded-2xl ${bgColor} transition-colors duration-300 flex items-center justify-center active:scale-95 disabled:opacity-50`}
      >
        <span className="text-white font-black text-4xl sm:text-5xl leading-tight whitespace-pre-line select-none">
          {label}
        </span>
      </button>
      <p className="text-neutral-700 text-[8px] text-center mt-1 select-none">
        rev {currentRev}
      </p>
    </div>
  );
}

function FullScreenCenter({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen w-screen flex items-center justify-center bg-black">
      <div className="text-center space-y-2">{children}</div>
    </div>
  );
}
