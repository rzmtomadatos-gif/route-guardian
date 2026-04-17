import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { AlertTriangle } from 'lucide-react';

interface Props {
  open: boolean;
  workDay: number;
  trackNumber: number | null;
  inProgressCount: number;
  onCancelAndStop: () => void;
  onGoBack: () => void;
}

export function StopNavigationDialog({
  open,
  workDay,
  trackNumber,
  inProgressCount,
  onCancelAndStop,
  onGoBack,
}: Props) {
  const hasTrack = trackNumber !== null;
  const hasInProgress = inProgressCount > 0;

  // Título adaptativo
  let title: string;
  if (hasTrack && hasInProgress) {
    title = 'Detener navegación y cerrar track';
  } else if (hasTrack) {
    title = 'Cerrar track activo';
  } else {
    title = 'Detener navegación';
  }

  return (
    <AlertDialog open={open}>
      <AlertDialogContent
        className="max-w-md"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm space-y-2">
            {hasTrack && hasInProgress && (
              <>
                <p>
                  Hay {inProgressCount} tramo{inProgressCount > 1 ? 's' : ''} en progreso.
                  Si confirmas, se cancelarán los inicios y se cerrará{' '}
                  <strong>Día {workDay} · Track {trackNumber}</strong>.
                </p>
                <p>El track quedará consumido y el siguiente inicio abrirá un nuevo track.</p>
              </>
            )}
            {hasTrack && !hasInProgress && (
              <>
                <p>
                  Se va a cerrar <strong>Día {workDay} · Track {trackNumber}</strong>.
                </p>
                <p>El track quedará consumido y el siguiente inicio abrirá un nuevo track.</p>
              </>
            )}
            {!hasTrack && hasInProgress && (
              <p>
                Hay {inProgressCount} tramo{inProgressCount > 1 ? 's' : ''} en progreso.
                Si detienes la navegación ahora, se cancelarán los inicios y volverán a pendiente.
              </p>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel onClick={onGoBack}>
            Volver a navegación
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onCancelAndStop}
            className="bg-amber-500 text-amber-950 hover:bg-amber-600"
          >
            Confirmar y detener
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
