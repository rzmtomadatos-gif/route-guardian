import type { SegmentStatus } from '@/types/route';

const config: Record<SegmentStatus, { label: string; className: string }> = {
  pendiente: { label: 'Pendiente', className: 'status-pending' },
  en_progreso: { label: 'En progreso', className: 'status-in-progress' },
  completado: { label: 'Completado', className: 'status-completed' },
  posible_repetir: { label: 'Posible repetir', className: 'bg-amber-500/20 text-amber-400 border border-amber-500/30' },
};

interface Props {
  status: SegmentStatus;
  nonRecordable?: boolean;
  needsRepeat?: boolean;
}

export function StatusBadge({ status, nonRecordable, needsRepeat }: Props) {
  // nonRecordable overrides everything → black badge
  if (nonRecordable) {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-800 text-zinc-300 border border-zinc-600">
        No grabable
      </span>
    );
  }
  // needsRepeat → yellow/warning badge (NOT black)
  if (needsRepeat) {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30">
        Repetir
      </span>
    );
  }
  const { label, className } = config[status];
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}
