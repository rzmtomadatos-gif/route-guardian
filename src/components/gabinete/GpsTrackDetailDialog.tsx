/**
 * Diálogo de detalle de un track GPS:
 *  - cabecera Día X · Track Y
 *  - métricas resumen
 *  - mapa con polilíneas transport/recording
 *  - leyenda visual
 *  - lista de tramos asociados detectados desde segmentId en puntos recording
 */

import { useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Activity, MapPin } from 'lucide-react';
import type { Segment, TrackGpsPoint } from '@/types/route';
import { computeTrackGpsMetrics } from '@/utils/gabinete/track-gps-derived';
import { GpsTrackSummaryCard } from './GpsTrackSummaryCard';
import { GpsTrackMap } from './GpsTrackMap';

interface Props {
  open: boolean;
  onClose: () => void;
  day: number | null;
  track: number | null;
  points: TrackGpsPoint[];
  /** Catálogo completo de segmentos para resolver nombres por ID. */
  allSegments: Segment[];
}

export function GpsTrackDetailDialog({
  open,
  onClose,
  day,
  track,
  points,
  allSegments,
}: Props) {
  const metrics = useMemo(() => computeTrackGpsMetrics(points), [points]);

  const segmentNameById = useMemo(() => {
    const m = new Map<string, string>();
    allSegments.forEach((s) => {
      m.set(s.id, s.name || s.companySegmentId || s.kmlId || s.id);
    });
    return m;
  }, [allSegments]);

  const recordedRows = useMemo(() => {
    return metrics.recordedSegmentIds.map((id) => ({
      segmentId: id,
      name: segmentNameById.get(id) ?? '(tramo no encontrado)',
      pointCount: metrics.pointsBySegmentId[id] ?? 0,
    }));
  }, [metrics.recordedSegmentIds, metrics.pointsBySegmentId, segmentNameById]);

  if (day === null || track === null) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] overflow-y-auto p-4">
        <DialogHeader className="space-y-0">
          <DialogTitle className="text-base">
            Detalle de track GPS
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          <GpsTrackSummaryCard day={day} track={track} metrics={metrics} />

          {points.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/60 py-12 text-center text-sm text-muted-foreground">
              Este track no tiene puntos GPS registrados.
            </div>
          ) : (
            <>
              <div className="h-[55vh] min-h-[320px] relative">
                <GpsTrackMap points={points} className="h-full" />
              </div>

              {/* Leyenda */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                <LegendItem color="hsl(38 95% 50%)" label="Grabación" solid />
                <LegendItem color="hsl(174 72% 40%)" label="Transporte" dashed />
                <LegendItem color="hsl(142 76% 36%)" label="Inicio (I)" dot />
                <LegendItem color="hsl(0 84% 60%)" label="Fin (F)" dot />
                <LegendItem color="hsl(210 20% 95%)" label="Inicio de tramo" dot />
              </div>

              {/* Tramos asociados */}
              <div className="space-y-1.5">
                <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-primary" />
                  Tramos grabados en este track
                  <span className="text-muted-foreground font-normal">
                    ({recordedRows.length})
                  </span>
                </h4>
                {recordedRows.length === 0 ? (
                  <div className="rounded border border-dashed border-border/60 py-3 text-center text-[11px] text-muted-foreground flex items-center justify-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" />
                    No se detectaron tramos en grabación dentro de este track.
                  </div>
                ) : (
                  <ul className="rounded-md border border-border divide-y divide-border">
                    {recordedRows.map((r) => (
                      <li
                        key={r.segmentId}
                        className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-foreground">{r.name}</div>
                          <div className="text-[10px] text-muted-foreground font-mono truncate">
                            {r.segmentId}
                          </div>
                        </div>
                        <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                          {r.pointCount} pt{r.pointCount === 1 ? '' : 's'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LegendItem({
  color,
  label,
  solid,
  dashed,
  dot,
}: {
  color: string;
  label: string;
  solid?: boolean;
  dashed?: boolean;
  dot?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {dot ? (
        <span
          className="inline-block w-2.5 h-2.5 rounded-full border border-background"
          style={{ background: color }}
        />
      ) : (
        <span
          className="inline-block w-6 h-1 rounded"
          style={{
            background: color,
            backgroundImage: dashed
              ? `repeating-linear-gradient(to right, ${color} 0 4px, transparent 4px 8px)`
              : undefined,
            backgroundColor: solid ? color : 'transparent',
          }}
        />
      )}
      <span>{label}</span>
    </span>
  );
}
