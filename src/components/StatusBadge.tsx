import type { SegmentStatus } from '@/types/route';

const config: Record<SegmentStatus, { label: string; className: string }> = {
  pendiente: { label: 'Pendiente', className: 'status-pending' },
  en_progreso: { label: 'En progreso', className: 'status-in-progress' },
  completado: { label: 'Completado', className: 'status-completed' },
};

export function StatusBadge({ status }: { status: SegmentStatus }) {
  const { label, className } = config[status];
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}
