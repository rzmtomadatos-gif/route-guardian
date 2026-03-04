import { useState, useMemo } from 'react';
import {
  Play, Square, AlertTriangle, MapPin, RotateCcw, Navigation,
  ExternalLink, LocateFixed, LocateOff, RefreshCw, Home, Check,
  Repeat, Repeat2, MoreHorizontal, ChevronDown, ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/StatusBadge';
import { IncidentDialog } from '@/components/IncidentDialog';
import { BaseLocationDialog } from '@/components/BaseLocationDialog';
import { GoogleMapsItineraryDialog } from '@/components/GoogleMapsItineraryDialog';
import { playStartSound, playEndSound } from '@/utils/sounds';
import type { Segment, LatLng, IncidentCategory, BaseLocation } from '@/types/route';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

const FILTER_KEY = 'vialroute_nav_filter';

type FilterType = 'todos' | 'pendiente' | 'completado' | 'posible_repetir';

function loadFilter(): FilterType {
  try {
    const v = localStorage.getItem(FILTER_KEY);
    if (v === 'todos' || v === 'pendiente' || v === 'completado' || v === 'posible_repetir') return v;
  } catch {}
  return 'pendiente';
}

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
  rstMode: boolean;
  rstGroupSize: number;
  onToggleGps: (enabled: boolean) => void;
  onConfirmStart: (segmentId: string) => void;
  onComplete: (segmentId: string) => void;
  onResetSegment: (segmentId: string) => void;
  onAddIncident: (segmentId: string, category: IncidentCategory, note?: string, location?: LatLng) => void;
  onRepeatSegment: (segmentId: string) => void;
  onReoptimize: () => void;
  onStartNavigation: () => void;
  onStopNavigation: () => void;
  onExportToGoogleMaps: () => void;
  onSegmentSelect: (segmentId: string) => void;
  onSetBase: (base: BaseLocation) => void;
  selectedSegmentIds: Set<string>;
  onSelectedSegmentsChange: (ids: Set<string>) => void;
  onMergeSegments: (ids: string[]) => void;
  onSetRstMode: (enabled: boolean) => void;
  onSetRstGroupSize: (size: number) => void;
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
  rstMode,
  rstGroupSize,
  onToggleGps,
  onConfirmStart,
  onComplete,
  onResetSegment,
  onRepeatSegment,
  onAddIncident,
  onReoptimize,
  onStartNavigation,
  onStopNavigation,
  onExportToGoogleMaps,
  onSegmentSelect,
  onSetBase,
  selectedSegmentIds,
  onSelectedSegmentsChange,
  onMergeSegments,
  onSetRstMode,
  onSetRstGroupSize,
}: Props) {
  const [expanded, setExpanded] = useState(true);
  const [statusFilter, setStatusFilter] = useState<FilterType>(loadFilter);
  const [showSecondary, setShowSecondary] = useState(false);

  const handleFilterChange = (f: FilterType) => {
    setStatusFilter(f);
    try { localStorage.setItem(FILTER_KEY, f); } catch {}
  };

  const posibleRepetir = segments.filter((s) => s.status === 'posible_repetir').length;

  const activeSegment = segments.find((s) => s.id === activeSegmentId);
  const pending = segments.filter((s) => s.status === 'pendiente').length;
  const completed = segments.filter((s) => s.status === 'completado').length;

  const orderedSegments = useMemo(() =>
    optimizedOrder
      .map((id) => segments.find((s) => s.id === id))
      .filter(Boolean) as Segment[],
    [optimizedOrder, segments]
  );

  const nextPending = orderedSegments.find((s) => s.status === 'pendiente');

  const handleConfirmStart = (segId: string) => {
    playStartSound();
    onConfirmStart(segId);
  };

  const handleComplete = (segId: string) => {
    playEndSound();
    onComplete(segId);
  };

  // Pinned segment: active (en_progreso) or next pending
  const pinnedSegment = activeSegment?.status === 'en_progreso'
    ? activeSegment
    : nextPending;

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

        {/* COLLAPSED: minimal controls */}
        {!expanded && (
          <div className="px-3 pb-2 space-y-1">
            {/* Pinned segment */}
            {pinnedSegment && pinnedSegment.status === 'en_progreso' && (
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-primary font-medium truncate">● {pinnedSegment.name}</p>
                </div>
                <Button size="sm" onClick={() => handleComplete(pinnedSegment.id)} className="h-12 px-4 text-xs bg-success text-success-foreground">
                  <Square className="w-4 h-4 mr-1" />
                  Finalizar
                </Button>
                <IncidentDialog onSubmit={(cat, note) => onAddIncident(pinnedSegment.id, cat, note, currentPosition ?? undefined)}>
                  <Button size="sm" variant="ghost" className="h-12 px-3 text-destructive">
                    <AlertTriangle className="w-4 h-4" />
                  </Button>
                </IncidentDialog>
              </div>
            )}
            {pinnedSegment && pinnedSegment.status === 'pendiente' && (
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 bg-muted text-muted-foreground">
                  {pinnedSegment.trackNumber ?? '—'}
                </span>
                <button className="flex-1 min-w-0 text-left" onClick={() => onSegmentSelect(pinnedSegment.id)}>
                  <p className="text-xs text-foreground truncate">{pinnedSegment.name}</p>
                </button>
                <Button size="sm" onClick={() => { onSegmentSelect(pinnedSegment.id); handleConfirmStart(pinnedSegment.id); }} className="h-12 px-4 text-xs bg-primary text-primary-foreground">
                  <Play className="w-4 h-4 mr-1" />
                  Iniciar
                </Button>
              </div>
            )}
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{pending} pend. · {completed} compl.</span>
              <div className="flex items-center gap-1.5">
                {gpsEnabled ? <LocateFixed className="w-3 h-3 text-accent" /> : <LocateOff className="w-3 h-3" />}
                <Switch checked={gpsEnabled} onCheckedChange={onToggleGps} className="scale-75 origin-right" />
              </div>
            </div>
          </div>
        )}

        {/* EXPANDED */}
        {expanded && (
          <div className="px-3 pb-2 space-y-1.5 max-h-[30vh] overflow-y-auto">
            {/* === PINNED: Active/Next Segment === */}
            {pinnedSegment && pinnedSegment.status === 'en_progreso' && (
              <div className="bg-primary/10 border border-primary/30 rounded-lg p-2 space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-primary font-medium">Grabando</p>
                    <h3 className="text-sm font-bold text-foreground truncate">{pinnedSegment.name}</h3>
                  </div>
                  <StatusBadge status={pinnedSegment.status} />
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => handleComplete(pinnedSegment.id)} className="flex-1 h-14 text-sm bg-success text-success-foreground font-bold">
                    <Square className="w-5 h-5 mr-1.5" />
                    Finalizar
                  </Button>
                  <IncidentDialog onSubmit={(cat, note) => onAddIncident(pinnedSegment.id, cat, note, currentPosition ?? undefined)}>
                    <Button variant="outline" className="h-14 px-4 border-destructive/40 text-destructive">
                      <AlertTriangle className="w-5 h-5" />
                    </Button>
                  </IncidentDialog>
                </div>
              </div>
            )}

            {pinnedSegment && pinnedSegment.status === 'pendiente' && (
              <div className="bg-secondary/50 border border-border rounded-lg p-2 flex items-center gap-2">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 bg-muted text-muted-foreground">
                  {pinnedSegment.trackNumber ?? '—'}
                </span>
                <button className="flex-1 min-w-0 text-left" onClick={() => onSegmentSelect(pinnedSegment.id)}>
                  <p className="text-[10px] text-muted-foreground">Siguiente tramo</p>
                  <p className="text-xs font-medium text-foreground truncate">{pinnedSegment.name}</p>
                </button>
                {pinnedSegment.id === activeSegmentId && (
                  <Button onClick={() => handleConfirmStart(pinnedSegment.id)} className="h-12 px-4 text-sm bg-primary text-primary-foreground font-bold">
                    <Play className="w-5 h-5 mr-1" />
                    Iniciar
                  </Button>
                )}
                {pinnedSegment.id !== activeSegmentId && (
                  <Button variant="outline" onClick={() => onSegmentSelect(pinnedSegment.id)} className="h-12 px-3 text-xs">
                    <MapPin className="w-4 h-4 mr-1" />
                    Ir
                  </Button>
                )}
              </div>
            )}

            {/* === PRIMARY ACTION BUTTONS === */}
            <div className="flex gap-1.5">
              {navigationActive ? (
                <Button onClick={onStopNavigation} variant="outline" className="flex-1 h-12 text-sm font-bold border-destructive/40 text-destructive">
                  <Square className="w-4 h-4 mr-1.5" />
                  Detener
                </Button>
              ) : (
                <Button onClick={onStartNavigation} disabled={pending === 0} className="flex-1 h-12 text-sm font-bold bg-primary text-primary-foreground">
                  <Navigation className="w-4 h-4 mr-1.5" />
                  Navegar
                </Button>
              )}
              <GoogleMapsItineraryDialog
                segments={segments}
                optimizedOrder={optimizedOrder}
                activeSegmentId={activeSegmentId}
                currentPosition={currentPosition}
                base={base}
                rstMode={rstMode}
                rstGroupSize={rstGroupSize}
                selectedSegmentIds={selectedSegmentIds}
              >
                <Button variant="outline" className="h-12 px-3">
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </GoogleMapsItineraryDialog>
            </div>

            {/* === SUMMARY + GPS === */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span>{pending} pend.</span>
                <span className="text-success">{completed} compl.</span>
                {posibleRepetir > 0 && <span className="text-amber-400">{posibleRepetir} rep.</span>}
              </div>
              <div className="flex items-center gap-1.5">
                {gpsEnabled ? <LocateFixed className="w-3 h-3 text-accent" /> : <LocateOff className="w-3 h-3" />}
                <Switch checked={gpsEnabled} onCheckedChange={onToggleGps} className="scale-75 origin-right" />
              </div>
            </div>

            {/* === SECONDARY ACTIONS (collapsible) === */}
            <Collapsible open={showSecondary} onOpenChange={setShowSecondary}>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-center gap-1 text-[10px] text-muted-foreground hover:text-foreground py-0.5 transition-colors">
                  <MoreHorizontal className="w-3 h-3" />
                  {showSecondary ? 'Menos opciones' : 'Más opciones'}
                  {showSecondary ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1.5 pt-1">
                <div className="flex gap-1.5">
                  <Button variant="outline" onClick={onReoptimize} size="sm" className="flex-1 h-9 text-xs border-border text-foreground">
                    <RotateCcw className="w-3.5 h-3.5 mr-1" />
                    Reoptimizar
                  </Button>
                  <BaseLocationDialog currentBase={base} currentPosition={currentPosition} onSetBase={onSetBase}>
                    <Button variant="outline" size="sm" className={`h-9 text-xs ${base ? 'border-accent/40 text-accent' : 'border-border text-foreground'}`}>
                      <Home className="w-3.5 h-3.5 mr-1" />
                      {base ? base.label : 'Base'}
                    </Button>
                  </BaseLocationDialog>
                </div>
                {/* RST Mode */}
                <div className="flex items-center gap-2 bg-secondary/50 rounded-lg px-2 py-1.5">
                  <Repeat className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <label className="text-[10px] text-muted-foreground flex-shrink-0">RST</label>
                  <Switch checked={rstMode} onCheckedChange={onSetRstMode} className="scale-75 origin-left" />
                  {rstMode && (
                    <Input
                      type="number"
                      min={2}
                      max={12}
                      value={rstGroupSize}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        if (!isNaN(v) && v >= 2 && v <= 12) onSetRstGroupSize(v);
                      }}
                      className="w-14 h-6 text-[10px] text-center px-1 py-0"
                    />
                  )}
                  {rstMode && <span className="text-[9px] text-accent whitespace-nowrap">×{rstGroupSize}</span>}
                </div>

                {selectedSegmentIds.size > 0 && (
                  <button onClick={() => onSelectedSegmentsChange(new Set())} className="w-full text-[10px] text-primary hover:underline py-0.5">
                    Limpiar selección ({selectedSegmentIds.size})
                  </button>
                )}
              </CollapsibleContent>
            </Collapsible>

            {/* === SEGMENT LIST === */}
            <div className="space-y-1">
              <div className="flex items-center justify-between px-0.5">
                <p className="text-[10px] font-medium text-muted-foreground">Itinerario</p>
                <div className="flex items-center gap-0.5 flex-wrap">
                  {(['todos', 'pendiente', 'completado', 'posible_repetir'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => handleFilterChange(f)}
                      className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors ${
                        statusFilter === f
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-secondary text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {f === 'todos' ? 'Todos' : f === 'pendiente' ? 'Pend.' : f === 'completado' ? 'Compl.' : 'Rep.'}
                    </button>
                  ))}
                </div>
              </div>
              {orderedSegments
                .filter((seg) => statusFilter === 'todos' || seg.status === statusFilter)
                .filter((seg) => seg.id !== pinnedSegment?.id) // Don't duplicate pinned
                .map((seg) => {
                  const isSelected = selectedSegmentIds.has(seg.id);
                  return (
                    <div
                      key={seg.id}
                      className={`w-full flex items-center gap-1.5 p-1.5 rounded-lg text-left transition-colors ${
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
                      <button className="flex-1 flex items-center gap-1.5 min-w-0" onClick={() => onSegmentSelect(seg.id)}>
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                          seg.status === 'completado' ? 'bg-success/20 text-success'
                          : seg.status === 'en_progreso' ? 'bg-primary/20 text-primary'
                          : seg.status === 'posible_repetir' ? 'bg-amber-500/20 text-amber-400'
                          : 'bg-muted text-muted-foreground'
                        }`}>
                          {seg.trackNumber ?? '—'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="text-[9px] text-muted-foreground truncate block">{seg.name}</span>
                        </div>
                        <StatusBadge status={seg.status} />
                      </button>
                      {seg.status === 'completado' && (
                        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onResetSegment(seg.id); }} className="h-6 px-1 text-muted-foreground hover:text-foreground">
                          <RefreshCw className="w-3 h-3" />
                        </Button>
                      )}
                      {seg.status === 'posible_repetir' && (
                        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onRepeatSegment(seg.id); }} className="h-6 px-1 text-amber-400 hover:text-amber-300" title="Repetir tramo">
                          <Repeat2 className="w-3 h-3" />
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
