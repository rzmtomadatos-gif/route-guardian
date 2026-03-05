import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCopilotDriver } from '@/hooks/useCopilotSession';
import { Navigation, MapPin, Loader2, WifiOff, Clock, ExternalLink, Map } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function DriverPage() {
  const [params] = useSearchParams();
  const token = params.get('session');
  const { session, loading, error } = useCopilotDriver(token);

  // Track seen batch to show "new batch" alert
  const [seenBatch, setSeenBatch] = useState(0);
  const [showNewBatch, setShowNewBatch] = useState(false);
  const prevBatchRef = useRef(0);

  useEffect(() => {
    if (!session) return;
    const bn = session.batch_number || 0;
    if (bn > prevBatchRef.current && prevBatchRef.current > 0) {
      setShowNewBatch(true);
      // Vibrate to alert driver
      try { navigator.vibrate?.([300, 100, 300]); } catch {}
    }
    prevBatchRef.current = bn;
  }, [session?.batch_number]);

  const handleOpenBatch = useCallback(() => {
    if (!session?.batch_url) return;
    window.open(session.batch_url, '_blank');
    setShowNewBatch(false);
    setSeenBatch(session.batch_number || 0);
  }, [session]);

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="text-center space-y-3">
          <WifiOff className="w-12 h-12 text-muted-foreground mx-auto" />
          <h1 className="text-lg font-bold text-foreground">Sin sesión</h1>
          <p className="text-sm text-muted-foreground">Escanea el código QR del operador para conectar.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="text-center space-y-3">
          <WifiOff className="w-12 h-12 text-destructive mx-auto" />
          <h1 className="text-lg font-bold text-foreground">Error de conexión</h1>
          <p className="text-sm text-muted-foreground">{error || 'Sesión no encontrada'}</p>
        </div>
      </div>
    );
  }

  if (session.status === 'ended') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="text-center space-y-3">
          <Clock className="w-12 h-12 text-muted-foreground mx-auto" />
          <h1 className="text-lg font-bold text-foreground">Sesión finalizada</h1>
          <p className="text-sm text-muted-foreground">El operador ha terminado la sesión.</p>
        </div>
      </div>
    );
  }

  const isBlocked = session.status === 'blocked';
  const isWaiting = session.status === 'waiting';
  const hasBatch = !!session.batch_url;
  const batchNum = session.batch_number || 0;
  const queue = session.queue || [];
  const isNewBatch = showNewBatch && batchNum > seenBatch;

  return (
    <div className="min-h-screen bg-background flex flex-col safe-area-bottom safe-area-top">
      {/* Header */}
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

      {/* Main content */}
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

        {/* New batch alert */}
        {!isBlocked && isNewBatch && hasBatch && (
          <div className="w-full max-w-sm space-y-6 text-center">
            <div className="w-24 h-24 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto animate-pulse">
              <Map className="w-12 h-12 text-emerald-500" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-foreground">Nuevo itinerario disponible</h2>
              <p className="text-sm text-muted-foreground">Lote {batchNum} · {queue.length} paradas</p>
            </div>
            <Button
              className="w-full h-16 text-lg font-bold"
              onClick={handleOpenBatch}
            >
              <ExternalLink className="w-6 h-6 mr-3" />
              Abrir en Google Maps
            </Button>
          </div>
        )}

        {/* Current batch (already seen) */}
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

            <Button
              className="w-full h-14 text-base font-bold"
              onClick={handleOpenBatch}
            >
              <ExternalLink className="w-5 h-5 mr-2" />
              Abrir itinerario en Google Maps
            </Button>

            {/* Queue preview */}
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

      {/* Footer */}
      <footer className="bg-card border-t border-border px-4 py-2 text-center">
        <p className="text-[10px] text-muted-foreground">Route-Guardian · Solo lectura</p>
      </footer>
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
