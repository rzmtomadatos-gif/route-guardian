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
import { Play } from 'lucide-react';

interface Props {
  open: boolean;
  workDay: number;
  trackNumber: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmación obligatoria antes de iniciar navegación.
 * Hasta que el operador no confirme: no se abre track, no se activa
 * navegación, no se emiten eventos, no se ejecutan side effects (GPS, audio, bloque).
 */
export function TrackStartDialog({
  open,
  workDay,
  trackNumber,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Play className="w-5 h-5 text-primary" />
            Iniciar navegación
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm space-y-2">
            <p>
              Se va a abrir <strong>Día {workDay} · Track {trackNumber}</strong>.
            </p>
            <p className="text-muted-foreground">
              Confirma para activar la navegación y abrir el track.
              El track quedará consumido aunque no inicies ningún tramo.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel onClick={onCancel}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            Confirmar e iniciar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
