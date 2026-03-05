import { useState, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { QRCodeSVG } from 'qrcode.react';
import {
  Send, QrCode, Share2, ExternalLink, ChevronLeft, ChevronRight,
  Navigation, Repeat, CheckSquare,
} from 'lucide-react';
import type { Segment, LatLng, BaseLocation } from '@/types/route';

/* ─── URL builder (same logic as GoogleMapsItineraryDialog) ─── */

const MAX_WAYPOINTS = 9;

function buildStageUrls(
  segments: Segment[],
  ids: string[],
  currentPosition: LatLng | null,
  base: BaseLocation | null,
): string[] {
  if (ids.length === 0) return [];
  const segs = ids.map((id) => segments.find((s) => s.id === id)).filter(Boolean) as Segment[];
  if (segs.length === 0) return [];

  const allPoints: string[] = [];
  for (const seg of segs) {
    const start = seg.coordinates[0];
    const end = seg.coordinates[seg.coordinates.length - 1];
    allPoints.push(`${start.lat},${start.lng}`);
    allPoints.push(`${end.lat},${end.lng}`);
  }

  const originPoint = currentPosition
    ? `${currentPosition.lat},${currentPosition.lng}`
    : base
      ? `${base.position.lat},${base.position.lng}`
      : allPoints[0];

  const maxPts = MAX_WAYPOINTS * 2;
  const stages: string[][] = [];
  for (let i = 0; i < allPoints.length; i += maxPts) {
    stages.push(allPoints.slice(i, i + maxPts));
  }

  return stages.map((pts, idx) => {
    const origin = idx === 0 ? originPoint : pts[0];
    const dest = pts[pts.length - 1];
    const middle = (idx === 0 && origin !== pts[0])
      ? pts.slice(0, -1).join('|')
      : pts.slice(1, -1).join('|');
    let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=driving`;
    if (middle) url += `&waypoints=${middle}`;
    return url;
  });
}

/* ─── Types ─── */

interface ItineraryOption {
  label: string;
  description: string;
  segmentIds: string[];
}

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

type View = 'options' | 'share';

export function DriverShareDialog({
  segments, optimizedOrder, activeSegmentId, currentPosition,
  base, rstMode, rstGroupSize, selectedSegmentIds, children,
}: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('options');
  const [stageUrls, setStageUrls] = useState<string[]>([]);
  const [stageIdx, setStageIdx] = useState(0);
  const [chosenLabel, setChosenLabel] = useState('');

  const pendingIds = useMemo(() =>
    optimizedOrder.filter((id) => {
      const seg = segments.find((s) => s.id === id);
      return seg?.status === 'pendiente' || seg?.status === 'en_progreso';
    }),
  [segments, optimizedOrder]);

  /* Build itinerary options */
  const options = useMemo((): ItineraryOption[] => {
    const opts: ItineraryOption[] = [];
    const next = pendingIds[0];
    if (next) {
      opts.push({ label: 'Siguiente tramo', description: segments.find((s) => s.id === next)?.name || '', segmentIds: [next] });
    }
    if (pendingIds.length > 1) {
      const n = Math.min(6, pendingIds.length);
      opts.push({ label: `Próximos ${n} tramos`, description: `${n} tramos pendientes`, segmentIds: pendingIds.slice(0, n) });
    }
    if (pendingIds.length > 6) {
      opts.push({ label: `Todos los pendientes (${pendingIds.length})`, description: 'Se dividirá en etapas', segmentIds: pendingIds });
    }
    if (selectedSegmentIds.size > 0) {
      const sel = optimizedOrder.filter((id) => selectedSegmentIds.has(id));
      if (sel.length) opts.push({ label: `Seleccionados (${sel.length})`, description: 'Tramos seleccionados', segmentIds: sel });
    }
    if (rstMode) {
      const block = pendingIds.slice(0, rstGroupSize);
      if (block.length) opts.push({ label: `Bloque RST (×${block.length})`, description: 'Bloque actual', segmentIds: block });
    }
    return opts;
  }, [pendingIds, selectedSegmentIds, optimizedOrder, segments, rstMode, rstGroupSize]);

  const handleSelect = (opt: ItineraryOption) => {
    const urls = buildStageUrls(segments, opt.segmentIds, currentPosition, base);
    setStageUrls(urls);
    setStageIdx(0);
    setChosenLabel(opt.label);
    setView('share');
  };

  const currentUrl = stageUrls[stageIdx] || '';

  const handleShare = async () => {
    const text = stageUrls.length > 1
      ? `${chosenLabel} — Etapa ${stageIdx + 1}/${stageUrls.length}`
      : chosenLabel;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Itinerario', text, url: currentUrl });
      } catch { /* user cancelled */ }
    } else {
      await navigator.clipboard.writeText(currentUrl);
      // fallback: copy
    }
  };

  const handleReset = () => {
    setView('options');
    setStageUrls([]);
    setStageIdx(0);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) handleReset(); }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <Send className="w-4 h-4" />
            Enviar al conductor
          </DialogTitle>
        </DialogHeader>

        {view === 'options' && (
          <div className="space-y-1.5">
            {options.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">No hay tramos pendientes</p>
            )}
            {options.map((opt, i) => (
              <button
                key={i}
                onClick={() => handleSelect(opt)}
                className="w-full text-left p-2.5 rounded-lg bg-secondary/50 hover:bg-secondary border border-transparent hover:border-border transition-colors"
              >
                <p className="text-xs font-medium text-foreground">{opt.label}</p>
                <p className="text-[10px] text-muted-foreground truncate">{opt.description}</p>
              </button>
            ))}
          </div>
        )}

        {view === 'share' && (
          <div className="space-y-3">
            {/* Stage indicator */}
            {stageUrls.length > 1 && (
              <div className="flex items-center justify-between">
                <Button
                  variant="ghost" size="sm" disabled={stageIdx === 0}
                  onClick={() => setStageIdx((i) => i - 1)}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-xs font-medium text-foreground">
                  Etapa {stageIdx + 1} / {stageUrls.length}
                </span>
                <Button
                  variant="ghost" size="sm" disabled={stageIdx >= stageUrls.length - 1}
                  onClick={() => setStageIdx((i) => i + 1)}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            )}

            {/* QR */}
            <div className="flex justify-center bg-white rounded-lg p-4">
              <QRCodeSVG value={currentUrl} size={200} level="M" />
            </div>

            <p className="text-[10px] text-muted-foreground text-center truncate px-2">
              {chosenLabel}{stageUrls.length > 1 ? ` · Etapa ${stageIdx + 1}` : ''}
            </p>

            {/* Actions */}
            <div className="flex gap-2">
              <Button onClick={handleShare} className="flex-1 h-11 text-sm">
                <Share2 className="w-4 h-4 mr-1.5" />
                Compartir
              </Button>
              <Button
                variant="outline"
                className="h-11 px-3"
                onClick={() => window.open(currentUrl, '_blank')}
              >
                <ExternalLink className="w-4 h-4" />
              </Button>
            </div>

            <Button variant="ghost" size="sm" className="w-full text-xs" onClick={handleReset}>
              ← Volver
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
