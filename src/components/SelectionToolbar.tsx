import { useState } from 'react';
import {
  Trash2, Layers, Merge, ArrowUp, ArrowDown, Palette, Copy, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const COLOR_OPTIONS = [
  { value: 'hsl(210 80% 55%)', label: 'Azul' },
  { value: 'hsl(0 75% 55%)', label: 'Rojo' },
  { value: 'hsl(142 70% 40%)', label: 'Verde' },
  { value: 'hsl(38 95% 50%)', label: 'Ámbar' },
  { value: 'hsl(280 70% 55%)', label: 'Púrpura' },
  { value: 'hsl(174 72% 40%)', label: 'Teal' },
  { value: 'hsl(25 90% 55%)', label: 'Naranja' },
  { value: 'hsl(330 70% 55%)', label: 'Rosa' },
];

interface Props {
  selectedCount: number;
  selectedIds: Set<string>;
  availableLayers: string[];
  onMerge: (ids: string[]) => void;
  onBulkDelete: (ids: string[]) => void;
  onBulkMove: (ids: string[], layer: string | undefined) => void;
  onBulkColor: (ids: string[], color: string) => void;
  onDuplicate: (ids: string[]) => void;
  onReorder: (id: string, dir: 'up' | 'down') => void;
  onClearSelection: () => void;
}

export function SelectionToolbar({
  selectedCount,
  selectedIds,
  availableLayers,
  onMerge,
  onBulkDelete,
  onBulkMove,
  onBulkColor,
  onDuplicate,
  onReorder,
  onClearSelection,
}: Props) {
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [moveTarget, setMoveTarget] = useState('');
  const [showColorDialog, setShowColorDialog] = useState(false);
  const [selectedColor, setSelectedColor] = useState(COLOR_OPTIONS[0].value);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const ids = Array.from(selectedIds);
  const isSingle = selectedCount === 1;

  return (
    <>
      <div className="flex items-center gap-1 px-3 py-2 bg-accent/10 border-b border-accent/20">
        <span className="text-[10px] font-medium text-accent-foreground mr-1">
          {selectedCount} seleccionado{selectedCount > 1 ? 's' : ''}
        </span>

        <Button
          size="sm" variant="ghost"
          className="h-6 px-1.5 text-[10px] gap-1"
          onClick={() => setShowMoveDialog(true)}
          title="Mover a capa"
        >
          <Layers className="w-3 h-3" /> Mover
        </Button>

        <Button
          size="sm" variant="ghost"
          className="h-6 px-1.5 text-[10px] gap-1 text-destructive hover:text-destructive"
          onClick={() => setShowDeleteConfirm(true)}
          title="Eliminar"
        >
          <Trash2 className="w-3 h-3" /> Eliminar
        </Button>

        {selectedCount >= 2 && (
          <Button
            size="sm" variant="ghost"
            className="h-6 px-1.5 text-[10px] gap-1"
            onClick={() => { onMerge(ids); onClearSelection(); }}
            title="Juntar tramos"
          >
            <Merge className="w-3 h-3" /> Juntar
          </Button>
        )}

        {isSingle && (
          <>
            <Button
              size="sm" variant="ghost"
              className="h-6 px-1.5 text-[10px] gap-0.5"
              onClick={() => onReorder(ids[0], 'up')}
              title="Subir"
            >
              <ArrowUp className="w-3 h-3" />
            </Button>
            <Button
              size="sm" variant="ghost"
              className="h-6 px-1.5 text-[10px] gap-0.5"
              onClick={() => onReorder(ids[0], 'down')}
              title="Bajar"
            >
              <ArrowDown className="w-3 h-3" />
            </Button>
          </>
        )}

        <Button
          size="sm" variant="ghost"
          className="h-6 px-1.5 text-[10px] gap-1"
          onClick={() => setShowColorDialog(true)}
          title="Color"
        >
          <Palette className="w-3 h-3" /> Color
        </Button>

        <Button
          size="sm" variant="ghost"
          className="h-6 px-1.5 text-[10px] gap-1"
          onClick={() => { onDuplicate(ids); onClearSelection(); }}
          title="Copiar"
        >
          <Copy className="w-3 h-3" /> Copiar
        </Button>

        <div className="flex-1" />
        <Button
          size="sm" variant="ghost"
          className="h-6 w-6 p-0 text-muted-foreground"
          onClick={onClearSelection}
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Move to layer dialog */}
      <Dialog open={showMoveDialog} onOpenChange={setShowMoveDialog}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">Mover {selectedCount} tramo{selectedCount > 1 ? 's' : ''} a capa</DialogTitle>
          </DialogHeader>
          <Select value={moveTarget} onValueChange={setMoveTarget}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Selecciona capa..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Sin capa</SelectItem>
              {availableLayers.map((l) => (
                <SelectItem key={l} value={l}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button size="sm" onClick={() => {
              onBulkMove(ids, moveTarget === '__none__' ? undefined : moveTarget);
              setShowMoveDialog(false);
              onClearSelection();
            }}>
              Mover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Color dialog */}
      <Dialog open={showColorDialog} onOpenChange={setShowColorDialog}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">Color de tramo{selectedCount > 1 ? 's' : ''}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-4 gap-2 py-2">
            {COLOR_OPTIONS.map((c) => (
              <button
                key={c.value}
                onClick={() => setSelectedColor(c.value)}
                className={`flex flex-col items-center gap-1 p-2 rounded-md transition-colors ${
                  selectedColor === c.value ? 'ring-2 ring-primary bg-accent/20' : 'hover:bg-secondary'
                }`}
              >
                <div className="w-6 h-6 rounded-full" style={{ backgroundColor: c.value }} />
                <span className="text-[9px] text-muted-foreground">{c.label}</span>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button size="sm" onClick={() => {
              onBulkColor(ids, selectedColor);
              setShowColorDialog(false);
              onClearSelection();
            }}>
              Aplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">Eliminar tramos</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            ¿Eliminar {selectedCount} tramo{selectedCount > 1 ? 's' : ''}? Esta acción no se puede deshacer.
          </p>
          <DialogFooter className="gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowDeleteConfirm(false)}>
              Cancelar
            </Button>
            <Button size="sm" variant="destructive" onClick={() => {
              onBulkDelete(ids);
              setShowDeleteConfirm(false);
              onClearSelection();
            }}>
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
