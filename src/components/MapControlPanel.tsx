import { useState } from 'react';
import {
  Play, Square, Check, AlertTriangle, ChevronDown, ChevronUp,
  MapPin, RotateCcw, Navigation, ExternalLink, LocateFixed, LocateOff,
  RefreshCw, Home, CheckSquare, Square as SquareIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { StatusBadge } from '@/components/StatusBadge';
import { IncidentDialog } from '@/components/IncidentDialog';
import { BaseLocationDialog } from '@/components/BaseLocationDialog';
import { formatDistance } from '@/utils/route-optimizer';
import { playStartSound, playEndSound } from '@/utils/sounds';
import type { Segment, LatLng, IncidentCategory, BaseLocation } from '@/types/route';

interface Props {
  segments: Segment[];
  optimizedOrder: string[];
  activeSegmentId: string | null;
  gpsEnabled: boolean;
  currentPosition: LatLng | null;
  gpsAccuracy: number | null;
  gpsSpeed: number | null;
  gpsError: string | null;
  navigationActive: boolean;
  base: BaseLocation | null;
  onToggleGps: (enabled: boolean) => void;
  onConfirmStart: (segmentId: string) => void;
  onComplete: (segmentId: string) => void;
  onResetSegment: (segmentId: string) => void;
  onAddIncident: (segmentId: string, category: IncidentCategory, note?: string, location?: LatLng) => void;
  onReoptimize: () => void;
  onStartNavigation: () => void;
  onStopNavigation: () => void;
  onExportToGoogleMaps: () => void;
  onSegmentSelect: (segmentId: string) => void;
  onSetBase: (base: BaseLocation) => void;
  selectedSegmentIds: Set<string>;
  onSelectedSegmentsChange: (ids: Set<string>) => void;
}

export function MapControlPanel({
  segments,
  optimizedOrder,
  activeSegmentId,
  gpsEnabled,
  currentPosition,
  gpsAccuracy,
  gpsSpeed,
  gpsError,
  navigationActive,
  base,
  onToggleGps,
  onConfirmStart,
  onComplete,
  onResetSegment,
  onAddIncident,
  onReoptimize,
  onStartNavigation,
  onStopNavigation,
  onExportToGoogleMaps,
  onSegmentSelect,
  onSetBase,
  selectedSegmentIds,
  onSelectedSegmentsChange,
}: Props) {
  const [expanded, setExpanded] = useState(true);
  const [confirmAction, setConfirmAction] = useState<'start' | 'end' | null>(null);

  const activeSegment = segments.find((s) => s.id === activeSegmentId);
  const pending = segments.filter((s) => s.status === 'pendiente').length;
  const completed = segments.filter((s) => s.status === 'completado').length;
  const inProgress = segments.filter((s) => s.status === 'en_progreso').length;

  // Get ordered segments for the list
  const orderedSegments = optimizedOrder
    .map((id) => segments.find((s) => s.id === id))
    .filter(Boolean) as Segment[];

  const handleConfirmStart = (segId: string) => {
    playStartSound();
    onConfirmStart(segId);
    setConfirmAction(null);
  };

  const handleComplete = (segId: string) => {
    playEndSound();
    onComplete(segId);
    setConfirmAction(null);
  };

  // Next pending segment
  const nextPending = orderedSegments.find((s) => s.status === 'pendiente');

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 flex flex-col safe-area-bottom">
      {/* GPS info bar */}
      {gpsEnabled && currentPosition && (
        <div className="mx-3 mb-1 bg-card/90 backdrop-blur-sm border border-border rounded-lg px-2 py-1 text-[10px] flex items-center gap-2 self-start">
          <LocateFixed className="w-3 h-3 text-accent" />
          {gpsSpeed !== null && <span className="text-foreground">{Math.round(gpsSpeed * 3.6)} km/h</span>}
          {gpsAccuracy !== null && <span className="text-muted-foreground">±{Math.round(gpsAccuracy)}m</span>}
        </div>
      )}

      {gpsError && (
        <div className="mx-3 mb-1 bg-destructive/20 border border-destructive/40 rounded-lg px-2 py-1.5 text-[10px] text-destructive self-start max-w-64">
          {gpsError}
        </div>
      )}

      {/* Main panel */}
      <div className="bg-card border-t border-border rounded-t-xl">
        {/* Toggle handle */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-center py-1 text-muted-foreground"
        >
          <div className="w-8 h-1 rounded-full bg-muted-foreground/30" />
        </button>

        {/* COLLAPSED: minimal controls only */}
        {!expanded && (
          <div className="px-3 pb-3 space-y-1.5">
            {/* Recording: show finalizar/confirmar */}
            {activeSegment && activeSegment.status === 'en_progreso' && (
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-primary font-medium truncate">● {activeSegment.name}</p>
                </div>
                {confirmAction === 'end' ? (
                  <>
                    <Button size="sm" onClick={() => handleComplete(activeSegment.id)} className="h-8 px-3 text-xs bg-success text-success-foreground">
                      <Check className="w-3.5 h-3.5 mr-1" />
                      Confirmar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmAction(null)} className="h-8 px-2 text-xs text-muted-foreground">✕</Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" onClick={() => setConfirmAction('end')} className="h-8 px-3 text-xs bg-success text-success-foreground">
                      <Square className="w-3.5 h-3.5 mr-1" />
                      Finalizar
                    </Button>
                    <IncidentDialog onSubmit={(cat, note) => onAddIncident(activeSegment.id, cat, note, currentPosition ?? undefined)}>
                      <Button size="sm" variant="ghost" className="h-8 px-2 text-destructive">
                        <AlertTriangle className="w-3.5 h-3.5" />
                      </Button>
                    </IncidentDialog>
                  </>
                )}
              </div>
            )}

            {/* Next pending: show siguiente/iniciar */}
            {nextPending && nextPending.id !== activeSegment?.id && (
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 bg-muted text-muted-foreground">
                  {nextPending.trackNumber ?? '—'}
                </span>
                <button className="flex-1 min-w-0 text-left" onClick={() => onSegmentSelect(nextPending.id)}>
                  <p className="text-xs text-foreground truncate">{nextPending.name}</p>
                </button>
                {nextPending.id === activeSegmentId && (
                  <Button size="sm" onClick={() => handleConfirmStart(nextPending.id)} className="h-8 px-3 text-xs bg-primary text-primary-foreground">
                    <Play className="w-3.5 h-3.5 mr-1" />
                    Iniciar
                  </Button>
                )}
                {nextPending.id !== activeSegmentId && (
                  <Button size="sm" variant="outline" onClick={() => onSegmentSelect(nextPending.id)} className="h-8 px-3 text-xs border-border text-foreground">
                    <MapPin className="w-3.5 h-3.5 mr-1" />
                    Siguiente
                  </Button>
                )}
              </div>
            )}

            {/* Summary counts */}
            <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-0.5">
              <span>{pending} pend. · {completed} compl.</span>
              <div className="flex items-center gap-1.5">
                {gpsEnabled ? <LocateFixed className="w-3 h-3 text-accent" /> : <LocateOff className="w-3 h-3" />}
                <Switch checked={gpsEnabled} onCheckedChange={onToggleGps} className="scale-75 origin-right" />
              </div>
            </div>
          </div>
        )}

        {/* EXPANDED: full panel */}
        {expanded && (
          <div className="px-3 pb-3 space-y-2 max-h-[40vh] overflow-y-auto">
            {/* Summary bar */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <BaseLocationDialog currentBase={base} currentPosition={currentPosition} onSetBase={onSetBase}>
                  <button className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md transition-colors text-[10px] ${base ? 'bg-accent/20 text-accent' : 'bg-muted hover:bg-muted/80 text-muted-foreground'}`}>
                    <Home className="w-3 h-3" />
                    <span className="truncate max-w-[60px]">{base ? base.label : 'Base'}</span>
                  </button>
                </BaseLocationDialog>
                <span>{pending} pend.</span>
                {inProgress > 0 && <span className="text-primary">{inProgress} grab.</span>}
                <span className="text-success">{completed} compl.</span>
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-[10px] text-muted-foreground flex items-center gap-1">
                  {gpsEnabled ? <LocateFixed className="w-3 h-3 text-accent" /> : <LocateOff className="w-3 h-3" />}
                  GPS
                </label>
                <Switch checked={gpsEnabled} onCheckedChange={onToggleGps} className="scale-75 origin-right" />
              </div>
            </div>

            {/* Active segment controls */}
            {activeSegment && activeSegment.status === 'en_progreso' && (
              <div className="bg-primary/10 border border-primary/30 rounded-lg p-2.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-primary font-medium">Grabando</p>
                    <h3 className="text-sm font-bold text-foreground truncate">{activeSegment.name}</h3>
                  </div>
                  <StatusBadge status={activeSegment.status} />
                </div>
                <div className="flex gap-2">
                  {confirmAction === 'end' ? (
                    <>
                      <Button size="sm" onClick={() => handleComplete(activeSegment.id)} className="flex-1 h-9 text-xs bg-success text-success-foreground">
                        <Check className="w-4 h-4 mr-1" />
                        Confirmar Fin
                      </Button>
                      <Button size="sm" onClick={() => setConfirmAction(null)} variant="outline" className="h-9 text-xs border-border text-foreground">
                        Cancelar
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" onClick={() => setConfirmAction('end')} className="flex-1 h-9 text-xs bg-success text-success-foreground">
                        <Square className="w-4 h-4 mr-1" />
                        Finalizar
                      </Button>
                      <IncidentDialog onSubmit={(cat, note) => onAddIncident(activeSegment.id, cat, note, currentPosition ?? undefined)}>
                        <Button size="sm" variant="outline" className="h-9 text-xs border-destructive/40 text-destructive">
                          <AlertTriangle className="w-4 h-4" />
                        </Button>
                      </IncidentDialog>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-1.5">
              <Button variant="outline" onClick={onReoptimize} size="sm" className="flex-1 h-9 text-xs border-border text-foreground">
                <RotateCcw className="w-3.5 h-3.5 mr-1" />
                Reoptimizar
              </Button>
              {navigationActive ? (
                <Button onClick={onStopNavigation} variant="outline" size="sm" className="flex-1 h-9 text-xs border-destructive/40 text-destructive">
                  <Square className="w-3.5 h-3.5 mr-1" />
                  Detener
                </Button>
              ) : (
                <Button onClick={onStartNavigation} disabled={pending === 0} size="sm" className="flex-1 h-9 text-xs bg-primary text-primary-foreground">
                  <Navigation className="w-3.5 h-3.5 mr-1" />
                  Navegar
                </Button>
              )}
            </div>

            {navigationActive && (
              <Button variant="outline" onClick={onExportToGoogleMaps} size="sm" className="w-full h-8 text-xs border-border text-foreground">
                <ExternalLink className="w-3.5 h-3.5 mr-1" />
                Abrir en Google Maps
              </Button>
            )}

            {/* Segment list */}
            <div className="space-y-1">
              <div className="flex items-center justify-between px-0.5">
                <p className="text-[10px] font-medium text-muted-foreground">Itinerario</p>
                {selectedSegmentIds.size > 0 && (
                  <button onClick={() => onSelectedSegmentsChange(new Set())} className="text-[9px] text-primary hover:underline">
                    Mostrar todos ({selectedSegmentIds.size} sel.)
                  </button>
                )}
              </div>
              {orderedSegments.map((seg) => {
                const firstPendingId = orderedSegments.find((s) => s.status === 'pendiente')?.id;
                const canStart = seg.status === 'pendiente' && seg.id === activeSegmentId && seg.id === firstPendingId;
                const isSelected = selectedSegmentIds.has(seg.id);
                return (
                  <div
                    key={seg.id}
                    className={`w-full flex items-center gap-1.5 p-2 rounded-lg text-left transition-colors ${
                      seg.id === activeSegmentId
                        ? 'bg-primary/10 border border-primary/30'
                        : isSelected
                          ? 'bg-accent/10 border border-accent/30'
                          : 'bg-secondary/50 border border-transparent hover:border-border'
                    }`}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = new Set(selectedSegmentIds);
                        if (isSelected) next.delete(seg.id);
                        else next.add(seg.id);
                        onSelectedSegmentsChange(next);
                      }}
                      className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                        isSelected ? 'bg-accent border-accent text-accent-foreground' : 'border-muted-foreground/40 text-transparent hover:border-muted-foreground'
                      }`}
                    >
                      {isSelected && <Check className="w-2.5 h-2.5" />}
                    </button>
                    <button className="flex-1 flex items-center gap-2 min-w-0" onClick={() => onSegmentSelect(seg.id)}>
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                        seg.status === 'completado' ? 'bg-success/20 text-success'
                        : seg.status === 'en_progreso' ? 'bg-primary/20 text-primary'
                        : 'bg-muted text-muted-foreground'
                      }`}>
                        {seg.trackNumber ?? '—'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="text-[9px] font-mono text-muted-foreground truncate block">{seg.kmlId || seg.name}</span>
                        {seg.trackNumber !== null && <p className="text-[9px] text-primary font-medium">Track {seg.trackNumber}</p>}
                      </div>
                      <StatusBadge status={seg.status} />
                    </button>
                    {canStart && (
                      <Button size="sm" onClick={(e) => { e.stopPropagation(); handleConfirmStart(seg.id); }} className="h-7 px-2 bg-primary text-primary-foreground text-[10px]">
                        <Play className="w-3 h-3 mr-0.5" />
                        Iniciar
                      </Button>
                    )}
                    {seg.status === 'completado' && (
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onResetSegment(seg.id); }} className="h-7 px-1.5 text-muted-foreground hover:text-foreground">
                        <RefreshCw className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
