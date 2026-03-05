import { useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCopilotDriver, type QueueItem } from '@/hooks/useCopilotSession';
import { Navigation, MapPin, Loader2, WifiOff, Clock, ExternalLink, ChevronRight, List } from 'lucide-react';
import { Button } from '@/components/ui/button';

function buildNavUrl(lat: number, lng: number, app: 'google' | 'waze' | 'system'): string {
  if (app === 'waze') return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
  if (app === 'google') return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
  return `geo:${lat},${lng}?q=${lat},${lng}`;
}

export default function DriverPage() {
  const [params] = useSearchParams();
  const token = params.get('session');
  const { session, loading, error, advanceQueue } = useCopilotDriver(token);

  const handleNextStop = useCallback(async () => {
    if (!session) return;
    const next = await advanceQueue();
    if (next) {
      // Open navigation in same user gesture
      window.open(buildNavUrl(next.lat, next.lng, 'google'), '_blank');
    }
  }, [session, advanceQueue]);

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

  const queue = session.queue || [];
  const current = queue[0] || null;
  const upcoming = queue.slice(1);
  const isBlocked = session.status === 'blocked';
  const isWaiting = session.status === 'waiting';
  const hasQueue = queue.length > 0;

  return (
    <div className="min-h-screen bg-background flex flex-col safe-area-bottom safe-area-top">
      {/* Header */}
      <header className="bg-card border-b border-border px-4 py-3 flex items-center gap-3">
        <Navigation className="w-5 h-5 text-primary" />
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-foreground">Modo Copiloto</h1>
          <p className="text-[10px] text-muted-foreground">
            {session.track_number ? `Track ${session.track_number}` : 'Conectado'}
            {hasQueue && ` · ${queue.length} en cola`}
          </p>
        </div>
        <StatusDot status={session.status} />
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
        {isWaiting && !hasQueue && (
          <div className="text-center space-y-3">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <Clock className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-xl font-bold text-foreground">Esperando destino</h2>
            <p className="text-sm text-muted-foreground max-w-xs">
              El operador aún no ha iniciado un tramo. Recibirás el destino automáticamente.
            </p>
          </div>
        )}

        {isBlocked && (
          <div className="text-center space-y-3">
            <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto">
              <Clock className="w-8 h-8 text-amber-500" />
            </div>
            <h2 className="text-xl font-bold text-foreground">Bloque completado</h2>
            <p className="text-sm text-muted-foreground max-w-xs">
              El operador está preparando una nueva medición. Espera a que confirme para continuar.
            </p>
          </div>
        )}

        {!isBlocked && current && (
          <div className="w-full max-w-sm space-y-4">
            {/* Current destination */}
            <div className="text-center space-y-2">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto">
                <MapPin className="w-8 h-8 text-emerald-500" />
              </div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Destino actual</p>
              <h2 className="text-xl font-bold text-foreground">{current.name || 'Sin nombre'}</h2>
            </div>

            {/* Nav buttons */}
            <div className="space-y-2 w-full">
              <Button
                className="w-full h-14 text-base font-bold"
                onClick={() => window.open(buildNavUrl(current.lat, current.lng, 'google'), '_blank')}
              >
                <ExternalLink className="w-5 h-5 mr-2" />
                Abrir en Google Maps
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1 h-11"
                  onClick={() => window.open(buildNavUrl(current.lat, current.lng, 'waze'), '_blank')}
                >
                  Waze
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 h-11"
                  onClick={() => window.open(buildNavUrl(current.lat, current.lng, 'system'), '_blank')}
                >
                  Navegador
                </Button>
              </div>
            </div>

            {/* Next stop button */}
            {queue.length > 1 && (
              <Button
                variant="secondary"
                className="w-full h-14 text-base font-bold mt-4"
                onClick={handleNextStop}
              >
                <ChevronRight className="w-5 h-5 mr-2" />
                Siguiente parada
              </Button>
            )}

            {/* Upcoming queue */}
            {upcoming.length > 0 && (
              <div className="border border-border rounded-lg overflow-hidden mt-2">
                <div className="px-3 py-2 bg-muted/50 border-b border-border flex items-center gap-2">
                  <List className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                    Próximos ({upcoming.length})
                  </span>
                </div>
                <div className="divide-y divide-border">
                  {upcoming.slice(0, 4).map((item, i) => (
                    <div key={item.segmentId} className="px-3 py-2 flex items-center gap-2">
                      <span className="text-[10px] font-mono text-muted-foreground w-4 text-right">{i + 2}</span>
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
