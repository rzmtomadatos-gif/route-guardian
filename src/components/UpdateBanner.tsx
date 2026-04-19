import { useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { usePwaUpdate } from '@/hooks/usePwaUpdate';
import { useAuth } from '@/hooks/useAuth';

interface Props {
  /** True si hay navegación en curso — exigir confirmación adicional */
  navigationActive: boolean;
}

/**
 * Banner sticky no invasivo que aparece cuando hay nueva versión PWA disponible.
 * - Solo visible para usuarios autenticados (excluye modo anónimo / pre-login).
 * - Si hay navegación activa, exige confirmación antes de recargar.
 * - "Más tarde" silencia el aviso solo durante esta sesión.
 */
export function UpdateBanner({ navigationActive }: Props) {
  const { user } = useAuth();
  const { needRefresh, dismissed, applyUpdate, dismiss } = usePwaUpdate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  if (!user) return null;
  if (!needRefresh || dismissed) return null;

  const handleUpdateClick = () => {
    if (navigationActive) {
      setConfirmOpen(true);
    } else {
      void doApply();
    }
  };

  const doApply = async () => {
    setApplying(true);
    try {
      await applyUpdate();
    } finally {
      // updateSW recarga la página, este setApplying es defensivo
      setApplying(false);
    }
  };

  return (
    <>
      <div
        className="flex items-center gap-2 px-3 py-2 bg-primary/10 border-b border-primary/30 text-xs"
        role="status"
        aria-live="polite"
      >
        <RefreshCw className="w-3.5 h-3.5 text-primary flex-shrink-0" />
        <span className="flex-1 text-foreground">
          Nueva versión disponible.
        </span>
        <button
          onClick={handleUpdateClick}
          disabled={applying}
          className="px-2.5 py-1 rounded bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {applying ? 'Actualizando…' : 'Actualizar ahora'}
        </button>
        <button
          onClick={dismiss}
          aria-label="Más tarde"
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Más tarde"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hay navegación activa</AlertDialogTitle>
            <AlertDialogDescription>
              La actualización requiere recargar la aplicación. La navegación en curso se
              interrumpirá. ¿Quieres actualizar ahora?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Seguir trabajando</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                void doApply();
              }}
            >
              Actualizar y recargar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
