import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Navigation, Play, Clock, AlertTriangle, MapPin,
  Gauge, SkipForward, Activity, ArrowDownLeft,
  ShieldAlert, Flag, Ban, RotateCcw, Zap,
  ChevronRight, Target, Milestone, Wifi, WifiOff,
  CheckCircle2, CircleDot, ArrowLeftRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { IncidentDialog } from '@/components/IncidentDialog';
import type { Segment, LatLng, IncidentCategory, IncidentImpact, F5Event } from '@/types/route';
import { getRequiredPkMarkers } from '@/types/route';
import type { NavOperationalState, ContiguousInfo, NavSegmentStats } from '@/hooks/useNavigationTracker';
import { playRef300Sound } from '@/utils/sounds';

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
  onInvertSegment?: () => void;
  onRestartSegment: () => void;
  onConfirmF5: (eventType: 'inicio' | 'pk' | 'fin' | 'f7_fin_adquisicion' | 'f9_modo_transporte', distanceMarker?: number) => void;
  currentPosition: LatLng | null;
  isBlocked: boolean;
  isInvalidated: boolean;
  contiguousInfo: ContiguousInfo;
  activeReference: 'ref_300m' | 'ref_150m' | 'ref_30m' | 'end_ref_300m' | 'end_ref_150m' | 'end_ref_30m' | null;
  headingDelta: number;
  stats: NavSegmentStats;
  approachSequenceValid: boolean;
  geometricRecoveryOnly: boolean;
  f5Events: F5Event[];
  distanceCovered: number;
  distancePastEnd: number | null;
  showF7Prompt: boolean;
  showF9PostPrompt: boolean;
  distanceToNextSegment: number | null;
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

const STATE_CONFIG: Record<NavOperationalState, { label: string; colorClass: string; icon: typeof Navigation }> = {
  idle: { label: 'Inactivo', colorClass: 'bg-muted text-muted-foreground', icon: Navigation },
  approaching: { label: 'En aproximación', colorClass: 'bg-accent/20 text-accent border border-accent/40', icon: Navigation },
  strategic_point: { label: 'Punto estratégico', colorClass: 'bg-blue-500/20 text-blue-400 border border-blue-500/40', icon: MapPin },
  ready_f9_pre: { label: '⏎ CONFIRMAR F9 — Salir transporte', colorClass: 'bg-amber-500/20 text-amber-400 border-2 border-amber-500/60 animate-pulse', icon: Zap },
  ref_300m: { label: 'Referencia 300 m', colorClass: 'bg-blue-500/20 text-blue-400 border border-blue-500/40', icon: Milestone },
  ref_150m: { label: 'Referencia 150 m', colorClass: 'bg-amber-500/20 text-amber-400 border border-amber-500/40', icon: Milestone },
  ref_30m: { label: 'Referencia 30 m', colorClass: 'bg-orange-500/20 text-orange-400 border border-orange-500/40 animate-pulse', icon: Target },
  ready_f5_start: { label: '⏎ CONFIRMAR F5 — INICIO', colorClass: 'bg-primary/20 text-primary border-2 border-primary/60 animate-pulse', icon: Zap },
  recording: { label: 'En grabación', colorClass: 'bg-success/20 text-success border border-success/40', icon: Activity },
  gps_unstable: { label: '⚠ GPS inestable', colorClass: 'bg-amber-500/20 text-amber-400 border border-amber-500/40 animate-pulse', icon: WifiOff },
  pre_alert: { label: 'Prealerta desvío', colorClass: 'bg-amber-500/20 text-amber-400 border border-amber-500/40', icon: ShieldAlert },
  deviated: { label: '✖ INVALIDADO — Desvío', colorClass: 'bg-destructive/20 text-destructive border-2 border-destructive/60 animate-pulse', icon: Ban },
  wrong_direction: { label: '✖ INVALIDADO — Sentido incorrecto', colorClass: 'bg-destructive/20 text-destructive border-2 border-destructive/60 animate-pulse', icon: ArrowDownLeft },
  past_end: { label: 'Fin de tramo — referencias', colorClass: 'bg-blue-500/20 text-blue-400 border border-blue-500/40', icon: Flag },
  end_ref_30m: { label: 'Cierre — +30 m', colorClass: 'bg-orange-500/20 text-orange-400 border border-orange-500/40 animate-pulse', icon: Flag },
  end_ref_150m: { label: 'Cierre — +150 m', colorClass: 'bg-amber-500/20 text-amber-400 border border-amber-500/40', icon: Flag },
  end_ref_300m: { label: 'Cierre — +300 m', colorClass: 'bg-blue-500/20 text-blue-400 border border-blue-500/40', icon: Flag },
  ready_f5_end: { label: '⏎ CONFIRMAR F5 — CIERRE', colorClass: 'bg-primary/20 text-primary border-2 border-primary/60 animate-pulse', icon: Zap },
  ready_f7: { label: '⏎ CONFIRMAR F7 — Fin adquisición', colorClass: 'bg-amber-500/20 text-amber-400 border-2 border-amber-500/60 animate-pulse', icon: Flag },
  ready_f9_post: { label: '⏎ CONFIRMAR F9 — Modo transporte', colorClass: 'bg-amber-500/20 text-amber-400 border-2 border-amber-500/60 animate-pulse', icon: Navigation },
  invalidated: { label: '✖ TRAMO INVALIDADO', colorClass: 'bg-destructive/20 text-destructive border-2 border-destructive/60', icon: Ban },
  interrupted: { label: 'Interrumpido', colorClass: 'bg-amber-500/20 text-amber-400 border border-amber-500/40', icon: AlertTriangle },
  completed: { label: 'Completado', colorClass: 'bg-success/20 text-success', icon: Navigation },
};

