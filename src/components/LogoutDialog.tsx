import { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { LogOut, Trash2, Shield, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CONFIRM_TIMEOUT_MS = 5000;

export function LogoutDialog({ open, onOpenChange }: Props) {
  const { signOut } = useAuth();
  const [loading, setLoading] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset confirmation state when dialog closes
  useEffect(() => {
    if (!open) {
      setConfirmWipe(false);
      if (timerRef.current) clearTimeout(timerRef.current);
    }
  }, [open]);

  // Auto-reset confirmation after timeout
  useEffect(() => {
    if (confirmWipe) {
      timerRef.current = setTimeout(() => setConfirmWipe(false), CONFIRM_TIMEOUT_MS);
      return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    }
  }, [confirmWipe]);

  const handleLogout = async (wipeData: boolean) => {
    setLoading(true);
    try {
      await signOut(wipeData);
      toast.success(wipeData ? 'Sesión cerrada y datos borrados.' : 'Sesión cerrada.');
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Error cerrando sesión: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleWipeClick = () => {
    if (!confirmWipe) {
      setConfirmWipe(true);
      return;
    }
    // Second click — execute wipe
    handleLogout(true);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogOut className="w-5 h-5" />
            Cerrar sesión
          </DialogTitle>
          <DialogDescription className="text-left space-y-2 pt-2">
            <span className="block">
              Este dispositivo se considera de <strong>usuario único</strong>. Si otro operador va a usar este dispositivo, se recomienda borrar los datos locales.
            </span>
            <span className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Shield className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              Los datos locales incluyen la campaña activa, incidencias y log de eventos almacenados en este dispositivo.
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            onClick={() => handleLogout(false)}
            disabled={loading}
            className="w-full"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Cerrar sesión y conservar datos
          </Button>

          {!confirmWipe ? (
            <Button
              onClick={handleWipeClick}
              disabled={loading}
              variant="outline"
              className="w-full border-destructive/40 text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Cerrar sesión y borrar datos
            </Button>
          ) : (
            <Button
              onClick={handleWipeClick}
              disabled={loading}
              variant="destructive"
              className="w-full animate-pulse"
            >
              <AlertTriangle className="w-4 h-4 mr-2" />
              ¿Seguro? Se perderán TODOS los datos. Pulsa de nuevo.
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
