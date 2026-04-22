/**
 * Diálogo para aplicar una corrección de gabinete sobre un campo concreto.
 *
 * NOTA OPERATIVA: las correcciones de gabinete NO mutan el dato base de
 * campo. Solo modifican el "valor consolidado" derivado en lectura. La
 * navegación de campo y el flujo operativo siguen viendo el dato original.
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
import type { Segment, CorrectableField } from '@/types/route';
import { FIELDS_REQUIRING_REASON } from '@/types/route';
import { getFieldLabel, formatCorrectionValue } from '@/utils/gabinete/field-labels';
import { useSegmentCorrections } from '@/hooks/useSegmentCorrections';
import { CorrectionFieldEditor } from './CorrectionFieldEditor';

interface Props {
  open: boolean;
  segment: Segment;
  field: CorrectableField | null;
  /** Valor actual (consolidado) del campo. */
  currentValue: unknown;
  onClose: () => void;
}

export function requiresReason(field: CorrectableField): boolean {
  return FIELDS_REQUIRING_REASON.has(field);
}

export function CorrectionApplyDialog({
  open,
  segment,
  field,
  currentValue,
  onClose,
}: Props) {
  const { applySegmentCorrection } = useSegmentCorrections();
  const [newValue, setNewValue] = useState<unknown>(currentValue);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setNewValue(currentValue);
      setReason('');
    }
  }, [open, currentValue, field]);

  if (!field) return null;

  const reasonRequired = requiresReason(field);
  const reasonOk = !reasonRequired || reason.trim().length >= 3;
  const valueChanged =
    JSON.stringify(newValue ?? null) !== JSON.stringify(currentValue ?? null);
  const canSubmit = valueChanged && reasonOk && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await applySegmentCorrection({
        segment,
        field,
        newValue,
        reason: reason.trim(),
      });
      toast.success('Corrección aplicada');
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al aplicar la corrección';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !submitting && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Corregir: {getFieldLabel(field)}</DialogTitle>
          <DialogDescription>
            Las correcciones de gabinete no modifican el dato original de
            campo, solo el valor consolidado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="bg-muted/50 rounded-md p-2.5 border border-border">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">
              Valor consolidado actual
            </p>
            <p className="text-sm text-foreground">
              {formatCorrectionValue(currentValue)}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Nuevo valor</Label>
            <CorrectionFieldEditor
              field={field}
              value={newValue}
              onChange={setNewValue}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">
              Motivo {reasonRequired && <span className="text-destructive">*</span>}
              {!reasonRequired && (
                <span className="text-muted-foreground font-normal"> (opcional)</span>
              )}
            </Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                reasonRequired
                  ? 'Explica brevemente el motivo (mínimo 3 caracteres)'
                  : 'Comentario opcional'
              }
              rows={2}
            />
            {reasonRequired && reason.length > 0 && reason.trim().length < 3 && (
              <p className="text-[11px] text-destructive">
                Motivo demasiado corto.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? 'Aplicando…' : 'Aplicar corrección'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
