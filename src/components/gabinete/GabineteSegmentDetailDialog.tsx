/**
 * Ficha de gabinete de un tramo: 3 bloques claramente separados.
 *
 * A. Dato original de campo (read-only, lee `segment` directo)
 * B. Consolidado actual (mismos campos con valores efectivos + acción Corregir)
 * C. Historial de correcciones (con acción Revertir en activas)
 */

import { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Pencil, Undo2 } from 'lucide-react';
import type { Segment, SegmentCorrection, CorrectableField } from '@/types/route';
import { getFieldLabel, formatCorrectionValue } from '@/utils/gabinete/field-labels';
import { readFieldFromSegment } from '@/utils/gabinete/consolidate';
import { useSegmentCorrections } from '@/hooks/useSegmentCorrections';
import { CorrectionApplyDialog } from './CorrectionApplyDialog';
import { CorrectionRevertDialog } from './CorrectionRevertDialog';

interface Props {
  open: boolean;
  segment: Segment | null;
  onClose: () => void;
}

/** Orden de campos a mostrar en las tablas A y B. */
const DISPLAY_FIELDS: CorrectableField[] = [
  'companySegmentId',
  'name',
  'workDay',
  'trackNumber',
  'segmentOrder',
  'status',
  'needsRepeat',
  'nonRecordable',
  'invalidatedByTrack',
  'repeatNumber',
  'direction',
  'type',
  'kmlId',
  'notes',
  'kmlMeta.carretera',
  'kmlMeta.identtramo',
  'kmlMeta.tipo',
  'kmlMeta.calzada',
  'kmlMeta.sentido',
  'kmlMeta.pkInicial',
  'kmlMeta.pkFinal',
];

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function getCorrectionStatus(c: SegmentCorrection): {
  label: string;
  className: string;
} {
  if (c.revertedAt) {
    return {
      label: 'revertida',
      className: 'bg-destructive/15 text-destructive border-destructive/30',
    };
  }
  if (!c.active && c.supersededBy) {
    return {
      label: 'superseded',
      className: 'bg-muted text-muted-foreground border-border',
    };
  }
  if (c.active) {
    return {
      label: 'activa',
      className: 'bg-primary/15 text-primary border-primary/30',
    };
  }
  return {
    label: 'inactiva',
    className: 'bg-muted text-muted-foreground border-border',
  };
}

