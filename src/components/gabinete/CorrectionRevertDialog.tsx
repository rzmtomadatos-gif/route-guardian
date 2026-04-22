/**
 * Diálogo para revertir una corrección activa.
 *
 * Reglas:
 *  - Motivo de reversión obligatorio (≥ 3 caracteres tras trim).
 *  - La reversión NO reactiva ninguna corrección superseded anterior.
 *  - El consolidado del campo vuelve al dato base.
 */

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import type { SegmentCorrection } from '@/types/route';
import { getFieldLabel, formatCorrectionValue } from '@/utils/gabinete/field-labels';
import { useSegmentCorrections } from '@/hooks/useSegmentCorrections';

interface Props {
  open: boolean;
  correction: SegmentCorrection | null;
  onClose: () => void;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function CorrectionRevertDialog({ open, correction, onClose }: Props) {
  const { revertSegmentCorrection } = useSegmentCorrections();
  const [revertReason, setRevertReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setRevertReason('');
  }, [open]);

  if (!correction) return null;

  const reasonOk = revertReason.trim().length >= 3;
  const canSubmit = reasonOk && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await revertSegmentCorrection({
        correctionId: correction.id,
        revertReason: revertReason.trim(),
      });
      toast.success('Corrección revertida');
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al revertir la corrección';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !submitting && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Revertir corrección</DialogTitle>
          <DialogDescription>
            El valor del campo volverá al dato original de campo. Las
            correcciones anteriores superseded no se reactivan.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="bg-muted/50 rounded-md p-3 border border-border space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">
                {getFieldLabel(correction.field)}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {formatDate(correction.correctedAt)}
              </span>
            </div>
            <div className="text-xs flex items-center gap-2 flex-wrap">
              <span className="text-muted-foreground">
                {formatCorrectionValue(correction.previousValue)}
              </span>
              <span className="text-muted-foreground">→</span>
              <span className="text-foreground font-medium">
                {formatCorrectionValue(correction.newValue)}
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground">
              Aplicada por {correction.correctedBy}
              {correction.reason && (
                <>
                  {' · '}
                  <span className="italic">"{correction.reason}"</span>
                </>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">
              Motivo de la reversión <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={revertReason}
              onChange={(e) => setRevertReason(e.target.value)}
              placeholder="Explica brevemente por qué se revierte (mínimo 3 caracteres)"
              rows={2}
            />
            {revertReason.length > 0 && revertReason.trim().length < 3 && (
              <p className="text-[11px] text-destructive">Motivo demasiado corto.</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {submitting ? 'Revertiendo…' : 'Revertir corrección'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
