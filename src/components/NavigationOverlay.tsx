import { useState, useCallback } from 'react';
import {
  Navigation, Play, Clock, AlertTriangle, MapPin,
  Gauge, SkipForward, Activity, ArrowDownLeft,
  ShieldAlert, Flag, Ban, RotateCcw, Zap,
  ChevronRight, Target, Milestone, WifiOff, Wifi,
  ChevronUp, ChevronDown, Minimize2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { IncidentDialog } from '@/components/IncidentDialog';
import type { Segment, LatLng, IncidentCategory, IncidentImpact } from '@/types/route';
import type { NavOperationalState, ContiguousInfo, NavSegmentStats } from '@/hooks/useNavigationTracker';

export type PanelMode = 'mini' | 'operation' | 'expanded';

interface Props {
  segment: Segment;
  operationalState: NavOperationalState;
  distanceToStart: number | null;
  distanceToEnd: number | null;
  etaToStart: number | null;
  progressPercent: number;
  distanceRemaining: number | null;
  totalDistance: number;
  speedKmh: number;
  deviationMeters: number;
  showApproachPrompt: boolean;
  onStartSegment: () => void;
  onCompleteSegment: () => void;
  onSkipSegment: () => void;
  onPostpone: () => void;
  onAddIncident: (cat: IncidentCategory, impact: IncidentImpact, note?: string, nonRec?: boolean) => void;
  onRestartSegment: () => void;
  onMarkF5: () => void;
  currentPosition: LatLng | null;
  isBlocked: boolean;
  isInvalidated: boolean;
  contiguousInfo: ContiguousInfo;
  activeReference: 'ref_300m' | 'ref_150m' | 'ref_30m' | 'end_ref_300m' | 'end_ref_150m' | 'end_ref_30m' | null;
  headingDelta: number;
  stats: NavSegmentStats;
  approachSequenceValid: boolean;
  geometricRecoveryOnly: boolean;
  // Block/segment counters
  blockNumber?: number;
  segmentIndexInBlock?: number;
  totalSegmentsInBlock?: number;
  // Counters
  pendingCount?: number;
  completedCount?: number;
  repeatCount?: number;
}

function formatDistance(meters: number | null): string {
  if (meters == null) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatEta(seconds: number | null): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `< 1 min`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Status colors: green=in progress, blue=pending, orange=repeat, red=incident
function getStatusColor(state: NavOperationalState): string {
  const RECORDING_STATES: NavOperationalState[] = ['recording', 'end_ref_300m', 'end_ref_150m', 'end_ref_30m', 'ready_f5_end'];
  const APPROACH_STATES: NavOperationalState[] = ['approaching', 'ref_300m', 'ref_150m', 'ref_30m', 'ready_f5_start'];
  const INVALID_STATES: NavOperationalState[] = ['deviated', 'wrong_direction', 'invalidated'];

  if (RECORDING_STATES.includes(state)) return 'bg-success/20 text-success border-success/40';
  if (APPROACH_STATES.includes(state)) return 'bg-blue-500/20 text-blue-400 border-blue-500/40';
  if (INVALID_STATES.includes(state)) return 'bg-destructive/20 text-destructive border-destructive/60';
  if (state === 'pre_alert' || state === 'gps_unstable') return 'bg-amber-500/20 text-amber-400 border-amber-500/40';
  if (state === 'completed') return 'bg-success/20 text-success border-success/40';
  return 'bg-muted text-muted-foreground border-border';
}

const STATE_LABELS: Record<NavOperationalState, string> = {
  idle: 'Inactivo',
  approaching: 'En aproximación',
  ref_300m: 'Ref. 300 m',
  ref_150m: 'Ref. 150 m',
  ref_30m: 'Ref. 30 m',
  ready_f5_start: '⏎ F5 INICIO',
  recording: 'Grabando',
  gps_unstable: '⚠ GPS inestable',
  pre_alert: 'Prealerta',
  deviated: '✖ Desvío',
  wrong_direction: '✖ Sentido incorrecto',
  end_ref_300m: 'Cierre 300 m',
  end_ref_150m: 'Cierre 150 m',
  end_ref_30m: 'Cierre 30 m',
  ready_f5_end: '⏎ F5 CIERRE',
  invalidated: '✖ INVALIDADO',
  interrupted: 'Interrumpido',
  completed: 'Completado',
};

const STATE_ICONS: Record<NavOperationalState, typeof Navigation> = {
  idle: Navigation,
  approaching: Navigation,
  ref_300m: Milestone,
  ref_150m: Milestone,
  ref_30m: Target,
  ready_f5_start: Zap,
  recording: Activity,
  gps_unstable: WifiOff,
  pre_alert: ShieldAlert,
  deviated: Ban,
  wrong_direction: ArrowDownLeft,
  end_ref_300m: Flag,
  end_ref_150m: Flag,
  end_ref_30m: Target,
  ready_f5_end: Zap,
  invalidated: Ban,
  interrupted: AlertTriangle,
  completed: Navigation,
};

const APPROACH_STATES: NavOperationalState[] = ['approaching', 'ref_300m', 'ref_150m', 'ref_30m', 'ready_f5_start'];
const RECORDING_STATES: NavOperationalState[] = ['recording', 'pre_alert', 'gps_unstable', 'end_ref_300m', 'end_ref_150m', 'end_ref_30m', 'ready_f5_end'];
const INVALID_STATES: NavOperationalState[] = ['deviated', 'wrong_direction', 'invalidated'];

export function NavigationOverlay({
  segment,
  operationalState,
  distanceToStart,
  distanceToEnd,
  etaToStart,
  progressPercent,
  distanceRemaining,
  totalDistance,
  speedKmh,
  deviationMeters,
  showApproachPrompt,
  onStartSegment,
  onCompleteSegment,
  onSkipSegment,
  onPostpone,
  onAddIncident,
  onRestartSegment,
  onMarkF5,
  currentPosition,
  isBlocked,
  isInvalidated,
  contiguousInfo,
  activeReference,
  headingDelta,
  stats,
  approachSequenceValid,
  geometricRecoveryOnly,
  blockNumber = 0,
  segmentIndexInBlock = 0,
  totalSegmentsInBlock = 0,
  pendingCount = 0,
  completedCount = 0,
  repeatCount = 0,
}: Props) {
  const [mode, setMode] = useState<PanelMode>('mini');

  const isApproach = APPROACH_STATES.includes(operationalState);
  const isRecording = RECORDING_STATES.includes(operationalState);
  const isInvalid = INVALID_STATES.includes(operationalState);
  const direction = segment.kmlMeta?.sentido || segment.direction || '—';

  const startedAt = segment.startedAt ? new Date(segment.startedAt).getTime() : null;
  const [, setTick] = useState(0);
  if (isRecording && startedAt) {
    setTimeout(() => setTick((t) => t + 1), 1000);
  }
  const elapsed = startedAt ? (Date.now() - startedAt) / 1000 : 0;

  const StatusIcon = STATE_ICONS[operationalState];
  const statusColor = getStatusColor(operationalState);

  const cycleMode = useCallback(() => {
    setMode((m) => {
      if (m === 'mini') return 'operation';
      if (m === 'operation') return 'expanded';
      return 'mini';
    });
  }, []);

  const panelHeight = mode === 'mini' ? 'max-h-[18vh]' : mode === 'operation' ? 'max-h-[30vh]' : 'max-h-[45vh]';

  return (
    <div className={`flex flex-col bg-card border-t border-border ${panelHeight} overflow-y-auto transition-all duration-200`}>
      {/* ── Drag handle + mode toggle ── */}
      <button
        onClick={cycleMode}
        className="flex items-center justify-center py-1 gap-1 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
      >
        <div className="w-8 h-1 rounded-full bg-border" />
        {mode === 'mini' ? <ChevronUp className="w-3 h-3" /> : mode === 'expanded' ? <ChevronDown className="w-3 h-3" /> : <Minimize2 className="w-3 h-3" />}
      </button>

      {/* ── Status strip ── */}
      <div className={`px-3 py-1 flex items-center gap-2 border-b ${statusColor} flex-shrink-0`}>
        <StatusIcon className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="text-xs font-bold uppercase tracking-wider flex-1 truncate">{STATE_LABELS[operationalState]}</span>
        {(operationalState === 'deviated' || operationalState === 'pre_alert') && (
          <span className="text-[10px] font-mono">↕ {Math.round(deviationMeters)}m</span>
        )}
        {blockNumber > 0 && (
          <span className="text-[10px] font-medium opacity-70">
            Bloque {blockNumber} · Tramo {segmentIndexInBlock}/{totalSegmentsInBlock}
          </span>
        )}
      </div>

      {/* ── MINI MODE: core info + action buttons ── */}
      <div className="px-3 py-1.5 flex items-center gap-2 flex-shrink-0">
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-foreground truncate">{segment.name}</h2>
          {segment.companySegmentId && (
            <span className="text-[9px] font-mono text-muted-foreground">{segment.companySegmentId}</span>
          )}
        </div>

        {/* Speed indicator */}
        <div className="text-center flex-shrink-0">
          <p className="text-lg font-bold text-foreground leading-none">{Math.round(speedKmh)}</p>
          <p className="text-[8px] text-muted-foreground">km/h</p>
        </div>
      </div>

      {/* Progress bar (always visible in recording) */}
      {isRecording && (
        <div className="px-3 pb-1 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Progress value={progressPercent} className="h-1.5 flex-1" />
            <span className="text-[10px] font-bold text-foreground w-8 text-right">{Math.round(progressPercent)}%</span>
          </div>
        </div>
      )}

      {/* Distance to start (approach) */}
      {isApproach && (
        <div className="px-3 pb-1 flex-shrink-0">
          <div className="flex items-center gap-3 text-xs">
            <span className="text-muted-foreground">Al inicio:</span>
            <span className="font-bold text-foreground">{formatDistance(distanceToStart)}</span>
            <span className="text-muted-foreground ml-auto">ETA:</span>
            <span className="font-bold text-foreground">{formatEta(etaToStart)}</span>
          </div>
        </div>
      )}

      {/* ── Action buttons (always visible) ── */}
      <div className="px-3 py-1.5 flex gap-2 flex-shrink-0">
        {/* F5 Start prompt */}
        {showApproachPrompt && (
          <Button
            disabled={isBlocked}
            onClick={() => { onMarkF5(); onStartSegment(); }}
            className="flex-1 driving-button bg-primary text-primary-foreground"
          >
            <Play className="w-5 h-5 mr-1" />
            F5 Inicio
          </Button>
        )}

        {/* F5 End prompt */}
        {operationalState === 'ready_f5_end' && (
          <Button
            onClick={() => { onMarkF5(); onCompleteSegment(); }}
            className="flex-1 driving-button bg-primary text-primary-foreground"
          >
            <Flag className="w-5 h-5 mr-1" />
            {contiguousInfo.isContiguous ? 'F5 Fin/Inicio' : 'F5 Cierre'}
          </Button>
        )}

        {/* Recording: F5 mark button */}
        {isRecording && operationalState !== 'ready_f5_end' && !showApproachPrompt && (
          <Button
            onClick={() => { onMarkF5(); onCompleteSegment(); }}
            className="flex-1 driving-button bg-success text-success-foreground"
          >
            <Flag className="w-5 h-5 mr-1" />
            Finalizar
          </Button>
        )}

        {/* Invalidation: restart button */}
        {isInvalid && (
          <Button
            onClick={onRestartSegment}
            className="flex-1 driving-button bg-primary text-primary-foreground"
          >
            <RotateCcw className="w-5 h-5 mr-1" />
            Reiniciar
          </Button>
        )}

        {/* Skip / postpone */}
        {!isRecording && !isInvalid && !showApproachPrompt && operationalState !== 'ready_f5_end' && (
          <Button
            onClick={onSkipSegment}
            variant="outline"
            className="flex-1 driving-button border-border"
          >
            <SkipForward className="w-5 h-5 mr-1" />
            Saltar
          </Button>
        )}
        {showApproachPrompt && (
          <Button onClick={onPostpone} variant="outline" className="driving-button border-border px-4">
            <SkipForward className="w-5 h-5" />
          </Button>
        )}

        {/* Incident always available */}
        <IncidentDialog onSubmit={(cat, impact, note, nonRec) => onAddIncident(cat, impact, note, nonRec)}>
          <Button variant="outline" className="driving-button border-destructive/40 text-destructive px-4">
            <AlertTriangle className="w-5 h-5" />
          </Button>
        </IncidentDialog>
      </div>

      {/* ── OPERATION MODE: additional info ── */}
      {mode !== 'mini' && (
        <div className="px-3 py-1.5 border-t border-border space-y-2 flex-shrink-0">
          {/* Counters row */}
          <div className="flex items-center gap-3 text-[10px]">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
              <span className="text-muted-foreground">Pendientes:</span>
              <span className="font-bold text-foreground">{pendingCount}</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-success inline-block" />
              <span className="text-muted-foreground">Completados:</span>
              <span className="font-bold text-foreground">{completedCount}</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
              <span className="text-muted-foreground">Repetir:</span>
              <span className="font-bold text-foreground">{repeatCount}</span>
            </span>
          </div>

          {/* Segment details */}
          <div className="grid grid-cols-4 gap-1.5">
            <div className="bg-secondary/60 rounded-lg p-1.5 text-center">
              <p className="text-[8px] text-muted-foreground">Sentido</p>
              <p className="text-xs font-bold text-foreground truncate">{direction}</p>
            </div>
            {segment.layer && (
              <div className="bg-secondary/60 rounded-lg p-1.5 text-center">
                <p className="text-[8px] text-muted-foreground">Capa</p>
                <p className="text-xs font-bold text-foreground truncate">{segment.layer}</p>
              </div>
            )}
            <div className="bg-secondary/60 rounded-lg p-1.5 text-center">
              <p className="text-[8px] text-muted-foreground">Total</p>
              <p className="text-xs font-bold text-foreground">{formatDistance(totalDistance)}</p>
            </div>
            {isRecording && (
              <div className="bg-secondary/60 rounded-lg p-1.5 text-center">
                <Clock className="w-3 h-3 mx-auto text-muted-foreground" />
                <p className="text-xs font-bold text-foreground">{formatDuration(elapsed)}</p>
              </div>
            )}
          </div>

          {/* Reference markers */}
          {isApproach && (
            <ReferenceMarkers distanceToStart={distanceToStart} activeReference={activeReference} type="start" />
          )}
          {(operationalState === 'end_ref_300m' || operationalState === 'end_ref_150m' || operationalState === 'end_ref_30m' || operationalState === 'ready_f5_end') && (
            <ReferenceMarkers distanceToStart={distanceRemaining} activeReference={activeReference} type="end" />
          )}

          {/* Contiguous transition notice */}
          {contiguousInfo.isContiguous && operationalState === 'ready_f5_end' && (
            <div className="bg-accent/10 border border-accent/30 rounded-lg p-2 flex items-center gap-2">
              <ChevronRight className="w-4 h-4 text-accent flex-shrink-0" />
              <p className="text-[10px] text-accent">
                Transición directa → <strong>{contiguousInfo.nextSegmentName}</strong> ({Math.round(contiguousInfo.distanceBetween)}m)
              </p>
            </div>
          )}

          {/* Invalidation detail */}
          {isInvalid && (
            <div className="bg-destructive/10 border border-destructive/40 rounded-lg p-2">
              <p className="text-[10px] text-destructive">
                {operationalState === 'wrong_direction'
                  ? 'Circulación en sentido contrario al planificado.'
                  : operationalState === 'deviated'
                    ? `Desvío confirmado a ${Math.round(deviationMeters)}m del eje.`
                    : 'Validez operativa perdida. Reiniciar desde posición de aproximación.'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── EXPANDED MODE: validation metrics ── */}
      {mode === 'expanded' && (
        <div className="px-3 py-1.5 border-t border-border space-y-2 flex-shrink-0">
          {/* Validation strip */}
          <div className="grid grid-cols-4 gap-1.5">
            <div className="bg-secondary/60 rounded-lg p-1.5 text-center">
              <p className="text-[8px] text-muted-foreground">Cobertura</p>
              <p className={`text-xs font-bold ${stats.validCoveragePercent >= 85 ? 'text-success' : 'text-amber-400'}`}>
                {stats.validCoveragePercent.toFixed(0)}%
              </p>
            </div>
            <div className="bg-secondary/60 rounded-lg p-1.5 text-center">
              <p className="text-[8px] text-muted-foreground">Desv. lat.</p>
              <p className="text-xs font-bold text-foreground">{Math.round(deviationMeters)}m</p>
            </div>
            <div className={`rounded-lg p-1.5 text-center ${
              headingDelta <= 45 ? 'bg-success/10' : headingDelta <= 90 ? 'bg-amber-500/10' : 'bg-destructive/10'
            }`}>
              <p className="text-[8px] text-muted-foreground">Rumbo Δ</p>
              <p className={`text-xs font-bold ${
                headingDelta <= 45 ? 'text-success' : headingDelta <= 90 ? 'text-amber-400' : 'text-destructive'
              }`}>{Math.round(headingDelta)}°</p>
            </div>
            <div className="bg-secondary/60 rounded-lg p-1.5 text-center">
              <p className="text-[8px] text-muted-foreground">Intento</p>
              <p className="text-xs font-bold text-foreground">{stats.attemptNumber}</p>
            </div>
          </div>

          {/* Warnings */}
          {!approachSequenceValid && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg px-2 py-1">
              <p className="text-[9px] text-destructive font-bold">⚠ Secuencia de aproximación 300→150→30 incompleta</p>
            </div>
          )}
          {geometricRecoveryOnly && isInvalidated && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-2 py-1 flex items-center gap-2">
              <Wifi className="w-3 h-3 text-amber-400 flex-shrink-0" />
              <p className="text-[9px] text-amber-400">Recuperación solo geométrica — tramo sigue invalidado</p>
            </div>
          )}
          {operationalState === 'gps_unstable' && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-2 py-1 flex items-center gap-2">
              <WifiOff className="w-3 h-3 text-amber-400 flex-shrink-0 animate-pulse" />
              <p className="text-[9px] text-amber-400">Señal GPS inestable — avance no se contabiliza</p>
            </div>
          )}
          {operationalState === 'pre_alert' && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-2 py-1 flex items-center gap-2">
              <ShieldAlert className="w-3 h-3 text-amber-400 flex-shrink-0" />
              <p className="text-[9px] text-amber-400">Prealerta — {Math.round(deviationMeters)}m del eje. Corrige trayectoria.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Reference Markers Sub-component ──────────────────────────────────
function ReferenceMarkers({
  distanceToStart,
  activeReference,
  type,
}: {
  distanceToStart: number | null;
  activeReference: Props['activeReference'];
  type: 'start' | 'end';
}) {
  const refs = type === 'start'
    ? [
        { key: 'ref_300m', label: '300m', dist: 300 },
        { key: 'ref_150m', label: '150m', dist: 150 },
        { key: 'ref_30m', label: '30m', dist: 30 },
      ]
    : [
        { key: 'end_ref_300m', label: '300m', dist: 300 },
        { key: 'end_ref_150m', label: '150m', dist: 150 },
        { key: 'end_ref_30m', label: '30m', dist: 30 },
      ];

  const d = distanceToStart ?? Infinity;

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[8px] text-muted-foreground uppercase tracking-wider">
        {type === 'start' ? 'Refs. inicio' : 'Refs. cierre'}
      </span>
      <div className="flex gap-1 flex-1">
        {refs.map((ref) => {
          const isPassed = d <= ref.dist;
          const isActive = activeReference === ref.key;
          return (
            <div
              key={ref.key}
              className={`flex-1 text-center rounded py-0.5 text-[9px] font-bold transition-all ${
                isActive
                  ? 'bg-primary/30 text-primary border border-primary/50 animate-pulse'
                  : isPassed
                    ? 'bg-success/20 text-success border border-success/30'
                    : 'bg-secondary/40 text-muted-foreground'
              }`}
            >
              {ref.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}
