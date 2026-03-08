import { useState, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ExternalLink, Navigation, Repeat, CheckSquare, ChevronRight } from 'lucide-react';
import { buildDisplayOrderMap } from '@/utils/display-order';
import type { Segment, LatLng, BaseLocation } from '@/types/route';

const MAX_WAYPOINTS = 9; // Google Maps limit: origin + up to ~23 waypoints + dest, but practically 9 segments = 18 points

interface Props {
  segments: Segment[];
  optimizedOrder: string[];
  activeSegmentId: string | null;
  currentPosition: LatLng | null;
  base: BaseLocation | null;
  rstMode: boolean;
  rstGroupSize: number;
  selectedSegmentIds: Set<string>;
  children: React.ReactNode;
}

type ItineraryOption = {
  label: string;
  description: string;
  segmentIds: string[];
};

function buildGoogleMapsUrl(
  segments: Segment[],
  ids: string[],
  currentPosition: LatLng | null,
  base: BaseLocation | null,
): string[] {
  if (ids.length === 0) return [];

  const segs = ids.map((id) => segments.find((s) => s.id === id)).filter(Boolean) as Segment[];
  if (segs.length === 0) return [];

  // Build points: start + end of each segment
  const allPoints: string[] = [];
  for (const seg of segs) {
    const start = seg.coordinates[0];
    const end = seg.coordinates[seg.coordinates.length - 1];
    allPoints.push(`${start.lat},${start.lng}`);
    allPoints.push(`${end.lat},${end.lng}`);
  }

  // Origin: current position > base > first segment start
  const originPoint = currentPosition
    ? `${currentPosition.lat},${currentPosition.lng}`
    : base
      ? `${base.position.lat},${base.position.lng}`
      : allPoints[0];

  // Split into stages if too many points
  // Each stage can have: origin + up to 8 waypoints + destination = 10 points max
  const maxPointsPerStage = MAX_WAYPOINTS * 2; // 18 points per stage
  const stages: string[][] = [];
  
  for (let i = 0; i < allPoints.length; i += maxPointsPerStage) {
    stages.push(allPoints.slice(i, i + maxPointsPerStage));
  }

  return stages.map((stagePoints, idx) => {
    const origin = idx === 0 ? originPoint : stagePoints[0];
    const destination = stagePoints[stagePoints.length - 1];
    const middle = (idx === 0 && origin !== stagePoints[0])
      ? stagePoints.slice(0, -1).join('|')
      : stagePoints.slice(1, -1).join('|');

    let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`;
    if (middle) url += `&waypoints=${middle}`;
    return url;
  });
}

export function GoogleMapsItineraryDialog({
  segments,
  optimizedOrder,
  activeSegmentId,
  currentPosition,
  base,
  rstMode,
  rstGroupSize,
  selectedSegmentIds,
  children,
}: Props) {
  const [open, setOpen] = useState(false);

  const displayOrderMap = useMemo(() => buildDisplayOrderMap(optimizedOrder), [optimizedOrder]);

  const pendingIds = useMemo(() => {
    return optimizedOrder.filter((id) => {
      const seg = segments.find((s) => s.id === id);
      return seg?.status === 'pendiente' || seg?.status === 'en_progreso';
    });
  }, [segments, optimizedOrder]);

  const activeIdx = activeSegmentId ? optimizedOrder.indexOf(activeSegmentId) : -1;

  // Build options
  const normalOptions = useMemo((): ItineraryOption[] => {
    const opts: ItineraryOption[] = [];

    // Next segment
    const nextPending = pendingIds[0];
    if (nextPending) {
      opts.push({
        label: 'Siguiente tramo',
        description: segments.find((s) => s.id === nextPending)?.name || '',
        segmentIds: [nextPending],
      });
    }

    // Next N segments
    if (pendingIds.length > 1) {
      const n = Math.min(6, pendingIds.length);
      opts.push({
        label: `Próximos ${n} tramos`,
        description: `${n} tramos pendientes en orden`,
        segmentIds: pendingIds.slice(0, n),
      });
    }

    // All pending
    if (pendingIds.length > 6) {
      opts.push({
        label: `Todos los pendientes (${pendingIds.length})`,
        description: 'Se dividirá en etapas si es necesario',
        segmentIds: pendingIds,
      });
    }

    // Selected
    if (selectedSegmentIds.size > 0) {
      const selIds = optimizedOrder.filter((id) => selectedSegmentIds.has(id));
      if (selIds.length > 0) {
        opts.push({
          label: `Seleccionados (${selIds.length})`,
          description: 'Solo los tramos seleccionados',
          segmentIds: selIds,
        });
      }
    }

    return opts;
  }, [pendingIds, selectedSegmentIds, optimizedOrder, segments]);

  const rstOptions = useMemo((): ItineraryOption[] => {
    const opts: ItineraryOption[] = [];

    // RST block from active
    if (activeSegmentId && activeIdx >= 0) {
      const blockIds = pendingIds.filter((id) => {
        const idx = optimizedOrder.indexOf(id);
        return idx >= activeIdx;
      }).slice(0, rstGroupSize);
      if (blockIds.length > 0) {
        opts.push({
          label: `Bloque RST actual (×${blockIds.length})`,
          description: `Desde tramo activo`,
          segmentIds: blockIds,
        });
      }
    }

    // RST block from first selected
    if (selectedSegmentIds.size > 0) {
      const firstSel = optimizedOrder.find((id) => selectedSegmentIds.has(id));
      if (firstSel) {
        const startIdx = optimizedOrder.indexOf(firstSel);
        const blockIds = pendingIds.filter((id) => {
          const idx = optimizedOrder.indexOf(id);
          return idx >= startIdx;
        }).slice(0, rstGroupSize);
        if (blockIds.length > 0) {
          opts.push({
            label: `Bloque RST desde selección (×${blockIds.length})`,
            description: `Desde ${segments.find((s) => s.id === firstSel)?.name || ''}`,
            segmentIds: blockIds,
          });
        }
      }
    }

    // RST next block
    const nextBlockIds = pendingIds.slice(0, rstGroupSize);
    if (nextBlockIds.length > 0) {
      opts.push({
        label: `Bloque RST siguiente (×${nextBlockIds.length})`,
        description: 'Primeros pendientes',
        segmentIds: nextBlockIds,
      });
    }

    return opts;
  }, [activeSegmentId, activeIdx, pendingIds, rstGroupSize, selectedSegmentIds, optimizedOrder, segments]);

  const handleSelect = (ids: string[]) => {
    const urls = buildGoogleMapsUrl(segments, ids, currentPosition, base);
    if (urls.length === 1) {
      window.open(urls[0], '_blank');
      setOpen(false);
    } else if (urls.length > 1) {
      // Show stage buttons
      setStageUrls(urls);
    }
  };

  const [stageUrls, setStageUrls] = useState<string[]>([]);

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setStageUrls([]); }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <ExternalLink className="w-4 h-4" />
            Abrir itinerario en Google Maps
          </DialogTitle>
        </DialogHeader>

        {stageUrls.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              La ruta se ha dividido en {stageUrls.length} etapas por el límite de waypoints.
            </p>
            {stageUrls.map((url, i) => (
              <Button
                key={i}
                variant="outline"
                className="w-full justify-between h-11"
                onClick={() => window.open(url, '_blank')}
              >
                <span>Etapa {i + 1}</span>
                <ChevronRight className="w-4 h-4" />
              </Button>
            ))}
            <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setStageUrls([])}>
              ← Volver
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Normal mode */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                <Navigation className="w-3 h-3" /> Normal
              </p>
              {normalOptions.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => handleSelect(opt.segmentIds)}
                  className="w-full text-left p-2.5 rounded-lg bg-secondary/50 hover:bg-secondary border border-transparent hover:border-border transition-colors"
                >
                  <p className="text-xs font-medium text-foreground">{opt.label}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{opt.description}</p>
                </button>
              ))}
            </div>

            {/* RST mode */}
            {rstMode && rstOptions.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                  <Repeat className="w-3 h-3" /> RST (×{rstGroupSize})
                </p>
                {rstOptions.map((opt, i) => (
                  <button
                    key={i}
                    onClick={() => handleSelect(opt.segmentIds)}
                    className="w-full text-left p-2.5 rounded-lg bg-accent/10 hover:bg-accent/20 border border-transparent hover:border-accent/30 transition-colors"
                  >
                    <p className="text-xs font-medium text-foreground">{opt.label}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{opt.description}</p>
                  </button>
                ))}
              </div>
            )}

            {pendingIds.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">
                No hay tramos pendientes
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
