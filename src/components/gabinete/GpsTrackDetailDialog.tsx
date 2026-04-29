/**
 * Diálogo de detalle de un track GPS:
 *  - cabecera Día X · Track Y
 *  - métricas resumen
 *  - mapa con polilíneas, marcadores de tramo legibles e incidencias
 *  - leyenda visual
 *  - tabla detallada de tramos grabados con métricas operativas
 *  - cualquier fila o marcador de tramo abre la ficha de gabinete
 */

import { useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Activity, AlertTriangle, MapPin } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Incident, Segment, TrackGpsPoint } from '@/types/route';
import {
  computeTrackGpsMetrics,
  computeTrackGpsSegmentRows,
  filterIncidentsForTrack,
} from '@/utils/gabinete/track-gps-derived';
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
  /** Incidencias de la campaña; se filtran por día/track aquí. */
  incidents?: Incident[];
  /** Abrir ficha de gabinete del tramo dado (si existe). */
  onOpenSegment?: (segmentId: string) => void;
  /**
   * Resolver opcional para obtener el segmento *consolidado* asociado a una
   * incidencia antigua sin `workDayAtIncident`. Si se omite, el filtro caerá
   * al lookup por `id` dentro de `allSegments` (datos crudos).
   */
  resolveConsolidatedSegment?: (segmentId: string) => Segment | undefined;
}

function formatMeters(m: number | null | undefined): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return '—';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

function formatSeconds(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return '—';
  const total = Math.max(0, Math.floor(s));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function GpsTrackDetailDialog({
  open,
  onClose,
  day,
  track,
  points,
  allSegments,
  incidents,
  onOpenSegment,
}: Props) {
  const metrics = useMemo(() => computeTrackGpsMetrics(points), [points]);

  const segmentsById = useMemo(() => {
    const m = new Map<string, Segment>();
    allSegments.forEach((s) => m.set(s.id, s));
    return m;
  }, [allSegments]);

  const segmentRows = useMemo(
    () => computeTrackGpsSegmentRows(points, allSegments),
    [points, allSegments],
  );

  const trackIncidents = useMemo(() => {
    if (day === null || track === null) return [];
    return filterIncidentsForTrack(incidents, day, track);
  }, [incidents, day, track]);

  if (day === null || track === null) return null;

  const handleOpen = (segmentId: string) => {
    if (!onOpenSegment) return;
    if (!segmentsById.has(segmentId)) return; // fallback controlado
    onOpenSegment(segmentId);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-y-auto p-4">
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
                <GpsTrackMap
                  points={points}
                  segmentsById={segmentsById}
                  incidents={trackIncidents}
                  onOpenSegment={handleOpen}
                  className="h-full"
                />
              </div>

              {/* Leyenda */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                <LegendItem color="hsl(38 95% 50%)" label="Grabación" solid />
                <LegendItem color="hsl(174 72% 40%)" label="Transporte" dashed />
                <LegendItem color="hsl(142 76% 36%)" label="Inicio (I)" dot />
                <LegendItem color="hsl(0 84% 60%)" label="Fin (F)" dot />
                <LegendItem color="hsl(38 95% 55%)" label="Inicio de tramo" dot />
                <LegendItem color="hsl(0 84% 55%)" label="Incidencia crítica" dot />
                <LegendItem color="hsl(32 95% 55%)" label="Incidencia no grabable" dot />
                <LegendItem color="hsl(210 35% 65%)" label="Incidencia informativa" dot />
              </div>

              {/* Tabla detallada de tramos grabados */}
              <div className="space-y-1.5">
                <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-primary" />
                  Tramos grabados en este track
                  <span className="text-muted-foreground font-normal">
                    ({segmentRows.length})
                  </span>
                </h4>
                {segmentRows.length === 0 ? (
                  <div className="rounded border border-dashed border-border/60 py-3 text-center text-[11px] text-muted-foreground flex items-center justify-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" />
                    No se detectaron tramos en grabación dentro de este track.
                  </div>
                ) : (
                  <div className="rounded-md border border-border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="h-9 text-xs">ID empresa / nombre</TableHead>
                          <TableHead className="h-9 text-xs text-right">Pts</TableHead>
                          <TableHead className="h-9 text-xs text-right">Distancia grabada</TableHead>
                          <TableHead className="h-9 text-xs text-right">Track→inicio</TableHead>
                          <TableHead className="h-9 text-xs text-right">Track→fin</TableHead>
                          <TableHead className="h-9 text-xs text-right">Seg. inicio</TableHead>
                          <TableHead className="h-9 text-xs text-right">Seg. fin</TableHead>
                          <TableHead className="h-9 text-xs text-right">Garmin in/out</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {segmentRows.map((r) => {
                          const clickable = r.segmentExists && !!onOpenSegment;
                          return (
                            <TableRow
                              key={r.segmentId}
                              className={clickable ? 'cursor-pointer hover:bg-muted/40' : 'opacity-80'}
                              onClick={() => clickable && handleOpen(r.segmentId)}
                              title={
                                clickable
                                  ? 'Abrir ficha de gabinete'
                                  : !r.segmentExists
                                    ? 'Tramo no presente en la campaña actual'
                                    : undefined
                              }
                            >
                              <TableCell className="py-2 text-xs">
                                <div className="flex flex-col min-w-0">
                                  <span className="font-medium text-foreground truncate flex items-center gap-1">
                                    {!r.segmentExists && (
                                      <AlertTriangle className="w-3 h-3 text-destructive shrink-0" />
                                    )}
                                    {r.displayId}
                                  </span>
                                  {r.name && r.name !== r.displayId && (
                                    <span className="text-[10px] text-muted-foreground truncate">
                                      {r.displayName}
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="py-2 text-xs text-right tabular-nums">
                                {r.pointCount}
                              </TableCell>
                              <TableCell className="py-2 text-xs text-right tabular-nums text-primary">
                                {formatMeters(r.recordingDistanceMeters)}
                              </TableCell>
                              <TableCell className="py-2 text-xs text-right tabular-nums">
                                {formatMeters(r.trackDistanceAtStartMeters)}
                              </TableCell>
                              <TableCell className="py-2 text-xs text-right tabular-nums">
                                {formatMeters(r.trackDistanceAtEndMeters)}
                              </TableCell>
                              <TableCell className="py-2 text-xs text-right tabular-nums">
                                {formatSeconds(r.secondsFromTrackStartToSegmentStart)}
                              </TableCell>
                              <TableCell className="py-2 text-xs text-right tabular-nums">
                                {formatSeconds(r.secondsFromTrackStartToSegmentEnd)}
                              </TableCell>
                              <TableCell className="py-2 text-xs text-right tabular-nums text-muted-foreground">
                                {r.segmentStartSeconds !== null || r.segmentEndSeconds !== null
                                  ? `${formatSeconds(r.segmentStartSeconds)} / ${formatSeconds(r.segmentEndSeconds)}`
                                  : '—'}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              {/* Resumen incidencias del track */}
              {trackIncidents.length > 0 && (
                <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
                  {trackIncidents.length} incidencia{trackIncidents.length === 1 ? '' : 's'} geolocalizada{trackIncidents.length === 1 ? '' : 's'} en este track.
                </div>
              )}
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
