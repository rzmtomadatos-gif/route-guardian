import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { QRCodeSVG } from 'qrcode.react';
import { Radio, Copy, ExternalLink, X } from 'lucide-react';
import type { CopilotSession } from '@/hooks/useCopilotSession';
import { toast } from 'sonner';

interface Props {
  session: CopilotSession | null;
  active: boolean;
  onStart: () => Promise<CopilotSession | null>;
  onEnd: () => Promise<void>;
  children: React.ReactNode;
}

export function CopilotPanel({ session, active, onStart, onEnd, children }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const driverUrl = session
    ? `${window.location.origin}/driver?session=${session.token}`
    : '';

  const handleStart = async () => {
    setLoading(true);
    await onStart();
    setLoading(false);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(driverUrl);
    toast.success('Enlace copiado');
  };

  const handleEnd = async () => {
    await onEnd();
    setOpen(false);
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
            <p className="text-xs text-muted-foreground text-center">
              El conductor debe escanear este QR o abrir el enlace:
            </p>

            {/* QR */}
            <div className="flex justify-center bg-white rounded-lg p-4">
              <QRCodeSVG value={driverUrl} size={200} level="M" />
            </div>

            {/* Link actions */}
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleCopy} className="flex-1 h-9 text-xs">
                <Copy className="w-3.5 h-3.5 mr-1" />
                Copiar enlace
              </Button>
              <Button
                variant="outline"
                className="h-9 px-3"
                onClick={() => window.open(driverUrl, '_blank')}
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </Button>
            </div>

            <div className="border-t border-border pt-3">
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
