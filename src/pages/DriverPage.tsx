import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  useCopilotDriver,
  claimDriverPairing,
  getStoredDriverToken,
  clearStoredDriverToken,
  type PairingClaimErrorReason,
  type PairingClaimStatus,
} from '@/hooks/useCopilotSession';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { Navigation, MapPin, Loader2, WifiOff, Clock, ExternalLink, Map, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

const PENDING_NONCE_KEY = 'vialroute_pending_driver_nonce';

export default function DriverPage() {
  const [params] = useSearchParams();
  const nonce = params.get('p');
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { role } = useUserRole();

  const [driverToken, setDriverToken] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<PairingClaimErrorReason | null>(null);
  const [claimStatus, setClaimStatus] = useState<PairingClaimStatus>('idle');
  const [claiming, setClaiming] = useState(false);

  // Auth + claim flow (same model as DriverMiniPage).
  useEffect(() => {
    if (authLoading) return;
    if (nonce) {
      try { sessionStorage.setItem(PENDING_NONCE_KEY, nonce); } catch { /* ignore */ }
    }
    if (!user) {
      if (nonce) {
        const next = `/driver?p=${encodeURIComponent(nonce)}`;
        navigate(`/auth?next=${encodeURIComponent(next)}`, { replace: true });
      }
      return;
    }
    let pending: string | null = null;
    try { pending = sessionStorage.getItem(PENDING_NONCE_KEY); } catch { /* ignore */ }

    if (pending) {
      setClaiming(true);
      setClaimStatus('claiming');
      claimDriverPairing(pending)
        .then((res) => {
          if (res.ok === false) { setClaimError(res.reason); setClaimStatus('error'); return; }
          setDriverToken(res.driver_token);
          setSessionId(res.session_id);
          setClaimError(null);
          setClaimStatus('ok');
        })
        .finally(() => {
          setClaiming(false);
          try { sessionStorage.removeItem(PENDING_NONCE_KEY); } catch { /* ignore */ }
          if (nonce) {
            const url = new URL(window.location.href);
            url.searchParams.delete('p');
            window.history.replaceState({}, '', url.toString());
          }
        });
      return;
    }
    const stored = getStoredDriverToken();
    if (stored) {
      setDriverToken(stored.driver_token);
      setSessionId(stored.session_id);
    }
  }, [nonce, user, authLoading, navigate]);

  const { status, session, markRouteOpened, refreshNow, lastPollAt, error: lastRpcError } = useCopilotDriver(driverToken);

  // Track seen batch to highlight "nuevo lote".
  const [seenBatch, setSeenBatch] = useState(0);
  const [showNewBatch, setShowNewBatch] = useState(false);
  const prevBatchRef = useRef(0);

  useEffect(() => {
    if (!session) return;
    const bn = session.batch_number || 0;
    if (bn > prevBatchRef.current && prevBatchRef.current > 0) {
      setShowNewBatch(true);
      try { navigator.vibrate?.([300, 100, 300]); } catch { /* ignore */ }
    }
    prevBatchRef.current = bn;
  }, [session?.batch_number]);

  const debugBatchNumber = session?.batch_number ?? 0;
  const debugHasBatch = !!session?.batch_url;
  const debugHasNew = showNewBatch && debugBatchNumber > seenBatch;

  const handleOpenBatch = useCallback(() => {
    if (!session?.batch_url) return;
    void markRouteOpened(session.batch_number ?? 0);
    window.open(session.batch_url, '_blank', 'noopener,noreferrer');
    setShowNewBatch(false);
    setSeenBatch(session.batch_number || 0);
  }, [session, markRouteOpened]);

  // ── Render states ──
  if (authLoading || claiming) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <ErrorScreen icon={<WifiOff className="w-12 h-12 text-muted-foreground mx-auto" />} title="Inicia sesión" subtitle="Inicia sesión para conectarte al copiloto." />
    );
  }
  if (claimError) {
    return <ErrorScreen icon={<WifiOff className="w-12 h-12 text-destructive mx-auto" />} title="Escanea un QR nuevo" subtitle={claimError === 'role_not_allowed' ? 'Tu usuario no tiene rol conductor' : claimError} action={<DriverDebug userId={user.id} role={role} noncePresent={!!nonce} claimStatus={claimStatus} claimError={claimError} driverTokenPresent={!!driverToken} sessionId={sessionId} readStatus={status} batchNumber={debugBatchNumber} hasBatchUrl={debugHasBatch} seenRev={seenBatch} hasNew={debugHasNew} lastPollAt={lastPollAt} lastRpcError={lastRpcError} onRefresh={refreshNow} />} />;
  }
  if (!driverToken) {
    return <ErrorScreen icon={<WifiOff className="w-12 h-12 text-muted-foreground mx-auto" />} title="Sin sesión" subtitle="Escanea el QR de emparejamiento del operador." action={<DriverDebug userId={user.id} role={role} noncePresent={!!nonce} claimStatus={claimStatus} claimError={claimError} driverTokenPresent={!!driverToken} sessionId={sessionId} readStatus={status} batchNumber={debugBatchNumber} hasBatchUrl={debugHasBatch} seenRev={seenBatch} hasNew={debugHasNew} lastPollAt={lastPollAt} lastRpcError={lastRpcError} onRefresh={refreshNow} />} />;
  }
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }
  if (status === 'invalid_token' || status === 'expired') {
    return (
      <ErrorScreen
        icon={<WifiOff className="w-12 h-12 text-destructive mx-auto" />}
        title="Escanea un QR nuevo"
        subtitle="El emparejamiento ya no es válido."
        action={
          <>
            <Button variant="outline" size="sm" onClick={() => { clearStoredDriverToken(); setDriverToken(null); setSessionId(null); }}>
              <RefreshCw className="w-4 h-4 mr-2" /> Reiniciar
            </Button>
            <DriverDebug userId={user.id} role={role} noncePresent={!!nonce} claimStatus={claimStatus} claimError={claimError} driverTokenPresent={!!driverToken} sessionId={sessionId} readStatus={status} batchNumber={debugBatchNumber} hasBatchUrl={debugHasBatch} seenRev={seenBatch} hasNew={debugHasNew} lastPollAt={lastPollAt} lastRpcError={lastRpcError} onRefresh={refreshNow} />
          </>
        }
      />
    );
  }
  if (status === 'ended' || session?.status === 'ended') {
    return <ErrorScreen icon={<Clock className="w-12 h-12 text-muted-foreground mx-auto" />} title="Sesión finalizada" subtitle="El operador ha terminado la sesión." />;
  }
  if (status === 'error' || !session) {
    return <ErrorScreen icon={<WifiOff className="w-12 h-12 text-amber-500 mx-auto" />} title="Reintentando…" subtitle="Sin respuesta del servidor." action={<DriverDebug userId={user.id} role={role} noncePresent={!!nonce} claimStatus={claimStatus} claimError={claimError} driverTokenPresent={!!driverToken} sessionId={sessionId} readStatus={status} batchNumber={debugBatchNumber} hasBatchUrl={debugHasBatch} seenRev={seenBatch} hasNew={debugHasNew} lastPollAt={lastPollAt} lastRpcError={lastRpcError} onRefresh={refreshNow} />} />;
  }

  const isBlocked = session.status === 'blocked';
  const isWaiting = session.status === 'waiting';
  const hasBatch = !!session.batch_url;
  const batchNum = session.batch_number || 0;
  const queue = session.queue || [];
  const isNewBatch = showNewBatch && batchNum > seenBatch;

  return (
    <div className="min-h-screen bg-background flex flex-col safe-area-bottom safe-area-top">
      <header className="bg-card border-b border-border px-4 py-3 flex items-center gap-3">
        <Navigation className="w-5 h-5 text-primary" />
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-foreground">Modo Copiloto</h1>
          <p className="text-[10px] text-muted-foreground">
            {session.track_number ? `Track ${session.track_number}` : 'Conectado'}
            {hasBatch && ` · Lote ${batchNum}`}
            {queue.length > 0 && ` · ${queue.length} paradas`}
          </p>
        </div>
        <StatusDot status={session.status} />
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
        {isWaiting && !hasBatch && (
          <div className="text-center space-y-3">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <Clock className="w-10 h-10 text-primary" />
            </div>
            <h2 className="text-2xl font-bold text-foreground">Esperando itinerario</h2>
            <p className="text-sm text-muted-foreground max-w-xs">
              El operador aún no ha enviado un itinerario. Recibirás el lote automáticamente.
            </p>
          </div>
        )}

        {isBlocked && (
          <div className="text-center space-y-3">
            <div className="w-20 h-20 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto">
              <Clock className="w-10 h-10 text-amber-500" />
            </div>
            <h2 className="text-2xl font-bold text-foreground">Bloque completado</h2>
            <p className="text-sm text-muted-foreground max-w-xs">
              El operador está preparando una nueva medición. Espera a que confirme.
            </p>
          </div>
        )}

        {!isBlocked && isNewBatch && hasBatch && (
          <div className="w-full max-w-sm space-y-6 text-center">
            <div className="w-24 h-24 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto animate-pulse">
              <Map className="w-12 h-12 text-emerald-500" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-foreground">Nuevo itinerario disponible</h2>
              <p className="text-sm text-muted-foreground">Lote {batchNum} · {queue.length} paradas</p>
            </div>
            <Button className="w-full h-16 text-lg font-bold" onClick={handleOpenBatch}>
              <ExternalLink className="w-6 h-6 mr-3" />
              Abrir en Google Maps
            </Button>
          </div>
        )}

        {!isBlocked && !isNewBatch && hasBatch && (
          <div className="w-full max-w-sm space-y-4 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto">
              <MapPin className="w-8 h-8 text-emerald-500" />
            </div>
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Itinerario activo</p>
              <h2 className="text-xl font-bold text-foreground">Lote {batchNum}</h2>
              <p className="text-xs text-muted-foreground">{queue.length} paradas en cola</p>
            </div>
            <Button className="w-full h-14 text-base font-bold" onClick={handleOpenBatch}>
              <ExternalLink className="w-5 h-5 mr-2" />
              Abrir itinerario en Google Maps
            </Button>
            {queue.length > 0 && (
              <div className="border border-border rounded-lg overflow-hidden mt-2 text-left">
                <div className="px-3 py-2 bg-muted/50 border-b border-border">
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                    Paradas del lote
                  </span>
                </div>
                <div className="divide-y divide-border">
                  {queue.slice(0, 5).map((item, i) => (
                    <div key={item.segmentId} className="px-3 py-2 flex items-center gap-2">
                      <span className="text-[10px] font-mono text-muted-foreground w-4 text-right">{i + 1}</span>
                      <span className="text-xs text-foreground truncate">{item.name || 'Sin nombre'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="bg-card border-t border-border px-4 py-2 text-center">
        <p className="text-[10px] text-muted-foreground">Route-Guardian · Solo lectura</p>
      </footer>
      <DriverDebug userId={user.id} role={role} noncePresent={!!nonce} claimStatus={claimStatus} claimError={claimError} driverTokenPresent={!!driverToken} sessionId={sessionId} readStatus={status} batchNumber={batchNum} hasBatchUrl={hasBatch} seenRev={seenBatch} hasNew={isNewBatch} lastPollAt={lastPollAt} lastRpcError={lastRpcError} onRefresh={refreshNow} />
    </div>
  );
}

function ErrorScreen({
  icon, title, subtitle, action,
}: { icon: React.ReactNode; title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="text-center space-y-3">
        {icon}
        <h1 className="text-lg font-bold text-foreground">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        {action}
      </div>
    </div>
  );
}

function shortId(v?: string | null) {
  return v ? `${v.slice(0, 8)}…` : '—';
}

function DriverDebug(props: {
  userId?: string | null; role: string | null; noncePresent: boolean; claimStatus: PairingClaimStatus;
  claimError: PairingClaimErrorReason | null; driverTokenPresent: boolean; sessionId: string | null;
  readStatus: string; batchNumber: number; hasBatchUrl: boolean; seenRev: number; hasNew: boolean;
  lastPollAt?: string | null; lastRpcError?: string | null; onRefresh: () => void;
}) {
  if (!import.meta.env.DEV) return null;
  return (
    <div className="mt-3 rounded-md bg-muted/80 border border-border p-2 text-[10px] text-muted-foreground text-left font-mono space-y-0.5">
      <div>debug driver · user {shortId(props.userId)} · rol {props.role ?? '—'} · nonce {props.noncePresent ? 'sí' : 'no'} · claim {props.claimStatus}</div>
      <div>reason {props.claimError ?? '—'} · token {props.driverTokenPresent ? 'sí' : 'no'} · session {shortId(props.sessionId)} · read {props.readStatus}</div>
      <div>batch {props.batchNumber} · url {props.hasBatchUrl ? 'sí' : 'no'} · seenRev {props.seenRev} · hasNew {props.hasNew ? 'sí' : 'no'}</div>
      <div>poll {props.lastPollAt ? new Date(props.lastPollAt).toLocaleTimeString() : '—'} · rpc {props.lastRpcError ?? '—'}</div>
      <button onClick={props.onRefresh} className="mt-1 underline">Refrescar ahora</button>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = status === 'navigating'
    ? 'bg-emerald-500'
    : status === 'blocked'
      ? 'bg-amber-500'
      : status === 'ended'
        ? 'bg-muted-foreground'
        : 'bg-primary';
  return <span className={`w-2.5 h-2.5 rounded-full ${color} animate-pulse`} />;
}
