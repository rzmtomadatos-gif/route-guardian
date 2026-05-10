/**
 * Vista plana de tramos en modo TRIMBLE_LIDAR para SegmentsPage.
 *
 * No reemplaza la lógica RST/Garmin: solo se renderiza cuando
 * `acquisitionMode === 'TRIMBLE_LIDAR'`. Muestra columnas operativas
 * Trimble (intentos, última misión/pasada, fecha de última captura,
 * entregables) y permite filtrar por estado Trimble.
 */
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, MapPin, Pencil } from 'lucide-react';
import type { AppState, Segment } from '@/types/route';
import {
  TRIMBLE_FIELD_STATUSES,
  TRIMBLE_QA_STATUSES,
  type TrimbleSegmentStatus,
} from '@/types/trimble';
import { deriveTrimbleSegmentStatus } from '@/utils/trimble/recording-queue';
import { buildTrimbleSegmentSummary } from '@/utils/trimble/segment-summary';

const PAGE_SIZE = 100;

const STATUS_LABEL: Record<TrimbleSegmentStatus, string> = {
  pendiente: 'Pendiente',
  en_captura: 'En captura',
  capturado_pendiente_proceso: 'Capturado',
  procesado_ok: 'QA OK',
  procesado_con_observaciones: 'QA c/notas',
  repetir: 'Repetir',
  no_capturable: 'No capturable',
  descartado_por_calidad: 'Descartado',
};

const STATUS_CLASS: Record<TrimbleSegmentStatus, string> = {
  pendiente: 'bg-muted text-muted-foreground border-border',
  en_captura: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
  capturado_pendiente_proceso: 'bg-cyan-500/15 text-cyan-600 border-cyan-500/30',
  procesado_ok: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
  procesado_con_observaciones: 'bg-lime-500/15 text-lime-700 border-lime-500/30',
  repetir: 'bg-orange-500/15 text-orange-600 border-orange-500/30',
  no_capturable: 'bg-zinc-700/30 text-zinc-300 border-zinc-600/40',
  descartado_por_calidad: 'bg-destructive/15 text-destructive border-destructive/30',
};

const ALL_STATUSES: TrimbleSegmentStatus[] = [
  'pendiente',
  ...TRIMBLE_FIELD_STATUSES.filter((s) => s !== 'no_capturable'),
  'no_capturable',
  ...TRIMBLE_QA_STATUSES,
];

type StatusFilter = TrimbleSegmentStatus | 'todos';

interface Props {
  state: AppState;
  segments: Segment[];
  onEditSegment: (s: Segment) => void;
  onViewOnMap: (segId: string) => void;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-ES', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

export function TrimbleSegmentsTable({ state, segments, onEditSegment, onViewOnMap }: Props) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todos');
  const [page, setPage] = useState(0);

  const captures = state.trimbleSegmentCaptures ?? [];
  const missions = state.trimbleMissions ?? [];
  const runs = state.trimbleRuns ?? [];
  const deliverables = state.trimbleDeliverables ?? [];
  const activeRunId = state.activeRunId;

  const rows = useMemo(() => {
    return segments.map((seg) => {
      const status = deriveTrimbleSegmentStatus(seg.id, captures, activeRunId);
      const summary = buildTrimbleSegmentSummary(seg.id, captures, missions, runs, deliverables);
      return { seg, status, summary };
    });
  }, [segments, captures, missions, runs, deliverables, activeRunId]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { todos: rows.length };
    for (const s of ALL_STATUSES) c[s] = 0;
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    if (statusFilter === 'todos') return rows;
    return rows.filter((r) => r.status === statusFilter);
  }, [rows, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);

  return (
    <div className="flex flex-col h-full">
      {/* Trimble status filter chips */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-border bg-card/60 overflow-x-auto">
        <div className="flex gap-1 items-center min-w-max">
          <button
            onClick={() => { setStatusFilter('todos'); setPage(0); }}
            className={`px-2 py-1 rounded text-[10px] font-medium ${
              statusFilter === 'todos'
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-muted-foreground hover:text-foreground'
            }`}
          >
            Todos ({counts.todos})
          </button>
          {ALL_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setPage(0); }}
              className={`px-2 py-1 rounded text-[10px] font-medium border ${
                statusFilter === s
                  ? STATUS_CLASS[s] + ' ring-1 ring-current'
                  : 'bg-secondary text-muted-foreground border-transparent hover:text-foreground'
              }`}
              title={STATUS_LABEL[s]}
            >
              {STATUS_LABEL[s]} ({counts[s] ?? 0})
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {visible.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            No hay tramos que coincidan con el filtro Trimble seleccionado.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-muted/60 border-b border-border sticky top-0 z-10">
              <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="py-2 px-2">ID</th>
                <th className="py-2 px-2">Nombre</th>
                <th className="py-2 px-2">Estado Trimble</th>
                <th className="py-2 px-2 text-center">Intentos</th>
                <th className="py-2 px-2 text-center">Últ. misión (Día)</th>
                <th className="py-2 px-2 text-center">Últ. pasada</th>
                <th className="py-2 px-2">Últ. captura</th>
                <th className="py-2 px-2 text-center">Entreg.</th>
                <th className="py-2 px-2"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ seg, status, summary }) => (
                <tr
                  key={seg.id}
                  className="border-b border-border/40 last:border-0 hover:bg-muted/40 transition-colors"
                >
                  <td className="py-1.5 px-2 font-mono text-[11px] text-muted-foreground">
                    {seg.companySegmentId ?? '—'}
                  </td>
                  <td className="py-1.5 px-2 max-w-[260px] truncate">
                    {seg.name || '(sin nombre)'}
                  </td>
                  <td className="py-1.5 px-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${STATUS_CLASS[status]}`}>
                      {STATUS_LABEL[status]}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-center font-mono">{summary.attempts}</td>
                  <td className="py-1.5 px-2 text-center">
                    {summary.lastMissionWorkDay ?? '—'}
                  </td>
                  <td className="py-1.5 px-2 text-center">
                    {summary.lastRunIndex !== null ? `#${summary.lastRunIndex}` : '—'}
                  </td>
                  <td className="py-1.5 px-2 font-mono text-[10px]">
                    {formatDate(summary.lastCaptureAt)}
                  </td>
                  <td className="py-1.5 px-2 text-center">
                    {summary.deliverableCount > 0 ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border bg-primary/15 text-primary border-primary/30">
                        {summary.deliverableCount}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-1.5 px-2 text-right whitespace-nowrap">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={() => onViewOnMap(seg.id)}
                      title="Ver en mapa"
                    >
                      <MapPin className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={() => onEditSegment(seg)}
                      title="Editar"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex-shrink-0 flex items-center justify-between text-xs text-muted-foreground px-3 py-1.5 border-t border-border">
          <span>
            {start + 1}–{Math.min(start + PAGE_SIZE, filtered.length)} de {filtered.length}
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
              {safePage + 1} / {totalPages}
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