export function GabineteSegmentDetailDialog({ open, segment, onClose }: Props) {
  const {
    getSegmentCorrections,
    getActiveCorrections,
    getConsolidatedSegment,
    isFieldCorrected,
  } = useSegmentCorrections();

  const [editField, setEditField] = useState<CorrectableField | null>(null);
  const [revertTarget, setRevertTarget] = useState<SegmentCorrection | null>(null);

  const consolidated = useMemo(
    () => (segment ? getConsolidatedSegment(segment) : null),
    [segment, getConsolidatedSegment],
  );
  const corrections = useMemo(
    () => (segment ? getSegmentCorrections(segment.id) : []),
    [segment, getSegmentCorrections],
  );
  const activeBySeg = useMemo(
    () => (segment ? getActiveCorrections(segment.id) : []),
    [segment, getActiveCorrections],
  );

  if (!segment || !consolidated) return null;

  // Historial: descendiente por fecha
  const historyDesc = [...corrections].sort((a, b) =>
    b.correctedAt.localeCompare(a.correctedAt),
  );

  const editCurrentValue =
    editField !== null ? readFieldFromSegment(consolidated, editField) : undefined;

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              <span>{consolidated.name || 'Tramo sin nombre'}</span>
              {consolidated.companySegmentId && (
                <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                  {consolidated.companySegmentId}
                </span>
              )}
            </DialogTitle>
            <DialogDescription>
              Modo gabinete · {activeBySeg.length} corrección{activeBySeg.length === 1 ? '' : 'es'} activa{activeBySeg.length === 1 ? '' : 's'} · {corrections.length} total
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Bloque A — Dato original de campo */}
            <section className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
              <header className="flex items-center justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  A · Dato original de campo
                </h3>
                <span className="text-[10px] text-muted-foreground">
                  Solo lectura
                </span>
              </header>
              <table className="w-full text-xs">
                <tbody>
                  {DISPLAY_FIELDS.map((f) => (
                    <tr key={`orig-${f}`} className="border-b border-border/40 last:border-0">
                      <td className="py-1 pr-2 text-muted-foreground w-[40%]">
                        {getFieldLabel(f)}
                      </td>
                      <td className="py-1 text-foreground">
                        {formatCorrectionValue(readFieldFromSegment(segment, f))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {/* Bloque B — Consolidado actual */}
            <section className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
              <header className="flex items-center justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                  B · Consolidado actual
                </h3>
                <span className="text-[10px] text-muted-foreground">
                  Valor efectivo · botón "Corregir" por fila
                </span>
              </header>
              <table className="w-full text-xs">
                <tbody>
                  {DISPLAY_FIELDS.map((f) => {
                    const corrected = isFieldCorrected(segment.id, f);
                    const consolidatedVal = readFieldFromSegment(consolidated, f);
                    const baseVal = readFieldFromSegment(segment, f);
                    return (
                      <tr key={`cons-${f}`} className="border-b border-border/40 last:border-0">
                        <td className="py-1 pr-2 text-muted-foreground w-[40%]">
                          {getFieldLabel(f)}
                        </td>
                        <td className="py-1 text-foreground">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={corrected ? 'font-medium text-primary' : ''}>
                              {formatCorrectionValue(consolidatedVal)}
                            </span>
                            {corrected && (
                              <>
                                <span className="text-[10px] px-1.5 py-0.5 rounded border bg-primary/15 text-primary border-primary/30">
                                  corregido
                                </span>
                                <span className="text-[11px] text-muted-foreground line-through">
                                  {formatCorrectionValue(baseVal)}
                                </span>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="py-1 text-right w-[80px]">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            onClick={() => setEditField(f)}
                          >
                            <Pencil className="w-3 h-3 mr-1" />
                            Corregir
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>

            {/* Bloque C — Historial de correcciones */}
            <section className="rounded-lg border border-border bg-secondary/40 p-3 space-y-2">
              <header className="flex items-center justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  C · Historial de correcciones
                </h3>
                <span className="text-[10px] text-muted-foreground">
                  {historyDesc.length} entrada{historyDesc.length === 1 ? '' : 's'}
                </span>
              </header>
              {historyDesc.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-2">
                  Sin correcciones registradas para este tramo.
                </p>
              ) : (
                <ul className="space-y-2">
                  {historyDesc.map((c) => {
                    const status = getCorrectionStatus(c);
                    const canRevert = c.active && !c.revertedAt;
                    return (
                      <li
                        key={c.id}
                        className="text-xs border-l-2 border-border pl-2 py-1 space-y-0.5"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-foreground">
                            {getFieldLabel(c.field)}:
                          </span>
                          <span className="text-muted-foreground">
                            {formatCorrectionValue(c.previousValue)}
                          </span>
                          <span className="text-muted-foreground">→</span>
                          <span className="text-foreground">
                            {formatCorrectionValue(c.newValue)}
                          </span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded border ${status.className}`}
                          >
                            {status.label}
                          </span>
                          {canRevert && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 ml-auto text-destructive hover:text-destructive"
                              onClick={() => setRevertTarget(c)}
                            >
                              <Undo2 className="w-3 h-3 mr-1" />
                              Revertir
                            </Button>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {c.correctedBy} · {formatDate(c.correctedAt)}
                          {c.reason && (
                            <>
                              {' · '}
                              <span className="italic">"{c.reason}"</span>
                            </>
                          )}
                        </div>
                        {c.revertedAt && (
                          <div className="text-[10px] text-destructive">
                            Revertida {formatDate(c.revertedAt)}
                            {c.revertedBy && ` por ${c.revertedBy}`}
                            {c.revertReason && (
                              <>
                                {' · '}
                                <span className="italic">"{c.revertReason}"</span>
                              </>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </DialogContent>
      </Dialog>

      <CorrectionApplyDialog
        open={editField !== null}
        segment={segment}
        field={editField}
        currentValue={editCurrentValue}
        onClose={() => setEditField(null)}
      />

      <CorrectionRevertDialog
        open={revertTarget !== null}
        correction={revertTarget}
        onClose={() => setRevertTarget(null)}
      />
    </>
  );
}
