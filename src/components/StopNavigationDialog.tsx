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
  inProgressCount: number;
  onCancelAndStop: () => void;
  onGoBack: () => void;
}

export function StopNavigationDialog({ open, inProgressCount, onCancelAndStop, onGoBack }: Props) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Tramos en progreso
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm space-y-2">
            <p>
              Hay {inProgressCount} tramo{inProgressCount > 1 ? 's' : ''} en progreso.
              Si detienes la navegación ahora, se cancelarán los inicios y volverán a pendiente.
            </p>
            <p>
              ¿Quieres cancelar los inicios y detener, o volver a la navegación?
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel onClick={onGoBack}>
            Volver a navegación
          </AlertDialogCancel>
          <AlertDialogAction onClick={onCancelAndStop} className="bg-amber-500 text-amber-950 hover:bg-amber-600">
            Cancelar inicios y detener
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
