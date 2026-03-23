import { useState, useMemo, useEffect, useRef } from 'react';
import {
  Play, Square, AlertTriangle, MapPin, RotateCcw, Navigation,
  LocateFixed, LocateOff, RefreshCw, Home, Check,
  Repeat, Repeat2, MoreHorizontal, ChevronDown, ChevronUp, StopCircle,
  SkipForward, Film, Radio, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { NumberStepper } from '@/components/ui/number-stepper';
import { Progress } from '@/components/ui/progress';
import { StatusBadge } from '@/components/StatusBadge';
import { IncidentDialog } from '@/components/IncidentDialog';
import { BaseLocationDialog } from '@/components/BaseLocationDialog';
import { CopilotPanel } from '@/components/CopilotPanel';
import { EndOfVideoDialog } from '@/components/EndOfVideoDialog';
import { playStartSound, playEndSound } from '@/utils/sounds';
import type { Segment, LatLng, IncidentCategory, IncidentImpact, BaseLocation, TrackSession, AcquisitionMode } from '@/types/route';
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
  trackSession: TrackSession | null;
  workDay: number;
  activeRouteBlock?: string[];
  onToggleGps: (enabled: boolean) => void;
  onConfirmStart: (segmentId: string) => void;
  onComplete: (segmentId: string) => void;
  onResetSegment: (segmentId: string) => void;
  onAddIncident: (segmentId: string, category: IncidentCategory, impact: IncidentImpact, note?: string, location?: LatLng, currentSegmentNonRecordable?: boolean) => void;
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
  onFinalizeTrack: () => void;
  onSkipSegment: (segmentId: string) => void;
  onSetWorkDay: (day: number) => void;
  /** Whether the end-of-video modal is blocking actions */
  videoEndBlocking?: boolean;
  onVideoEndContinue?: () => void;
  onVideoEndCancel?: () => void;
  /** Acquisition mode */
  acquisitionMode: AcquisitionMode;
  onSetAcquisitionMode: (mode: AcquisitionMode) => void;
  /** Copilot session props */
  copilotSession: import('@/hooks/useCopilotSession').CopilotSession | null;
  copilotActive: boolean;
  onCopilotStart: () => Promise<import('@/hooks/useCopilotSession').CopilotSession | null>;
  onCopilotEnd: () => Promise<void>;
  onForceSendBatch?: () => void;
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
  onFinalizeTrack,
  trackSession,
  onSkipSegment,
  onSetWorkDay,
  workDay,
  activeRouteBlock,
  videoEndBlocking,
  onVideoEndContinue,
  onVideoEndCancel,
  copilotSession,
  copilotActive,
  onCopilotStart,
  onCopilotEnd,
  onForceSendBatch,
  acquisitionMode,
  onSetAcquisitionMode,
}: Props) {
  const [expanded, setExpanded] = useState(true);
  const [statusFilter, setStatusFilter] = useState<FilterType>(loadFilter);
  const [showSecondary, setShowSecondary] = useState(false);

  // Compute valid completed count in current track (RST mode)
  const rstValidCount = useMemo(() => {
    if (!rstMode || !trackSession) return 0;
    return segments.filter(
      (s) =>
        s.trackNumber === trackSession.trackNumber &&
        s.status === 'completado' &&
        !s.nonRecordable &&
        !s.needsRepeat
    ).length;
  }, [rstMode, trackSession, segments]);

  const isBlocked = !!videoEndBlocking;

  const handleFilterChange = (f: FilterType) => {
    setStatusFilter(f);
    try { localStorage.setItem(FILTER_KEY, f); } catch {}
  };

  const posibleRepetir = segments.filter((s) => s.status === 'posible_repetir').length;

  const activeSegment = segments.find((s) => s.id === activeSegmentId);
  const pending = segments.filter((s) => s.status === 'pendiente').length;
  const completed = segments.filter((s) => s.status === 'completado').length;
  const noVisiblePending = pending === 0;
  const noVisibleSegments = segments.length === 0;

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

  // Pinned segment: active (en_progreso) or explicitly selected or next pending
  const pinnedSegment = activeSegment?.status === 'en_progreso'
    ? activeSegment
    : activeSegment ?? nextPending;

  // Compute prev/next segment relative to pinned/active in itinerary
  const currentIdx = useMemo(() => {
    const id = activeSegmentId || nextPending?.id;
    if (!id) return -1;
    return orderedSegments.findIndex((s) => s.id === id);
  }, [orderedSegments, activeSegmentId, nextPending?.id]);

  const canGoPrev = useMemo(() => {
    if (currentIdx <= 0) return false;
    const prev = orderedSegments[currentIdx - 1];
    return prev && (prev.status === 'pendiente' || prev.status === 'posible_repetir' || prev.status === 'completado');
  }, [currentIdx, orderedSegments]);

  const canGoNext = currentIdx >= 0 && currentIdx < orderedSegments.length - 1;

  const handlePrev = () => {
    if (!canGoPrev) return;
    const prev = orderedSegments[currentIdx - 1];
    if (prev) onSegmentSelect(prev.id);
  };

  const handleNext = () => {
    if (!canGoNext) return;
    const next = orderedSegments[currentIdx + 1];
    if (next) onSegmentSelect(next.id);
  };

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
          <div className="px-2 pb-1.5 space-y-1">
            {/* Pinned segment */}
            {pinnedSegment && pinnedSegment.status === 'en_progreso' && (
              <div className="flex items-center gap-1">
                <p className="flex-1 min-w-0 text-[10px] text-primary font-medium truncate">● {pinnedSegment.name}</p>
                <Button size="sm" onClick={() => handleComplete(pinnedSegment.id)} className="h-8 px-3 text-[10px] bg-success text-success-foreground">
                  <Square className="w-3 h-3 mr-0.5" />
                  Fin
                </Button>
                <IncidentDialog onSubmit={(cat, impact, note, nonRec) => onAddIncident(pinnedSegment.id, cat, impact, note, currentPosition ?? undefined, nonRec)}>
                  <Button size="sm" variant="ghost" className="h-8 px-2 text-destructive">
                    <AlertTriangle className="w-3 h-3" />
                  </Button>
                </IncidentDialog>
              </div>
            )}
            {pinnedSegment && pinnedSegment.status === 'pendiente' && (
              <div className="flex items-center gap-1">
                <span className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0 bg-muted text-muted-foreground">
                  {pinnedSegment.trackNumber ?? (pinnedSegment.plannedTrackNumber ? `P${pinnedSegment.plannedTrackNumber}` : '—')}
                </span>
                <button className="flex-1 min-w-0 text-left" onClick={() => onSegmentSelect(pinnedSegment.id)}>
                  <p className="text-[10px] text-foreground truncate max-w-[120px]">{pinnedSegment.name}</p>
                </button>
                <Button size="sm" onClick={() => { onSegmentSelect(pinnedSegment.id); handleConfirmStart(pinnedSegment.id); }} className="h-8 px-2 text-[10px] bg-primary text-primary-foreground">
                  <Play className="w-3 h-3 mr-0.5" />
                  Iniciar
                </Button>
              </div>
            )}
            {/* Nav controls + Optimize */}
            <div className="flex gap-0.5">
              <Button variant="outline" disabled={!canGoPrev} onClick={handlePrev} size="sm" className="h-7 px-1.5" title="Anterior">
                <ChevronLeft className="w-3 h-3" />
              </Button>
              {navigationActive ? (
                <Button onClick={onStopNavigation} variant="outline" size="sm" className="h-7 px-2 text-[9px] font-bold border-destructive/40 text-destructive">
                  <Square className="w-2.5 h-2.5 mr-0.5" />
                  Stop
                </Button>
              ) : (
                <Button onClick={onStartNavigation} disabled={noVisiblePending || noVisibleSegments} size="sm" className="h-7 px-2 text-[9px] font-bold bg-primary text-primary-foreground">
                  <Navigation className="w-2.5 h-2.5 mr-0.5" />
                  Nav
                </Button>
              )}
              <Button variant="outline" disabled={!canGoNext} onClick={handleNext} size="sm" className="h-7 px-1.5" title="Siguiente">
                <ChevronRight className="w-3 h-3" />
              </Button>
              <Button variant="outline" onClick={onReoptimize} size="sm" className="h-7 px-2 text-[9px]" title="Optimizar todo">
                <RotateCcw className="w-2.5 h-2.5 mr-0.5" />
                Opt
              </Button>
            </div>
            <div className="flex items-center justify-between text-[9px] text-muted-foreground">
              <span>
                {pending}p · {completed}c
                {rstMode && trackSession && (
                  <> · T{trackSession.trackNumber} {rstValidCount}/{rstGroupSize}</>
                )}
              </span>
              <div className="flex items-center gap-1">
                {gpsEnabled ? <LocateFixed className="w-2.5 h-2.5 text-accent" /> : <LocateOff className="w-2.5 h-2.5" />}
                <Switch checked={gpsEnabled} onCheckedChange={onToggleGps} className="scale-[0.6] origin-right" />
              </div>
            </div>
            {rstMode && trackSession && (
              <div className="flex items-center gap-1">
                <Progress
                  value={(rstValidCount / rstGroupSize) * 100}
                  className={`h-1.5 flex-1 ${
                    rstValidCount >= rstGroupSize
                      ? '[&>div]:bg-destructive'
                      : rstValidCount >= rstGroupSize - 1
                        ? '[&>div]:bg-amber-500'
                        : '[&>div]:bg-primary'
                  }`}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { if (window.confirm(`¿Finalizar track T${trackSession.trackNumber}?`)) onFinalizeTrack(); }}
                  className="h-5 px-1.5 text-[8px] border-destructive/40 text-destructive hover:bg-destructive/10"
                >
                  <StopCircle className="w-2.5 h-2.5 mr-0.5" />
                  Fin T{trackSession.trackNumber}
                </Button>
              </div>
            )}
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
                  <StatusBadge status={pinnedSegment.status} nonRecordable={pinnedSegment.nonRecordable} needsRepeat={pinnedSegment.needsRepeat} />
                </div>
                <div className="flex gap-2">
                  <Button disabled={isBlocked} onClick={() => handleComplete(pinnedSegment.id)} className="flex-1 h-14 text-sm bg-success text-success-foreground font-bold">
                    <Square className="w-5 h-5 mr-1.5" />
                    Finalizar
                  </Button>
                  <Button disabled={isBlocked} variant="outline" onClick={() => onSkipSegment(pinnedSegment.id)} className="h-14 px-3 border-amber-500/40 text-amber-400 hover:bg-amber-500/10" title="Saltar tramo">
                    <SkipForward className="w-5 h-5" />
                  </Button>
                  <IncidentDialog onSubmit={(cat, impact, note, nonRec) => onAddIncident(pinnedSegment.id, cat, impact, note, currentPosition ?? undefined, nonRec)}>
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
                  {pinnedSegment.trackNumber ?? (pinnedSegment.plannedTrackNumber ? `P${pinnedSegment.plannedTrackNumber}` : '—')}
                </span>
                <button className="flex-1 min-w-0 text-left" onClick={() => onSegmentSelect(pinnedSegment.id)}>
                  <p className="text-[10px] text-muted-foreground">Siguiente tramo</p>
                  <p className="text-xs font-medium text-foreground truncate">{pinnedSegment.name}</p>
                </button>
                {pinnedSegment.id === activeSegmentId && (
                  <Button disabled={isBlocked} onClick={() => handleConfirmStart(pinnedSegment.id)} className="h-12 px-4 text-sm bg-primary text-primary-foreground font-bold">
                    <Play className="w-5 h-5 mr-1" />
                    Iniciar
                  </Button>
                )}
                {pinnedSegment.id !== activeSegmentId && (
                  <Button disabled={isBlocked} variant="outline" onClick={() => onSegmentSelect(pinnedSegment.id)} className="h-12 px-3 text-xs">
                    <MapPin className="w-4 h-4 mr-1" />
                    Ir
                  </Button>
                )}
              </div>
            )}

            {/* === NAV CONTROLS: Prev / Navigate / Next === */}
            <div className="flex gap-1.5">
              <Button
                variant="outline"
                disabled={!canGoPrev}
                onClick={handlePrev}
                className="h-12 px-3"
                title="Tramo anterior"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              {navigationActive ? (
                <Button onClick={onStopNavigation} variant="outline" className="flex-1 h-12 text-sm font-bold border-destructive/40 text-destructive">
                  <Square className="w-4 h-4 mr-1.5" />
                  Detener
                </Button>
              ) : (
                <Button onClick={onStartNavigation} disabled={noVisiblePending || noVisibleSegments} className="flex-1 h-12 text-sm font-bold bg-primary text-primary-foreground">
                  <Navigation className="w-4 h-4 mr-1.5" />
                  {noVisibleSegments ? 'Sin tramos' : 'Navegar'}
                </Button>
              )}
              <Button
                variant="outline"
                disabled={!canGoNext}
                onClick={handleNext}
                className="h-12 px-3"
                title="Tramo siguiente"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
              <CopilotPanel
                session={copilotSession}
                active={copilotActive}
                onStart={onCopilotStart}
                onEnd={onCopilotEnd}
                onForceSendBatch={onForceSendBatch}
              >
                <Button variant="outline" className={`h-12 px-3 ${copilotActive ? 'border-emerald-500/40 text-emerald-500' : ''}`} title="Modo Copiloto">
                  <Radio className="w-4 h-4" />
                </Button>
              </CopilotPanel>
            </div>

            {/* === SUMMARY + GPS === */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="text-accent font-medium">D{workDay}</span>
                <span>{pending} pend.</span>
                <span className="text-success">{completed} compl.</span>
                {posibleRepetir > 0 && <span className="text-amber-400">{posibleRepetir} rep.</span>}
              </div>
              <div className="flex items-center gap-1.5">
                {gpsEnabled ? <LocateFixed className="w-3 h-3 text-accent" /> : <LocateOff className="w-3 h-3" />}
                <Switch checked={gpsEnabled} onCheckedChange={onToggleGps} className="scale-75 origin-right" />
              </div>
            </div>

            {/* === RST BLOCK COUNTER with traffic-light === */}
            {rstMode && trackSession && (() => {
              const ratio = rstValidCount / rstGroupSize;
              const isLast = rstValidCount === rstGroupSize - 1;
              const isFull = rstValidCount >= rstGroupSize;
              // Traffic-light colors
              const dotColor = isFull
                ? 'bg-red-500'
                : isLast
                  ? 'bg-amber-400'
                  : 'bg-emerald-500';
              const borderColor = isFull
                ? 'border-red-500/40'
                : isLast
                  ? 'border-amber-400/40'
                  : 'border-border';
              const label = isFull
                ? 'Bloque lleno — preparar nueva medición'
                : isLast
                  ? 'Último tramo del bloque'
                  : `Tramos grabados: ${rstValidCount} / ${rstGroupSize}`;
              return (
                <div className={`bg-secondary/60 border ${borderColor} rounded-lg px-2.5 py-1.5 flex items-center gap-2`}>
                  <span className={`w-3 h-3 rounded-full ${dotColor} flex-shrink-0`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-foreground">
                      BLOQUE / TRACK {trackSession.trackNumber}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{label}</p>
                    <Progress value={ratio * 100} className="h-1.5 mt-1" />
                  </div>
                </div>
              );
            })()}

            {noVisiblePending && segments.length > 0 && !navigationActive && (
              <p className="text-[10px] text-amber-400 text-center py-1">No hay tramos visibles pendientes. Cambia el filtro de capas.</p>
            )}

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
                    Optimizar todo
                  </Button>
                  <BaseLocationDialog currentBase={base} currentPosition={currentPosition} onSetBase={onSetBase}>
                    <Button variant="outline" size="sm" className={`h-9 text-xs ${base ? 'border-accent/40 text-accent' : 'border-border text-foreground'}`}>
                      <Home className="w-3.5 h-3.5 mr-1" />
                      {base ? base.label : 'Base'}
                    </Button>
                  </BaseLocationDialog>
                </div>
                {/* Active route block indicator */}
                {activeRouteBlock && activeRouteBlock.length > 0 && (
                  <div className="bg-secondary/60 border border-border rounded-lg px-2.5 py-1.5">
                    <p className="text-[10px] text-muted-foreground">
                      Bloque activo: <span className="font-bold text-foreground">{activeRouteBlock.length}</span> tramos próximos
                    </p>
                  </div>
                )}
                {/* Work Day */}
                <div className="flex items-center gap-2 bg-secondary/50 rounded-lg px-2 py-1.5">
                  <Film className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <label className="text-[10px] text-muted-foreground flex-shrink-0">Día</label>
                  <NumberStepper value={workDay} min={1} max={999} onChange={onSetWorkDay} />
                </div>

                {/* Acquisition Mode */}
                <div className="flex items-center gap-2 bg-secondary/50 rounded-lg px-2 py-1.5">
                  <Film className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <label className="text-[10px] text-muted-foreground flex-shrink-0">Modo</label>
                  <div className="flex gap-0.5">
                    {(['RST', 'GARMIN'] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => onSetAcquisitionMode(m)}
                        className={`px-2 py-0.5 rounded text-[9px] font-bold transition-colors ${
                          acquisitionMode === m
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                {/* RST Mode */}
                <div className="flex items-center gap-2 bg-secondary/50 rounded-lg px-2 py-1.5">
                  <Repeat className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <label className="text-[10px] text-muted-foreground flex-shrink-0">RST</label>
                  <Switch checked={rstMode} onCheckedChange={onSetRstMode} className="scale-75 origin-left" />
                  {rstMode && (
                    <NumberStepper value={rstGroupSize} min={2} max={12} onChange={onSetRstGroupSize} />
                  )}
                </div>

                {/* Track session indicator + finalize */}
                {rstMode && trackSession && trackSession.active && (
                  <div className="flex items-center gap-2 bg-primary/10 border border-primary/30 rounded-lg px-2 py-1.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-medium text-primary">
                        Track {trackSession.trackNumber} · {trackSession.segmentIds.length}/{trackSession.capacity} tramos
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onFinalizeTrack}
                      className="h-7 px-2 text-[10px] border-destructive/40 text-destructive hover:bg-destructive/10"
                    >
                      <StopCircle className="w-3 h-3 mr-1" />
                      Finalizar track
                    </Button>
                  </div>
                )}

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
                          seg.nonRecordable ? 'bg-zinc-800 text-zinc-400'
                          : seg.status === 'completado' ? 'bg-success/20 text-success'
                          : seg.status === 'en_progreso' ? 'bg-primary/20 text-primary'
                          : (seg.status === 'posible_repetir' || seg.needsRepeat) ? 'bg-amber-500/20 text-amber-400'
                          : seg.plannedTrackNumber ? 'bg-blue-500/10 text-blue-400 border border-dashed border-blue-400/40'
                          : 'bg-muted text-muted-foreground'
                        }`}>
                          {seg.trackNumber ?? (seg.plannedTrackNumber ? `P${seg.plannedTrackNumber}` : '—')}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="text-[9px] text-muted-foreground truncate block">{seg.name}</span>
                        </div>
                        <StatusBadge status={seg.status} nonRecordable={seg.nonRecordable} needsRepeat={seg.needsRepeat} />
                      </button>
                      {/* Incident button – available on any status */}
                      <IncidentDialog onSubmit={(cat, impact, note, nonRec) => onAddIncident(seg.id, cat, impact, note, currentPosition ?? undefined, nonRec)}>
                        <Button size="sm" variant="ghost" onClick={(e) => e.stopPropagation()} className="h-6 px-1 text-muted-foreground hover:text-destructive" title="Incidencia">
                          <AlertTriangle className="w-3 h-3" />
                        </Button>
                      </IncidentDialog>
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
      {/* End of video blocking modal */}
      <EndOfVideoDialog
        open={!!videoEndBlocking}
        trackNumber={trackSession?.trackNumber ?? 0}
        rstGroupSize={rstGroupSize}
        onContinue={() => onVideoEndContinue?.()}
      />
    </div>
  );
}
