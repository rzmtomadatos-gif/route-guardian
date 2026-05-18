import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { QRCodeSVG } from 'qrcode.react';
import { Radio, Copy, ExternalLink, X, Send, RefreshCw, Loader2, ShieldCheck } from 'lucide-react';
import type { CopilotSession, PairingInfo } from '@/hooks/useCopilotSession';
import { toast } from 'sonner';

interface Props {
  session: CopilotSession | null;
  active: boolean;
  onStart: () => Promise<CopilotSession | null>;
  onEnd: () => Promise<void>;
  onGeneratePairing: () => Promise<PairingInfo | null>;
  onForceSendBatch?: () => void;
  children: React.ReactNode;
}

function fmtCountdown(ms: number) {
  if (ms <= 0) return '00:00';
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function CopilotPanel({
  session, active, onStart, onEnd, onGeneratePairing, onForceSendBatch, children,
}: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pairing, setPairing] = useState<PairingInfo | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Tick once per second while a pairing is active to update countdown.
  useEffect(() => {
    if (!pairing) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pairing]);

  // Auto-clear expired pairing.
  const expiresMs = pairing ? Math.max(0, new Date(pairing.expires_at).getTime() - now) : 0;
  useEffect(() => {
    if (pairing && expiresMs <= 0) setPairing(null);
  }, [pairing, expiresMs]);

  // Clear nonce when dialog closes or session changes.
  useEffect(() => {
    if (!open || !active) setPairing(null);
  }, [open, active, session?.id]);

  const driverConnected = !!session?.driver_user_id;

  // Build URL only from the nonce. Never from a session token.
  const pairingUrlFull = useMemo(
    () => pairing ? `${window.location.origin}/driver?p=${pairing.nonce}` : '',
    [pairing],
  );
  const pairingUrlMini = useMemo(
    () => pairing ? `${window.location.origin}/driver-mini?p=${pairing.nonce}` : '',
    [pairing],
  );

  const handleStart = async () => {
    setLoading(true);
    await onStart();
    setLoading(false);
  };

  const handleGenerate = async () => {
    setPairingLoading(true);
    const p = await onGeneratePairing();
    setPairingLoading(false);
    if (!p) { toast.error('No se pudo generar el QR'); return; }
    setPairing(p);
    setNow(Date.now());
  };

  const handleEnd = async () => {
    await onEnd();
    setPairing(null);
    setOpen(false);
  };

  const copyMini = async () => {
    if (!pairingUrlMini) return;
    await navigator.clipboard.writeText(pairingUrlMini);
    toast.success('Enlace seguro copiado');
  };
  const copyFull = async () => {
    if (!pairingUrlFull) return;
    await navigator.clipboard.writeText(pairingUrlFull);
    toast.success('Enlace seguro copiado');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <Radio className="w-4 h-4" />
            Modo Copiloto
          </DialogTitle>
        </DialogHeader>

        {!active && (
          <div className="space-y-3 text-center py-4">
            <p className="text-xs text-muted-foreground">
              Activa el modo copiloto para enviar automáticamente los destinos al dispositivo del conductor.
            </p>
            <Button onClick={handleStart} disabled={loading} className="w-full h-11">
              {loading ? 'Conectando…' : 'Activar Copiloto'}
            </Button>
          </div>
        )}

        {active && session && (
          <div className="space-y-3">
            {/* Pairing status banner */}
            <div className={`flex items-center justify-between rounded-md px-3 py-2 text-xs ${
              driverConnected ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'
            }`}>
              <div className="flex items-center gap-2">
                {driverConnected
                  ? <ShieldCheck className="w-3.5 h-3.5" />
                  : <Radio className="w-3.5 h-3.5" />}
                <span className="font-medium">
                  {driverConnected ? 'Conductor conectado' : 'Esperando emparejamiento'}
                </span>
              </div>
              {session.driver_last_seen_at && driverConnected && (
                <span className="text-[10px] opacity-70">
                  visto {new Date(session.driver_last_seen_at).toLocaleTimeString()}
                </span>
              )}
            </div>

            {/* Pairing area: only shown when a nonce is active */}
            {!pairing && (
              <div className="space-y-3 text-center">
                <p className="text-xs text-muted-foreground">
                  {driverConnected
                    ? 'Genera un nuevo QR si necesitas vincular otro dispositivo.'
                    : 'Genera un QR de emparejamiento (válido 5 minutos) para que el conductor inicie sesión y se conecte.'}
                </p>
                <Button
                  onClick={handleGenerate}
                  disabled={pairingLoading}
                  className="w-full h-11"
                >
                  {pairingLoading
                    ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generando…</>)
                    : (<><Radio className="w-4 h-4 mr-2" /> Generar QR de emparejamiento</>)}
                </Button>
              </div>
            )}

            {pairing && (
              <>
                <div className="flex justify-center bg-white rounded-lg p-4">
                  <QRCodeSVG value={pairingUrlMini} size={200} level="M" />
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">Caduca en</span>
                  <span className={`font-mono font-medium ${expiresMs < 30_000 ? 'text-destructive' : 'text-foreground'}`}>
                    {fmtCountdown(expiresMs)}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground text-center">
                  Vista mini (recomendada). Un solo uso, expira al consumirse.
                </p>

                <div className="flex gap-2">
                  <Button variant="outline" onClick={copyMini} className="flex-1 h-9 text-xs">
                    <Copy className="w-3.5 h-3.5 mr-1" />
                    Copiar mini
                  </Button>
                  <Button variant="outline" onClick={copyFull} className="flex-1 h-9 text-xs">
                    <Copy className="w-3.5 h-3.5 mr-1" />
                    Copiar completo
                  </Button>
                  <Button
                    variant="outline"
                    className="h-9 px-3"
                    onClick={() => window.open(pairingUrlMini, '_blank', 'noopener,noreferrer')}
                    title="Abrir vista mini"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Button>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleGenerate}
                  disabled={pairingLoading}
                  className="w-full text-xs"
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1" />
                  Generar nuevo QR
                </Button>
              </>
            )}

            <div className="border-t border-border pt-3 space-y-2">
              {session.batch_number > 0 && (
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Lote actual: {session.batch_number}</span>
                  <span>{(session.queue || []).length} paradas en cola</span>
                </div>
              )}

              {onForceSendBatch && (
                <Button variant="outline" size="sm" onClick={onForceSendBatch} className="w-full text-xs">
                  <Send className="w-3.5 h-3.5 mr-1" />
                  Enviar siguiente lote ahora
                </Button>
              )}

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs text-foreground font-medium">Sesión activa</span>
                </div>
                <Button variant="ghost" size="sm" onClick={handleEnd} className="text-xs text-destructive">
                  <X className="w-3.5 h-3.5 mr-1" />
                  Finalizar
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
