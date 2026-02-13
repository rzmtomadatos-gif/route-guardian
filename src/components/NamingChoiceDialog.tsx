import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Props {
  open: boolean;
  sampleCarretera: string;
  sampleIdenttramo: string;
  onChoice: (field: 'carretera' | 'identtramo') => void;
}

export function NamingChoiceDialog({ open, sampleCarretera, sampleIdenttramo, onChoice }: Props) {
  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="bg-card border-border max-w-sm mx-auto" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="text-foreground">Nombre de tramos</DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm">
            El archivo contiene dos campos de identificación. ¿Cuál quieres usar para nombrar los tramos?
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Button
            variant="outline"
            className="w-full justify-start text-left h-auto py-3 border-border"
            onClick={() => onChoice('carretera')}
          >
            <div>
              <div className="font-medium text-foreground">Carretera</div>
              <div className="text-xs text-muted-foreground mt-0.5">Ej: {sampleCarretera}</div>
            </div>
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start text-left h-auto py-3 border-primary bg-primary/5 ring-1 ring-primary/30"
            onClick={() => onChoice('identtramo')}
          >
            <div>
              <div className="font-medium text-foreground flex items-center gap-2">
                Ident. Tramo
                <span className="text-[10px] font-normal text-primary bg-primary/10 px-1.5 py-0.5 rounded">Recomendado</span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">Ej: {sampleIdenttramo}</div>
            </div>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
