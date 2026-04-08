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
  hadNavigation: boolean;
  onRestore: () => void;
  onCancelSegments: () => void;
}

export function RecoveryDialog({ open, inProgressCount, hadNavigation, onRestore, onCancelSegments }: Props) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Sesión anterior interrumpida
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm space-y-2">
            <p>
              La app se cerró con {inProgressCount} tramo{inProgressCount > 1 ? 's' : ''} en progreso
              {hadNavigation ? ' y navegación activa' : ''}.
            </p>
            <p>
              La navegación se ha desactivado por seguridad. Puedes restaurar los tramos tal como estaban
              o cancelar los inicios y devolverlos a pendiente.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel onClick={onRestore}>
            Mantener en progreso
          </AlertDialogCancel>
          <AlertDialogAction onClick={onCancelSegments} className="bg-amber-500 text-amber-950 hover:bg-amber-600">
            Cancelar inicios → pendiente
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
