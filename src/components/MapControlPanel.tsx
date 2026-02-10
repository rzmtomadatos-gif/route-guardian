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

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 flex flex-col safe-area-bottom">
      {/* GPS info bar */}
      {gpsEnabled && currentPosition && (
        <div className="mx-3 mb-2 bg-card/90 backdrop-blur-sm border border-border rounded-lg px-3 py-2 text-xs flex items-center gap-3 self-start">
          <LocateFixed className="w-3.5 h-3.5 text-accent" />
          {gpsSpeed !== null && <span className="text-foreground">{Math.round(gpsSpeed * 3.6)} km/h</span>}
          {gpsAccuracy !== null && <span className="text-muted-foreground">±{Math.round(gpsAccuracy)}m</span>}
        </div>
      )}

      {gpsError && (
        <div className="mx-3 mb-2 bg-destructive/20 border border-destructive/40 rounded-lg px-3 py-2 text-xs text-destructive self-start max-w-64">
          {gpsError}
        </div>
      )}

      {/* Main panel */}
      <div className="bg-card border-t border-border rounded-t-xl">
        {/* Toggle handle */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-center py-2 text-muted-foreground"
        >
          {expanded ? <ChevronDown className="w-5 h-5" /> : <ChevronUp className="w-5 h-5" />}
        </button>

        {/* Summary bar */}
        <div className="px-4 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <BaseLocationDialog currentBase={base} currentPosition={currentPosition} onSetBase={onSetBase}>
              <button className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${base ? 'bg-accent/20 text-accent' : 'bg-muted hover:bg-muted/80 text-muted-foreground'}`}>
                <Home className="w-3.5 h-3.5" />
                <span className="truncate max-w-[80px]">{base ? base.label : 'Base'}</span>
              </button>
            </BaseLocationDialog>
            <span>{pending} pend.</span>
            {inProgress > 0 && <span className="text-primary">{inProgress} grab.</span>}
            <span className="text-success">{completed} compl.</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground flex items-center gap-1.5">
              {gpsEnabled ? <LocateFixed className="w-3.5 h-3.5 text-accent" /> : <LocateOff className="w-3.5 h-3.5" />}
              GPS
            </label>
            <Switch checked={gpsEnabled} onCheckedChange={onToggleGps} />
          </div>
        </div>

        {/* Always-visible: active segment controls + next segment */}
        {!expanded && (
          <div className="px-4 pb-4 space-y-2">
            {activeSegment && activeSegment.status === 'en_progreso' && (
              <div className="bg-primary/10 border border-primary/30 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-primary font-medium">Grabando</p>
                    <h3 className="text-base font-bold text-foreground truncate">{activeSegment.name}</h3>
                  </div>
                  <StatusBadge status={activeSegment.status} />
                </div>
                <div className="flex gap-2">
                  {confirmAction === 'end' ? (
                    <>
                      <Button onClick={() => handleComplete(activeSegment.id)} className="flex-1 driving-button bg-success text-success-foreground">
                        <Check className="w-5 h-5 mr-2" />
                        Confirmar Fin
                      </Button>
                      <Button onClick={() => setConfirmAction(null)} variant="outline" className="driving-button border-border text-foreground">
                        Cancelar
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button onClick={() => setConfirmAction('end')} className="flex-1 driving-button bg-success text-success-foreground">
                        <Square className="w-5 h-5 mr-2" />
                        Finalizar
                      </Button>
                      <IncidentDialog onSubmit={(cat, note) => onAddIncident(activeSegment.id, cat, note, currentPosition ?? undefined)}>
                        <Button variant="outline" className="driving-button border-destructive/40 text-destructive">
                          <AlertTriangle className="w-5 h-5" />
                        </Button>
                      </IncidentDialog>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2">
              <Button variant="outline" onClick={onReoptimize} className="flex-1 min-h-[48px] border-border text-foreground">
                <RotateCcw className="w-4 h-4 mr-2" />
                Reoptimizar
              </Button>
              {navigationActive ? (
                <Button onClick={onStopNavigation} variant="outline" className="flex-1 min-h-[48px] border-destructive/40 text-destructive">
                  <Square className="w-4 h-4 mr-2" />
                  Detener
                </Button>
              ) : (
                <Button onClick={onStartNavigation} disabled={pending === 0} className="flex-1 min-h-[48px] bg-primary text-primary-foreground">
                  <Navigation className="w-4 h-4 mr-2" />
                  Navegar
                </Button>
              )}
            </div>

            {/* Next pending segment */}
            {(() => {
              const nextSeg = orderedSegments.find((s) => s.status === 'pendiente');
              if (!nextSeg) return null;
              const canStart = nextSeg.id === activeSegmentId;
              return (
                <div
                  className={`flex items-center gap-3 p-2.5 rounded-lg ${
                    nextSeg.id === activeSegmentId ? 'bg-primary/10 border border-primary/30' : 'bg-secondary/50 border border-transparent'
                  }`}
                >
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 bg-muted text-muted-foreground">
                    {nextSeg.trackNumber ?? '—'}
                  </span>
                  <button className="flex-1 min-w-0 text-left" onClick={() => onSegmentSelect(nextSeg.id)}>
                    <span className="text-[9px] font-mono text-muted-foreground">{nextSeg.kmlId || nextSeg.name}</span>
                    {nextSeg.trackNumber !== null && <p className="text-[10px] text-primary font-medium">Track {nextSeg.trackNumber}</p>}
                  </button>
                  <StatusBadge status={nextSeg.status} />
                  {canStart && (
                    <Button size="sm" onClick={() => handleConfirmStart(nextSeg.id)} className="h-8 px-3 bg-primary text-primary-foreground text-xs">
                      <Play className="w-3.5 h-3.5 mr-1" />
                      Iniciar
                    </Button>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {expanded && (
          <div className="px-4 pb-4 space-y-3 max-h-[45vh] overflow-y-auto">
            {/* Active segment controls */}
            {activeSegment && activeSegment.status === 'en_progreso' && (
              <div className="bg-primary/10 border border-primary/30 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-primary font-medium">Grabando</p>
                    <h3 className="text-base font-bold text-foreground truncate">{activeSegment.name}</h3>
                  </div>
                  <StatusBadge status={activeSegment.status} />
                </div>
                <div className="flex gap-2">
                  {confirmAction === 'end' ? (
                    <>
                      <Button onClick={() => handleComplete(activeSegment.id)} className="flex-1 driving-button bg-success text-success-foreground">
                        <Check className="w-5 h-5 mr-2" />
                        Confirmar Fin
                      </Button>
                      <Button onClick={() => setConfirmAction(null)} variant="outline" className="driving-button border-border text-foreground">
                        Cancelar
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button onClick={() => setConfirmAction('end')} className="flex-1 driving-button bg-success text-success-foreground">
                        <Square className="w-5 h-5 mr-2" />
                        Finalizar
                      </Button>
                      <IncidentDialog onSubmit={(cat, note) => onAddIncident(activeSegment.id, cat, note, currentPosition ?? undefined)}>
                        <Button variant="outline" className="driving-button border-destructive/40 text-destructive">
                          <AlertTriangle className="w-5 h-5" />
                        </Button>
                      </IncidentDialog>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={onReoptimize}
                className="flex-1 min-h-[48px] border-border text-foreground"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Reoptimizar
              </Button>
              {navigationActive ? (
                <Button
                  onClick={onStopNavigation}
                  variant="outline"
                  className="flex-1 min-h-[48px] border-destructive/40 text-destructive"
                >
                  <Square className="w-4 h-4 mr-2" />
                  Detener
                </Button>
              ) : (
                <Button
                  onClick={onStartNavigation}
                  disabled={pending === 0}
                  className="flex-1 min-h-[48px] bg-primary text-primary-foreground"
                >
                  <Navigation className="w-4 h-4 mr-2" />
                  Navegar
                </Button>
              )}
            </div>

            {navigationActive && (
              <Button
                variant="outline"
                onClick={onExportToGoogleMaps}
                className="w-full min-h-[44px] border-border text-foreground"
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Abrir en Google Maps
              </Button>
            )}

            {/* Segment list */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-1">
                <p className="text-xs font-medium text-muted-foreground">Itinerario</p>
                {selectedSegmentIds.size > 0 && (
                  <button
                    onClick={() => onSelectedSegmentsChange(new Set())}
                    className="text-[10px] text-primary hover:underline"
                  >
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
                  className={`w-full flex items-center gap-2 p-2.5 rounded-lg text-left transition-colors ${
                    seg.id === activeSegmentId
                      ? 'bg-primary/10 border border-primary/30'
                      : isSelected
                        ? 'bg-accent/10 border border-accent/30'
                        : 'bg-secondary/50 border border-transparent hover:border-border'
                  }`}
                >
                  {/* Selection checkbox */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const next = new Set(selectedSegmentIds);
                      if (isSelected) next.delete(seg.id);
                      else next.add(seg.id);
                      onSelectedSegmentsChange(next);
                    }}
                    className={`flex-shrink-0 w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                      isSelected
                        ? 'bg-accent border-accent text-accent-foreground'
                        : 'border-muted-foreground/40 text-transparent hover:border-muted-foreground'
                    }`}
                  >
                    {isSelected && <Check className="w-3 h-3" />}
                  </button>
                  {/* Rest of row - clickable to select/focus */}
                  <button
                    className="flex-1 flex items-center gap-3 min-w-0"
                    onClick={() => onSegmentSelect(seg.id)}
                  >
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                      seg.status === 'completado' ? 'bg-success/20 text-success'
                      : seg.status === 'en_progreso' ? 'bg-primary/20 text-primary'
                      : 'bg-muted text-muted-foreground'
                    }`}>
                      {seg.trackNumber ?? '—'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-[9px] font-mono text-muted-foreground">{seg.kmlId || seg.name}</span>
                      {seg.trackNumber !== null && (
                        <p className="text-[10px] text-primary font-medium">Track {seg.trackNumber}</p>
                      )}
                      {seg.trackHistory.length > 0 && (
                        <p className="text-[9px] text-muted-foreground">Hist: {seg.trackHistory.join(', ')}</p>
                      )}
                    </div>
                    <StatusBadge status={seg.status} />
                  </button>
                  {canStart && (
                    <Button
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); handleConfirmStart(seg.id); }}
                      className="h-8 px-3 bg-primary text-primary-foreground text-xs"
                    >
                      <Play className="w-3.5 h-3.5 mr-1" />
                      Iniciar
                    </Button>
                  )}
                  {seg.status === 'completado' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => { e.stopPropagation(); onResetSegment(seg.id); }}
                      className="h-8 px-2 text-muted-foreground hover:text-foreground text-xs"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
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
