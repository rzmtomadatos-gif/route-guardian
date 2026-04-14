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
import { AlertTriangle, CalendarDays } from 'lucide-react';

interface Props {
  open: boolean;
  targetDay: number;
  currentDay: number;
  hasInProgress: boolean;
  inProgressCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function WorkDayChangeDialog({
  open,
  targetDay,
  currentDay,
  hasInProgress,
  inProgressCount,
  onConfirm,
  onCancel,
}: Props) {
  const isAdvance = targetDay > currentDay;

  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {hasInProgress ? (
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            ) : (
              <CalendarDays className="w-5 h-5 text-primary" />
            )}
            Cambiar a Día {targetDay}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm space-y-2">
            {hasInProgress ? (
              <>
                <p>
                  Hay {inProgressCount} tramo{inProgressCount > 1 ? 's' : ''} en progreso que se cancelarán
                  al cambiar de día.
                </p>
                <p>
                  Los inicios se revertirán a pendiente y quedarán registrados como cancelación por cambio de día.
                </p>
              </>
            ) : (
              <p>
                {isAdvance
                  ? `¿Avanzar del Día ${currentDay} al Día ${targetDay}? La numeración de tracks se reiniciará.`
                  : `¿Volver del Día ${currentDay} al Día ${targetDay}?`}
              </p>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel onClick={onCancel}>
            Volver a navegación
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={hasInProgress
              ? 'bg-amber-500 text-amber-950 hover:bg-amber-600'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'}
          >
            {hasInProgress ? 'Cancelar inicios y cambiar día' : `Cambiar a Día ${targetDay}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
