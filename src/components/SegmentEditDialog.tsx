import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Segment, SegmentDirection, SegmentType } from '@/types/route';
import { sanitizeTextField } from '@/utils/sanitize';
import { SegmentCorrectionsPanel } from '@/components/SegmentCorrectionsPanel';
import { useUserRole } from '@/hooks/useUserRole';
import { useSegmentCorrections } from '@/hooks/useSegmentCorrections';
import { getFieldLabel, formatCorrectionValue } from '@/utils/gabinete/field-labels';

interface Props {
  segment: Segment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (updated: Partial<Segment>) => void;
}

export function SegmentEditDialog({ segment, open, onOpenChange, onSave }: Props) {
  const [name, setName] = useState(segment.name);
  const [kmlId, setKmlId] = useState(segment.kmlId);
  const [direction, setDirection] = useState<SegmentDirection>(segment.direction);
  const [type, setType] = useState<SegmentType>(segment.type);
  const [notes, setNotes] = useState(segment.notes);

  // Vista informativa para admin/gabinete: muestra el valor consolidado actual
  // de los campos con corrección activa. Los inputs siguen mostrando el dato
  // base/original de campo (no se mezcla con el consolidado).
  const { role } = useUserRole();
  const { getActiveCorrections } = useSegmentCorrections();
  const canSeeGabinete = role === 'admin' || role === 'gabinete';
  const activeCorrections = canSeeGabinete ? getActiveCorrections(segment.id) : [];
  const showGabineteInfo = canSeeGabinete && activeCorrections.length > 0;

  const handleSave = () => {
    onSave({
      name: sanitizeTextField(name, 500),
      kmlId: sanitizeTextField(kmlId, 500),
      direction,
      type,
      notes: sanitizeTextField(notes, 5000),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-sm mx-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            Editar Tramo — {segment.name}
            {segment.trackNumber !== null && (
              <span className="text-sm font-normal text-primary ml-2">Track {segment.trackNumber}</span>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">ID Tramo (cliente)</label>
            <Input value={kmlId} onChange={(e) => setKmlId(e.target.value)} placeholder="ID del tramo" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Nombre</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del tramo" />
          </div>

          {/* KML Metadata (read-only info) */}
          {segment.kmlMeta && (segment.kmlMeta.carretera || segment.kmlMeta.identtramo || segment.kmlMeta.tipo) && (
            <div className="bg-secondary/50 rounded-lg p-3 space-y-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Datos KML</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                {segment.kmlMeta.carretera && (
                  <div><span className="text-muted-foreground">Carretera:</span> <span className="text-foreground">{segment.kmlMeta.carretera}</span></div>
                )}
                {segment.kmlMeta.identtramo && (
                  <div><span className="text-muted-foreground">Ident:</span> <span className="text-foreground">{segment.kmlMeta.identtramo}</span></div>
                )}
                {segment.kmlMeta.tipo && (
                  <div><span className="text-muted-foreground">Tipo:</span> <span className="text-foreground">{segment.kmlMeta.tipo}</span></div>
                )}
                {segment.kmlMeta.calzada && (
                  <div><span className="text-muted-foreground">Calzada:</span> <span className="text-foreground">{segment.kmlMeta.calzada}</span></div>
                )}
                {segment.kmlMeta.sentido && (
                  <div><span className="text-muted-foreground">Sentido:</span> <span className="text-foreground">{segment.kmlMeta.sentido}</span></div>
                )}
                {segment.kmlMeta.pkInicial && (
                  <div><span className="text-muted-foreground">PK Inicial:</span> <span className="text-foreground">{segment.kmlMeta.pkInicial}</span></div>
                )}
                {segment.kmlMeta.pkFinal && (
                  <div><span className="text-muted-foreground">PK Final:</span> <span className="text-foreground">{segment.kmlMeta.pkFinal}</span></div>
                )}
              </div>
            </div>
          )}

          {/* Aviso para admin/gabinete: separa dato base (editable) del consolidado */}
          {showGabineteInfo && (
            <p className="text-[11px] text-muted-foreground italic">
              Los campos editables muestran el dato original de campo. Las correcciones
              activas de gabinete se listan más abajo y no modifican el dato base.
            </p>
          )}

          {/* Vista read-only del valor consolidado actual (solo si hay correcciones activas) */}
          {showGabineteInfo && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-1.5">
              <p className="text-[10px] font-semibold text-primary uppercase tracking-wide">
                Valor consolidado actual
              </p>
              <div className="grid grid-cols-1 gap-y-1 text-xs">
                {activeCorrections.map((c) => (
                  <div key={c.id}>
                    <span className="text-muted-foreground">{getFieldLabel(c.field)}:</span>{' '}
                    <span className="text-foreground font-medium">
                      {formatCorrectionValue(c.newValue)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Panel de correcciones de gabinete (solo admin/gabinete, solo si existen) */}
          <SegmentCorrectionsPanel segmentId={segment.id} />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Tipo</label>
              <Select value={type} onValueChange={(v) => setType(v as SegmentType)}>
                <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="tramo">Tramo</SelectItem>
                  <SelectItem value="rotonda">Rotonda</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Dirección</label>
              <Select value={direction} onValueChange={(v) => setDirection(v as SegmentDirection)}>
                <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="creciente">Creciente</SelectItem>
                  <SelectItem value="ambos">Ambos</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Notas</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notas del tramo..."
              className="w-full p-3 rounded-lg bg-secondary border border-border text-foreground placeholder:text-muted-foreground text-sm resize-none h-20"
            />
          </div>
          <Button onClick={handleSave} className="w-full bg-primary text-primary-foreground">
            Guardar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
