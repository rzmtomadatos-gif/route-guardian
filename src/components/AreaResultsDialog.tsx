import { useState } from 'react';
import { ArrowRight, ArrowLeftRight, Route, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { OverpassWay } from '@/utils/overpass-api';

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (generateReverse: boolean) => void;
  ways: OverpassWay[];
}

export function AreaResultsDialog({ open, onClose, onConfirm, ways }: Props) {
  const [generateReverse, setGenerateReverse] = useState(true);

  const onewayWays = ways.filter((w) => w.oneway);
  const twowayWays = ways.filter((w) => !w.oneway);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Route className="w-5 h-5 text-primary" />
            Vías encontradas
          </DialogTitle>
          <DialogDescription>
            Se han detectado {ways.length} vías. Revisa el detalle y confirma la generación.
          </DialogDescription>
        </DialogHeader>

        {/* Summary */}
        <div className="grid grid-cols-2 gap-2 py-2">
          <div className="flex items-center gap-2 p-2 rounded-lg bg-secondary/50">
            <ArrowRight className="w-4 h-4 text-amber-500 shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">{onewayWays.length}</p>
              <p className="text-[10px] text-muted-foreground">Sentido único</p>
            </div>
          </div>
          <div className="flex items-center gap-2 p-2 rounded-lg bg-secondary/50">
            <ArrowLeftRight className="w-4 h-4 text-green-500 shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">{twowayWays.length}</p>
              <p className="text-[10px] text-muted-foreground">Doble sentido</p>
            </div>
          </div>
        </div>

        {/* Road list */}
        <ScrollArea className="max-h-52 border border-border rounded-lg">
          <div className="divide-y divide-border">
            {ways.map((way, i) => {
              const start = way.coordinates[0];
              const end = way.coordinates[way.coordinates.length - 1];
              return (
                <div key={`${way.id}-${i}`} className="flex items-center gap-2 px-3 py-2">
                  {way.oneway ? (
                    <ArrowRight className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  ) : (
                    <ArrowLeftRight className="w-3.5 h-3.5 text-green-500 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{way.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {way.highway} · {way.coordinates.length} pts
                      {way.oneway && ' · sentido único'}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        {/* Reverse generation option */}
        {twowayWays.length > 0 && (
          <div className="pt-2 border-t border-border">
            <label className="flex items-start gap-3 p-2 rounded-lg hover:bg-secondary/50 cursor-pointer transition-colors">
              <Checkbox
                checked={generateReverse}
                onCheckedChange={(v) => setGenerateReverse(!!v)}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Generar sentido decreciente ({twowayWays.length} vías)
                </p>
                <p className="text-xs text-muted-foreground">
                  Crea tramos en sentido inverso en una capa separada para las vías de doble sentido
                </p>
              </div>
            </label>
          </div>
        )}

        {onewayWays.length > 0 && (
          <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-muted-foreground">
              {onewayWays.length} vía{onewayWays.length > 1 ? 's' : ''} de sentido único detectada{onewayWays.length > 1 ? 's' : ''}. 
              No se generarán tramos decrecientes para respetar las normas de circulación.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={() => onConfirm(generateReverse)}
            className="bg-primary text-primary-foreground"
          >
            <Route className="w-4 h-4 mr-1" />
            Generar {ways.length}{generateReverse && twowayWays.length > 0 ? ` + ${twowayWays.length}` : ''} tramos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
