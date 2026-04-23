/**
 * Tarjeta compacta con métricas resumen de un track GPS.
 * Usada en la cabecera del diálogo de detalle.
 */

import { Activity, Clock, MapPin, Route as RouteIcon } from 'lucide-react';
import type { TrackGpsMetrics } from '@/utils/gabinete/track-gps-derived';

interface Props {
  day: number;
  track: number;
  metrics: TrackGpsMetrics;
}

function formatMeters(m: number): string {
  if (!Number.isFinite(m) || m <= 0) return '0 m';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

export function GpsTrackSummaryCard({ day, track, metrics }: Props) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold text-foreground">
          Día {day} · Track {track}
        </h3>
        <span className="text-[11px] text-muted-foreground">
          {metrics.pointCount} punto{metrics.pointCount === 1 ? '' : 's'}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <Metric
          icon={<RouteIcon className="w-3.5 h-3.5" />}
          label="Distancia total"
          value={formatMeters(metrics.totalDistanceMeters)}
        />
        <Metric
          icon={<Activity className="w-3.5 h-3.5 text-emerald-500" />}
          label="Grabando"
          value={formatMeters(metrics.recordingDistanceMeters)}
          sub={formatDuration(metrics.recordingTimeMs)}
        />
        <Metric
          icon={<MapPin className="w-3.5 h-3.5 text-sky-500" />}
          label="Transporte"
          value={formatMeters(metrics.transportDistanceMeters)}
          sub={formatDuration(metrics.transportTimeMs)}
        />
        <Metric
          icon={<Clock className="w-3.5 h-3.5" />}
          label="Tiempo total"
          value={formatDuration(metrics.totalTimeMs)}
          sub={`${metrics.distinctSegmentCount} tramo${metrics.distinctSegmentCount === 1 ? '' : 's'}`}
        />
      </div>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded border border-border/60 bg-background/40 px-2 py-1.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-sm font-semibold text-foreground leading-tight">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
