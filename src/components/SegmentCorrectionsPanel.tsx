/**
 * Panel de inspección de correcciones de gabinete sobre un tramo.
 *
 * Solo lectura (Sub-bloque 2). La edición/reversión llegará desde la
 * página `/gabinete` (Sub-bloque 3+).
 *
 * Reglas:
 *  - Solo se renderiza para roles `admin` y `gabinete`.
 *  - Si el tramo no tiene correcciones, no renderiza nada.
 *  - Etiquetas humanas en español (vía `field-labels.ts`).
 */

import { useUserRole } from '@/hooks/useUserRole';
import { useSegmentCorrections } from '@/hooks/useSegmentCorrections';
import { getFieldLabel, formatCorrectionValue } from '@/utils/gabinete/field-labels';
import type { SegmentCorrection } from '@/types/route';

interface Props {
  segmentId: string;
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

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function SegmentCorrectionsPanel({ segmentId }: Props) {
  const { role } = useUserRole();
  const { getSegmentCorrections } = useSegmentCorrections();

  // Gate por rol — operator no debe ver este panel ni siquiera vacío.
  if (role !== 'admin' && role !== 'gabinete') return null;

  const corrections = getSegmentCorrections(segmentId);
  if (corrections.length === 0) return null;

  return (
    <div className="bg-secondary/40 rounded-lg p-3 space-y-2 border border-border">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
          Correcciones de gabinete
        </p>
        <span className="text-[10px] text-muted-foreground">
          {corrections.length} total
        </span>
      </div>
      <ul className="space-y-1.5">
        {corrections.map((c) => {
          const status = getCorrectionStatus(c);
          return (
            <li
              key={c.id}
              className="text-xs space-y-0.5 border-l-2 border-border pl-2"
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
    </div>
  );
}
