import { useState } from 'react';
import { Loader2, MapPin, Route } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ROAD_CATEGORIES, type RoadCategory } from '@/utils/overpass-api';

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (categories: RoadCategory[], layerName: string, generateReverse: boolean) => void;
  pointCount: number;
  isLoading: boolean;
  layers: string[];
}

const ALL_CATEGORIES: RoadCategory[] = [
  'highway', 'primary', 'secondary', 'tertiary', 'residential', 'track', 'path',
];

export function AreaSelectionDialog({
  open,
  onClose,
  onConfirm,
  pointCount,
  isLoading,
  layers,
}: Props) {
  const [selected, setSelected] = useState<Set<RoadCategory>>(
    new Set<RoadCategory>(['highway', 'primary', 'secondary', 'tertiary'])
  );
  const [layer, setLayer] = useState('__new__');
  const [newLayerName, setNewLayerName] = useState('');
  const [generateReverse, setGenerateReverse] = useState(false);

  const toggle = (cat: RoadCategory) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const handleConfirm = () => {
    const cats = Array.from(selected);
    const ln = layer === '__new__'
      ? (newLayerName.trim() || 'Zona seleccionada')
      : layer === '__none__'
        ? ''
        : layer;
    onConfirm(cats, ln, generateReverse);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !isLoading && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" />
            Generar tramos en zona
          </DialogTitle>
          <DialogDescription>
            Zona definida con {pointCount} puntos. Selecciona qué tipos de vías incluir.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Tipos de vía
          </p>
          <div className="space-y-2">
            {ALL_CATEGORIES.map((cat) => {
              const info = ROAD_CATEGORIES[cat];
              return (
                <label
                  key={cat}
                  className="flex items-start gap-3 p-2 rounded-lg hover:bg-secondary/50 cursor-pointer transition-colors"
                >
                  <Checkbox
                    checked={selected.has(cat)}
                    onCheckedChange={() => toggle(cat)}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{info.label}</p>
                    <p className="text-xs text-muted-foreground">{info.description}</p>
                  </div>
                </label>
              );
            })}
          </div>

          <div className="pt-2 border-t border-border space-y-2">
            <label className="flex items-start gap-3 p-2 rounded-lg hover:bg-secondary/50 cursor-pointer transition-colors">
              <Checkbox
                checked={generateReverse}
                onCheckedChange={(v) => setGenerateReverse(!!v)}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">Generar sentido decreciente</p>
                <p className="text-xs text-muted-foreground">
                  Crea tramos en sentido inverso en una capa separada
                </p>
              </div>
            </label>
          </div>

          <div className="pt-2 border-t border-border space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Asignar a capa
            </p>
            <Select value={layer} onValueChange={setLayer}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__new__">Nueva capa...</SelectItem>
                <SelectItem value="__none__">Sin capa</SelectItem>
                {layers.map((l) => (
                  <SelectItem key={l} value={l}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {layer === '__new__' && (
              <Input
                value={newLayerName}
                onChange={(e) => setNewLayerName(e.target.value)}
                placeholder="Nombre de la capa..."
                className="h-8 text-xs"
              />
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isLoading}>
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={selected.size === 0 || isLoading}
            className="bg-primary text-primary-foreground"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                Consultando...
              </>
            ) : (
              <>
                <Route className="w-4 h-4 mr-1" />
                Generar tramos
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
