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
import { Film } from 'lucide-react';

interface Props {
  open: boolean;
  trackNumber: number;
  onContinue: () => void;
  onCancel: () => void;
}

export function EndOfVideoDialog({ open, trackNumber, onContinue, onCancel }: Props) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-full bg-destructive/20 flex items-center justify-center">
              <Film className="w-6 h-6 text-destructive" />
            </div>
            <AlertDialogTitle className="text-lg">
              Fin de vídeo / Track {trackNumber}
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription className="text-sm leading-relaxed">
            Parar y preparar un nuevo vídeo en la Garmin.
            <br /><br />
            Cuando el nuevo vídeo esté listo, pulsa <strong>"Continuar"</strong>.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-2">
          <AlertDialogCancel onClick={onCancel}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onContinue} className="bg-primary text-primary-foreground">
            Continuar (nuevo vídeo listo)
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
