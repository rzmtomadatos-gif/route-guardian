/**
 * Diálogo reutilizable para reactivar un tramo para campo.
 *
 * Esta acción NO es una corrección reversible de gabinete. Modifica el estado
 * operativo base del tramo para que el operador pueda volver a navegarlo.
 *
 * El histórico previo (eventos, incidencias, trackHistory, companySegmentId)
 * se conserva intacto.
 */
import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle } from 'lucide-react';
import type { Segment } from '@/types/route';

interface Props {
  open: boolean;
  segment: Segment | null;
  defaultWorkDay: number;
  onConfirm: (segmentId: string, opts: { targetWorkDay: number; reason: string }) => void;
  onClose: () => void;
}

export function ReactivateSegmentDialog({
  open,
  segment,
  defaultWorkDay,
  onConfirm,
  onClose,
}: Props) {
  const [targetWorkDay, setTargetWorkDay] = useState<number>(defaultWorkDay);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) {
      setTargetWorkDay(defaultWorkDay);
      setReason('');
    }
  }, [open, defaultWorkDay]);

  if (!segment) return null;

  const trimmedReason = reason.trim();
  const canConfirm =
    Number.isFinite(targetWorkDay) && targetWorkDay >= 1 && trimmedReason.length >= 3;

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm(segment.id, { targetWorkDay, reason: trimmedReason });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reactivar tramo para campo</DialogTitle>
          <DialogDescription className="text-xs">
            Modifica el estado operativo base. No es una corrección reversible
            de gabinete. El histórico previo (eventos, incidencias, trackHistory)
            se conserva.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="rounded-md border border-border bg-muted/40 p-2 text-xs">
            <div className="font-medium text-foreground">{segment.name}</div>
            <div className="text-muted-foreground">
              ID empresa: {segment.companySegmentId || 'NO REGISTRADO'}
            </div>
            <div className="text-muted-foreground">
              Estado actual: {segment.status}
              {segment.nonRecordable ? ' · no grabable' : ''}
              {segment.needsRepeat ? ' · requiere repetir' : ''}
            </div>
            <div className="text-muted-foreground">
              Día actual: {segment.workDay ?? '—'}
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="reactivate-day" className="text-xs">
              Reactivar para Día
            </Label>
            <Input
              id="reactivate-day"
              type="number"
              min={1}
              value={targetWorkDay}
              onChange={(e) => setTargetWorkDay(Number(e.target.value))}
              className="h-9"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="reactivate-reason" className="text-xs">
              Motivo (obligatorio)
            </Label>
            <Textarea
              id="reactivate-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej.: corte despejado, repetición solicitada por gabinete…"
              rows={3}
              className="text-sm"
            />
          </div>

          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>
              El tramo pasará a Pendiente en el día indicado. Aparecerá en
              Tramos y entrará en la navegación del Mapa.
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            Reactivar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
