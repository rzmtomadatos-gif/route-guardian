/**
 * Listado de tramos para el modo gabinete.
 *
 * Muestra valores consolidados (no base). Click en una fila abre la ficha.
 * Render directo con paginación de 100 (virtualización queda para fase 4).
 */

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Pencil } from 'lucide-react';
import type { Segment } from '@/types/route';
import { useSegmentCorrections } from '@/hooks/useSegmentCorrections';

interface Props {
  segments: Segment[];
  onOpen: (segment: Segment) => void;
}

const PAGE_SIZE = 100;

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'completado':
      return 'bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30';
    case 'en_progreso':
      return 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30';
    case 'posible_repetir':
      return 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'completado':
      return 'Completado';
    case 'en_progreso':
      return 'En progreso';
    case 'posible_repetir':
      return 'Posible repetir';
    case 'pendiente':
      return 'Pendiente';
    default:
      return status;
  }
}

export function GabineteSegmentsTable({ segments, onOpen }: Props) {
  const { getConsolidatedSegment, getActiveCorrections } = useSegmentCorrections();
  const [page, setPage] = useState(0);

  const rows = useMemo(
    () =>
      segments.map((s) => {
        const consolidated = getConsolidatedSegment(s);
        const activeCount = getActiveCorrections(s.id).length;
        return { base: s, consolidated, activeCount };
      }),
    [segments, getConsolidatedSegment, getActiveCorrections],
  );

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * PAGE_SIZE;
  const visible = rows.slice(start, start + PAGE_SIZE);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">
          No hay tramos que coincidan con los filtros aplicados.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 border-b border-border">
              <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="py-2 px-2">ID empresa</th>
                <th className="py-2 px-2">Nombre</th>
                <th className="py-2 px-2 text-center">Día</th>
                <th className="py-2 px-2 text-center">Track</th>
                <th className="py-2 px-2 text-center">#</th>
                <th className="py-2 px-2">Estado</th>
                <th className="py-2 px-2 text-center">Correcc.</th>
                <th className="py-2 px-2"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ base, consolidated, activeCount }) => (
                <tr
                  key={base.id}
                  onClick={() => onOpen(base)}
                  className="border-b border-border/40 last:border-0 hover:bg-muted/40 cursor-pointer transition-colors"
                >
                  <td className="py-2 px-2 font-mono text-[11px] text-muted-foreground">
                    {consolidated.companySegmentId ?? '—'}
                  </td>
                  <td className="py-2 px-2 text-foreground max-w-[280px] truncate">
                    {consolidated.name || '(sin nombre)'}
                  </td>
                  <td className="py-2 px-2 text-center">
                    {consolidated.workDay ?? '—'}
                  </td>
                  <td className="py-2 px-2 text-center">
                    {consolidated.trackNumber ?? '—'}
                  </td>
                  <td className="py-2 px-2 text-center">
                    {consolidated.segmentOrder ?? '—'}
                  </td>
                  <td className="py-2 px-2">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border ${statusBadgeClass(consolidated.status)}`}
                    >
                      {statusLabel(consolidated.status)}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-center">
                    {activeCount > 0 ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border bg-primary/15 text-primary border-primary/30">
                        {activeCount}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-right">
                    <Pencil className="w-3.5 h-3.5 text-muted-foreground inline" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {start + 1}–{Math.min(start + PAGE_SIZE, rows.length)} de {rows.length}
          </span>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <span className="px-2">
              Página {safePage + 1} / {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