const APPROACH_STATES: NavOperationalState[] = ['approaching', 'strategic_point', 'ready_f9_pre', 'ref_300m', 'ref_150m', 'ref_30m', 'ready_f5_start'];
const RECORDING_STATES: NavOperationalState[] = ['recording', 'pre_alert', 'gps_unstable', 'past_end', 'end_ref_30m', 'end_ref_150m', 'end_ref_300m', 'ready_f5_end', 'ready_f7', 'ready_f9_post'];
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
  onInvertSegment,
  onRestartSegment,
  onConfirmF5,
  currentPosition,
  isBlocked,
  isInvalidated,
  contiguousInfo,
  activeReference,
  headingDelta,
  stats,
  approachSequenceValid,
  geometricRecoveryOnly,
  f5Events,
  distanceCovered,
  distancePastEnd,
  showF7Prompt,
  showF9PostPrompt,
  distanceToNextSegment,
}: Props) {
  const config = STATE_CONFIG[operationalState];
  const isApproach = APPROACH_STATES.includes(operationalState);
  const isRecording = RECORDING_STATES.includes(operationalState);
  const isInvalid = INVALID_STATES.includes(operationalState);
  const direction = segment.kmlMeta?.sentido || segment.direction || '—';

  const [, setTick] = useState(0);
  const startedAt = segment.startedAt ? new Date(segment.startedAt).getTime() : null;
  if (isRecording && startedAt) {
    setTimeout(() => setTick((t) => t + 1), 1000);
  }
  const elapsed = startedAt ? (Date.now() - startedAt) / 1000 : 0;

  // PK milestone tracking
  const requiredPkMarkers = useMemo(() => getRequiredPkMarkers(totalDistance), [totalDistance]);
  const [pendingPk, setPendingPk] = useState<number | null>(null);
  const triggeredPksRef = useRef<Set<number>>(new Set());

  // Reset triggered PKs when segment changes
  const segIdRef = useRef(segment.id);
  useEffect(() => {
    if (segment.id !== segIdRef.current) {
      segIdRef.current = segment.id;
      triggeredPksRef.current = new Set();
      setPendingPk(null);
    }
  }, [segment.id]);

  // Detect when a PK milestone is reached
  useEffect(() => {
    if (!isRecording || pendingPk !== null) return;
    for (const pk of requiredPkMarkers) {
      if (distanceCovered >= pk && !triggeredPksRef.current.has(pk)) {
        // Check if already confirmed via f5Events
        const alreadyConfirmed = f5Events.some(
          (e) => e.eventType === 'pk' && e.distanceMarker === pk && e.segmentId === segment.id
        );
        if (!alreadyConfirmed) {
          triggeredPksRef.current.add(pk);
          setPendingPk(pk);
          // Play sound
          try { playRef300Sound(); } catch {}
          try { navigator.vibrate?.([150, 50, 150]); } catch {}
          break;
        } else {
          triggeredPksRef.current.add(pk);
        }
      }
    }
  }, [distanceCovered, isRecording, requiredPkMarkers, pendingPk, f5Events, segment.id]);

  const handleConfirmPk = () => {
    if (pendingPk !== null) {
      onConfirmF5('pk', pendingPk);
      setPendingPk(null);
    }
  };

  // F5 summary helper
  const f5StartConfirmed = f5Events.some((e) => e.eventType === 'inicio' && e.segmentId === segment.id);
  const f5EndConfirmed = f5Events.some((e) => e.eventType === 'fin' && e.segmentId === segment.id);
  const confirmedPks = new Set(
    f5Events.filter((e) => e.eventType === 'pk' && e.segmentId === segment.id).map((e) => e.distanceMarker)
  );
  const hasPendingF5 = requiredPkMarkers.some((pk) => !confirmedPks.has(pk));

  return (
    <div className="absolute top-0 left-0 right-0 z-30 pointer-events-none">
      {/* === TOP HUD BAR === */}
      <div className="mx-2 mt-2 pointer-events-auto">
        <div className="bg-card/95 backdrop-blur-md border border-border rounded-xl shadow-2xl overflow-hidden">
          {/* Status bar */}
          <div className={`px-3 py-1.5 flex items-center gap-2 ${config.colorClass}`}>
            <config.icon className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="text-xs font-bold uppercase tracking-wider">{config.label}</span>
            {(operationalState === 'deviated' || operationalState === 'pre_alert') && (
              <span className="text-[10px] ml-auto font-mono">↕ {Math.round(deviationMeters)}m</span>
            )}
            {operationalState === 'wrong_direction' && (
              <span className="text-[10px] ml-auto font-mono">⇠ sentido opuesto</span>
            )}
          </div>

          {/* Segment info */}
          <div className="px-3 py-2 space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-bold text-foreground truncate">{segment.name}</h2>
                <div className="flex items-center gap-2 mt-0.5">
                  {segment.companySegmentId && (
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 font-mono">
                      {segment.companySegmentId}
                    </Badge>
                  )}
                  {segment.layer && (
                    <span className="text-[9px] text-muted-foreground truncate">{segment.layer}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground">Sentido</p>
                  <p className="text-xs font-medium text-foreground">{direction}</p>
                </div>
                {onInvertSegment && !isRecording && (
                  <button
                    onClick={onInvertSegment}
                    className="p-1.5 rounded-lg bg-accent/20 border border-accent/40 text-accent hover:bg-accent/30 transition-colors"
                    title="Invertir tramo (intercambiar inicio/fin)"
                  >
                    <ArrowLeftRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* === APPROACH METRICS + REFERENCE MARKERS === */}
            {isApproach && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-secondary/60 rounded-lg p-1.5 text-center">
                    <p className="text-[9px] text-muted-foreground">Dist. inicio</p>
                    <p className="text-sm font-bold text-foreground">{formatDistance(distanceToStart)}</p>
                  </div>
                  <div className="bg-secondary/60 rounded-lg p-1.5 text-center">
                    <p className="text-[9px] text-muted-foreground">ETA</p>
                    <p className="text-sm font-bold text-foreground">{formatEta(etaToStart)}</p>
                  </div>
                  <div className="bg-secondary/60 rounded-lg p-1.5 text-center">
                    <p className="text-[9px] text-muted-foreground">Velocidad</p>
                    <p className="text-sm font-bold text-foreground">{Math.round(speedKmh)} <span className="text-[9px] font-normal">km/h</span></p>
                  </div>
                </div>

                {/* Reference markers indicator */}
                <ReferenceMarkers
                  distanceToStart={distanceToStart}
                  activeReference={activeReference}
                  type="start"
                />
              </>
            )}

            {/* === RECORDING METRICS === */}
            {isRecording && (
              <>
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[9px] text-muted-foreground">Progreso</span>
                    <span className="text-[9px] font-bold text-foreground">{Math.round(progressPercent)}%</span>
                  </div>
                  <Progress value={progressPercent} className="h-2" />
                </div>

                <div className="grid grid-cols-4 gap-1.5">
                  <div className="bg-secondary/60 rounded-lg p-1 text-center">
                    <p className="text-[8px] text-muted-foreground">Restante</p>
                    <p className="text-xs font-bold text-foreground">{formatDistance(distanceRemaining)}</p>
                  </div>
                  <div className="bg-secondary/60 rounded-lg p-1 text-center">
                    <Gauge className="w-3 h-3 mx-auto text-muted-foreground" />
                    <p className="text-xs font-bold text-foreground">{Math.round(speedKmh)}</p>
                  </div>
                  <div className="bg-secondary/60 rounded-lg p-1 text-center">
                    <Clock className="w-3 h-3 mx-auto text-muted-foreground" />
                    <p className="text-xs font-bold text-foreground">{formatDuration(elapsed)}</p>
                  </div>
                  <div className={`rounded-lg p-1 text-center ${
                    headingDelta <= 45
                      ? 'bg-success/10'
                      : headingDelta <= 90
                        ? 'bg-amber-500/10'
                        : 'bg-destructive/10'
                  }`}>
                    <p className="text-[8px] text-muted-foreground">Rumbo Δ</p>
                    <p className={`text-xs font-bold ${
                      headingDelta <= 45 ? 'text-success' : headingDelta <= 90 ? 'text-amber-400' : 'text-destructive'
                    }`}>{Math.round(headingDelta)}°</p>
                  </div>
                </div>

                {/* Validation metrics strip */}
                <div className="flex items-center gap-2 text-[8px]">
                  <span className="text-muted-foreground">Cobertura válida:</span>
                  <span className={`font-bold ${stats.validCoveragePercent >= 85 ? 'text-success' : 'text-amber-400'}`}>
                    {stats.validCoveragePercent.toFixed(0)}%
                  </span>
                  <span className="text-muted-foreground ml-auto">↕ {Math.round(deviationMeters)}m</span>
                  {!approachSequenceValid && (
                    <span className="text-destructive font-bold">⚠ Aprox. incompleta</span>
                  )}
                </div>

                {/* F5 Summary strip */}
                <F5SummaryStrip
                  f5StartConfirmed={f5StartConfirmed}
                  f5EndConfirmed={f5EndConfirmed}
                  requiredPkMarkers={requiredPkMarkers}
                  confirmedPks={confirmedPks}
                />

                {/* End reference markers - show past-end distance */}
                {(operationalState === 'past_end' || operationalState === 'end_ref_30m' || operationalState === 'end_ref_150m' || operationalState === 'end_ref_300m' || operationalState === 'ready_f5_end') && (
                  <ReferenceMarkers
                    distanceToStart={distancePastEnd}
                    activeReference={activeReference}
                    type="end"
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* === GPS UNSTABLE WARNING === */}
      {operationalState === 'gps_unstable' && (
        <div className="mx-2 mt-2 pointer-events-auto">
          <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-2.5 flex items-center gap-3">
            <WifiOff className="w-5 h-5 text-amber-400 flex-shrink-0 animate-pulse" />
            <div className="flex-1">
              <p className="text-xs font-bold text-amber-400">Señal GPS inestable</p>
              <p className="text-[10px] text-amber-400/70">Posicionamiento poco fiable. El avance no se contabiliza como válido.</p>
            </div>
          </div>
        </div>
      )}

      {/* === GEOMETRIC RECOVERY WARNING (operational still invalid) === */}
      {geometricRecoveryOnly && isInvalidated && (
        <div className="mx-2 mt-2 pointer-events-auto">
          <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-2 flex items-center gap-3">
            <Wifi className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-[10px] font-bold text-amber-400">Recuperación solo geométrica</p>
              <p className="text-[9px] text-amber-400/70">Estás sobre el eje, pero el tramo sigue invalidado operativamente. Debes reiniciar.</p>
            </div>
          </div>
        </div>
      )}

      {/* === PK MILESTONE ALERT === */}
      {pendingPk !== null && (
        <div className="mx-2 mt-2 pointer-events-auto">
          <div className="bg-card border-2 border-accent rounded-xl shadow-2xl p-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0 animate-pulse">
                <CircleDot className="w-5 h-5 text-accent" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">PK {pendingPk} m alcanzado</p>
                <p className="text-[10px] text-muted-foreground">
                  Realiza F5 en el sistema del equipo y confirma en la app.
                </p>
              </div>
            </div>
            <Button
              onClick={handleConfirmPk}
              className="w-full h-12 text-sm font-bold bg-accent text-accent-foreground"
            >
              <CheckCircle2 className="w-5 h-5 mr-1.5" />
              Confirmar F5 realizado
            </Button>
          </div>
        </div>
      )}

      {/* === F5 START CONFIRMATION PROMPT === */}
      {showApproachPrompt && (
        <div className="mx-2 mt-2 pointer-events-auto">
          <div className="bg-card border-2 border-primary rounded-xl shadow-2xl p-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 animate-pulse">
                <Zap className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">Zona de inicio alcanzada</p>
                <p className="text-[10px] text-muted-foreground">
                  Realiza F5 en el sistema del equipo y confirma en la app.
                </p>
                {!approachSequenceValid && (
                  <p className="text-[10px] text-destructive font-bold mt-0.5">
                    ⚠ Secuencia 300→150→30 incompleta — El tramo puede requerir revisión
                  </p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button
                disabled={isBlocked}
                onClick={() => { onConfirmF5('inicio'); onStartSegment(); }}
                className="h-14 text-sm font-bold bg-primary text-primary-foreground"
              >
                <CheckCircle2 className="w-5 h-5 mr-1" />
                Confirmar F5
              </Button>
              <Button
                variant="outline"
                onClick={onPostpone}
                className="h-14 text-sm border-border"
              >
                <SkipForward className="w-4 h-4 mr-1" />
                Posponer
              </Button>
              <IncidentDialog onSubmit={(cat, impact, note, nonRec) => onAddIncident(cat, impact, note, nonRec)}>
                <Button
                  variant="outline"
                  className="h-14 text-sm border-destructive/40 text-destructive"
                >
                  <AlertTriangle className="w-4 h-4 mr-1" />
                  Incidencia
                </Button>
              </IncidentDialog>
            </div>
          </div>
        </div>
      )}

      {/* === F5 END / COMPLETION PROMPT === */}
      {operationalState === 'ready_f5_end' && (
        <div className="mx-2 mt-2 pointer-events-auto">
          <div className="bg-card border-2 border-primary rounded-xl shadow-2xl p-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 animate-pulse">
                <Flag className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">Fin de tramo alcanzado</p>
                <p className="text-[10px] text-muted-foreground">
                  Realiza F5 fin de tramo en el sistema del equipo y confirma.
                </p>
                {hasPendingF5 && (
                  <p className="text-[10px] text-amber-400 font-bold mt-0.5">
                    ⚠ F5 intermedio pendiente de confirmar en este tramo
                  </p>
                )}
                {contiguousInfo.isContiguous && (
                  <p className="text-[10px] text-accent font-bold mt-0.5">
                    ⚡ Transición directa → {contiguousInfo.nextSegmentName}
                  </p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={() => { onConfirmF5('fin'); onCompleteSegment(); }}
                className="h-14 text-sm font-bold bg-primary text-primary-foreground"
              >
                <CheckCircle2 className="w-5 h-5 mr-1" />
                {contiguousInfo.isContiguous ? 'Confirmar F5 Fin/Inicio' : 'Confirmar F5 Cierre'}
              </Button>
              <IncidentDialog onSubmit={(cat, impact, note, nonRec) => onAddIncident(cat, impact, note, nonRec)}>
                <Button
                  variant="outline"
                  className="h-14 text-sm border-destructive/40 text-destructive"
                >
                  <AlertTriangle className="w-4 h-4 mr-1" />
                  Incidencia
                </Button>
              </IncidentDialog>
            </div>
            {contiguousInfo.isContiguous && (
              <div className="bg-accent/10 border border-accent/30 rounded-lg p-2 flex items-center gap-2">
                <ChevronRight className="w-4 h-4 text-accent flex-shrink-0" />
                <div>
                  <p className="text-[10px] font-bold text-accent">Tramo contiguo detectado</p>
                  <p className="text-[9px] text-muted-foreground">
                    F5 cerrará este tramo e iniciará «{contiguousInfo.nextSegmentName}» ({Math.round(contiguousInfo.distanceBetween)}m)
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* === F7 — END ACQUISITION PROMPT === */}
      {showF7Prompt && (
        <div className="mx-2 mt-2 pointer-events-auto">
          <div className="bg-card border-2 border-amber-500 rounded-xl shadow-2xl p-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0 animate-pulse">
                <Flag className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">Fin de adquisición</p>
                <p className="text-[10px] text-muted-foreground">
                  Siguiente tramo a {distanceToNextSegment ? formatDistance(distanceToNextSegment) : '> 1500 m'}.
                  Realiza F7 en el sistema del equipo y confirma.
                </p>
              </div>
            </div>
            <Button
              onClick={() => onConfirmF5('f7_fin_adquisicion')}
              className="w-full h-12 text-sm font-bold bg-amber-500 text-amber-950"
            >
              <CheckCircle2 className="w-5 h-5 mr-1.5" />
              Confirmar F7 — Fin adquisición
            </Button>
          </div>
        </div>
      )}

      {/* === F9 — TRANSPORT MODE PROMPT === */}
      {showF9PostPrompt && (
        <div className="mx-2 mt-2 pointer-events-auto">
          <div className="bg-card border-2 border-amber-500 rounded-xl shadow-2xl p-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0 animate-pulse">
                <Navigation className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">Activar modo transporte</p>
                <p className="text-[10px] text-muted-foreground">
                  {distanceToNextSegment
                    ? `Siguiente tramo a ${formatDistance(distanceToNextSegment)}. `
                    : 'No hay más tramos. '}
                  Realiza F9 en el sistema del equipo y confirma.
                </p>
              </div>
            </div>
            <Button
              onClick={() => onConfirmF5('f9_modo_transporte')}
              className="w-full h-12 text-sm font-bold bg-amber-500 text-amber-950"
            >
              <CheckCircle2 className="w-5 h-5 mr-1.5" />
              Confirmar F9 — Modo transporte
            </Button>
          </div>
        </div>
      )}

      {/* === INVALIDATION PANEL === */}
      {isInvalid && (
        <div className="mx-2 mt-2 pointer-events-auto">
          <div className="bg-destructive/10 border-2 border-destructive/60 rounded-xl p-3 space-y-2">
            <div className="flex items-center gap-3">
              <Ban className="w-7 h-7 text-destructive flex-shrink-0 animate-pulse" />
              <div className="flex-1">
                <p className="text-sm font-bold text-destructive">Tramo invalidado</p>
                <p className="text-[10px] text-destructive/80">
                  {operationalState === 'wrong_direction'
                    ? 'Circulación en sentido contrario al planificado.'
                    : operationalState === 'deviated'
                      ? `Desvío confirmado a ${Math.round(deviationMeters)}m del eje. No se permite reincorporación.`
                      : 'El tramo ha perdido validez operativa. Debe reiniciarse desde posición de aproximación.'}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button
                onClick={onRestartSegment}
                className="h-12 text-xs font-bold bg-primary text-primary-foreground"
              >
                <RotateCcw className="w-4 h-4 mr-1" />
                Reiniciar
              </Button>
              <IncidentDialog onSubmit={(cat, impact, note, nonRec) => onAddIncident(cat, impact, note, nonRec)}>
                <Button
                  variant="outline"
                  className="h-12 text-xs border-destructive/40 text-destructive"
                >
                  <AlertTriangle className="w-4 h-4 mr-1" />
                  Incidencia
                </Button>
              </IncidentDialog>
              <Button
                variant="outline"
                onClick={onSkipSegment}
                className="h-12 text-xs border-border"
              >
                <SkipForward className="w-4 h-4 mr-1" />
                Repetir después
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* === PRE-ALERT WARNING === */}
      {operationalState === 'pre_alert' && (
        <div className="mx-2 mt-2 pointer-events-auto">
          <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-2 flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-400 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-[10px] font-bold text-amber-400">Prealerta — {Math.round(deviationMeters)}m del eje</p>
              <p className="text-[9px] text-amber-400/70">Corrige trayectoria o el tramo será invalidado.</p>
            </div>
          </div>
        </div>
      )}

      {/* === RECORDING ACTION BAR === */}
      {isRecording && operationalState !== 'ready_f5_end' && !showF7Prompt && !showF9PostPrompt && (
        <div className="mx-2 mt-2 pointer-events-auto">
          <div className="flex gap-2">
            <Button
              onClick={() => { onConfirmF5('fin'); onCompleteSegment(); }}
              size="sm"
              className="flex-1 h-10 text-xs bg-primary/80 text-primary-foreground"
            >
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
              Confirmar F5 Cierre
            </Button>
            <IncidentDialog onSubmit={(cat, impact, note, nonRec) => onAddIncident(cat, impact, note, nonRec)}>
              <Button
                size="sm"
                variant="outline"
                className="h-10 text-xs border-destructive/40 text-destructive"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
              </Button>
            </IncidentDialog>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── F5 Summary Sub-component ─────────────────────────────────────────

function F5SummaryStrip({
  f5StartConfirmed,
  f5EndConfirmed,
  requiredPkMarkers,
  confirmedPks,
}: {
  f5StartConfirmed: boolean;
  f5EndConfirmed: boolean;
  requiredPkMarkers: number[];
  confirmedPks: Set<number | null>;
}) {
  if (requiredPkMarkers.length === 0 && !f5StartConfirmed && !f5EndConfirmed) return null;

  return (
    <div className="flex items-center gap-1 text-[8px] flex-wrap">
      <span className="text-muted-foreground mr-0.5">F5:</span>
      <span className={`px-1 py-0.5 rounded ${f5StartConfirmed ? 'bg-success/20 text-success' : 'bg-muted text-muted-foreground'}`}>
        Inicio {f5StartConfirmed ? '✓' : '…'}
      </span>
      {requiredPkMarkers.map((pk) => (
        <span
          key={pk}
          className={`px-1 py-0.5 rounded ${confirmedPks.has(pk) ? 'bg-success/20 text-success' : 'bg-muted text-muted-foreground'}`}
        >
          PK{pk / 1000}k {confirmedPks.has(pk) ? '✓' : '…'}
        </span>
      ))}
      <span className={`px-1 py-0.5 rounded ${f5EndConfirmed ? 'bg-success/20 text-success' : 'bg-muted text-muted-foreground'}`}>
        Fin {f5EndConfirmed ? '✓' : '…'}
      </span>
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
        { key: 'end_ref_30m', label: '+30m', dist: 30 },
        { key: 'end_ref_150m', label: '+150m', dist: 150 },
        { key: 'end_ref_300m', label: '+300m', dist: 300 },
      ];

  const d = distanceToStart ?? (type === 'start' ? Infinity : 0);

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[8px] text-muted-foreground uppercase tracking-wider">
        {type === 'start' ? 'Refs. inicio' : 'Refs. cierre (post-fin)'}
      </span>
      <div className="flex gap-1 flex-1">
        {refs.map((ref) => {
          const isPassed = type === 'start' ? d <= ref.dist : d >= ref.dist;
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
