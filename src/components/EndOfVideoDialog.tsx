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
import { AlertOctagon } from 'lucide-react';

interface Props {
  open: boolean;
  trackNumber: number;
  rstGroupSize?: number;
  onContinue: () => void;
  onCancel: () => void;
}

export function EndOfVideoDialog({ open, trackNumber, rstGroupSize = 9, onContinue, onCancel }: Props) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-full bg-destructive/20 flex items-center justify-center">
              <AlertOctagon className="w-6 h-6 text-destructive" />
            </div>
            <AlertDialogTitle className="text-lg">
              Bloque completado ({rstGroupSize}/{rstGroupSize}) — Preparar nueva medida
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription asChild>
            <div className="text-sm leading-relaxed text-muted-foreground space-y-2">
              <p>Detén la medición del tramo actual según procedimiento.</p>
              <p className="font-semibold text-amber-500">
                MEDICIÓN PARADA. PULSA INSERT PARA INICIAR UNA NUEVA MEDIDA.
              </p>
              <p>Cuando el equipo esté listo para el siguiente tramo, pulsa <strong className="text-foreground">"Continuar"</strong>.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-2">
          <AlertDialogCancel onClick={onCancel}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onContinue} className="bg-primary text-primary-foreground">
            Continuar (equipo listo)
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
