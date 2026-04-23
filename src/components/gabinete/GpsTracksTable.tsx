/**
 * Tabla de tracks GPS de un día concreto, con métricas resumen y acción
 * "Ver mapa" que abre el detalle.
 */

import { useMemo } from 'react';
import { Map as MapIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { TrackGpsPoint } from '@/types/route';
import {
  computeTrackGpsMetrics,
  listAvailableTracks,
} from '@/utils/gabinete/track-gps-derived';

interface Props {
  day: number;
  logsByDay: Record<number, Record<number, TrackGpsPoint[]>>;
  onOpen: (day: number, track: number) => void;
}

function formatMeters(m: number): string {
  if (!Number.isFinite(m) || m <= 0) return '0 m';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

export function GpsTracksTable({ day, logsByDay, onOpen }: Props) {
  const rows = useMemo(() => {
    const tracks = listAvailableTracks(logsByDay).filter((t) => t.day === day);
    return tracks.map((t) => {
      const points = logsByDay[t.day]?.[t.track] ?? [];
      const metrics = computeTrackGpsMetrics(points);
      return { day: t.day, track: t.track, metrics };
    });
  }, [logsByDay, day]);

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
        No hay tracks GPS registrados para el día {day}.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-9 text-xs">Día</TableHead>
            <TableHead className="h-9 text-xs">Track</TableHead>
            <TableHead className="h-9 text-xs text-right">Nº puntos</TableHead>
            <TableHead className="h-9 text-xs text-right">Distancia total</TableHead>
            <TableHead className="h-9 text-xs text-right">Grabando</TableHead>
            <TableHead className="h-9 text-xs text-right">Transporte</TableHead>
            <TableHead className="h-9 text-xs text-right">Tramos</TableHead>
            <TableHead className="h-9 text-xs text-right">Acción</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ day: d, track, metrics }) => (
            <TableRow key={`${d}-${track}`} className="hover:bg-muted/30">
              <TableCell className="py-2 text-xs">{d}</TableCell>
              <TableCell className="py-2 text-xs font-medium">{track}</TableCell>
              <TableCell className="py-2 text-xs text-right tabular-nums">
                {metrics.pointCount}
              </TableCell>
              <TableCell className="py-2 text-xs text-right tabular-nums">
                {formatMeters(metrics.totalDistanceMeters)}
              </TableCell>
              <TableCell className="py-2 text-xs text-right tabular-nums text-primary">
                {formatMeters(metrics.recordingDistanceMeters)}
              </TableCell>
              <TableCell className="py-2 text-xs text-right tabular-nums text-accent">
                {formatMeters(metrics.transportDistanceMeters)}
              </TableCell>
              <TableCell className="py-2 text-xs text-right tabular-nums">
                {metrics.distinctSegmentCount}
              </TableCell>
              <TableCell className="py-2 text-right">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={() => onOpen(d, track)}
                >
                  <MapIcon className="w-3.5 h-3.5 mr-1" />
                  Ver mapa
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
