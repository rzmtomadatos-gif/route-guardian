import { useState } from 'react';
import {
  Navigation, Play, Clock, AlertTriangle, MapPin,
  ArrowRight, Gauge, SkipForward, Activity,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { IncidentDialog } from '@/components/IncidentDialog';
import type { Segment, LatLng, IncidentCategory, IncidentImpact } from '@/types/route';
import type { NavOperationalState } from '@/hooks/useNavigationTracker';

interface Props {
  segment: Segment;
  operationalState: NavOperationalState;
  distanceToStart: number | null;
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
  currentPosition: LatLng | null;
  isBlocked: boolean;
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
  ready: { label: 'Listo para iniciar', colorClass: 'bg-primary/20 text-primary border border-primary/40 animate-pulse', icon: MapPin },
  recording: { label: 'En grabación', colorClass: 'bg-success/20 text-success border border-success/40', icon: Activity },
  deviated: { label: 'Desviado', colorClass: 'bg-destructive/20 text-destructive border border-destructive/40 animate-pulse', icon: AlertTriangle },
  interrupted: { label: 'Interrumpido', colorClass: 'bg-amber-500/20 text-amber-400 border border-amber-500/40', icon: AlertTriangle },
  completed: { label: 'Completado', colorClass: 'bg-success/20 text-success', icon: Navigation },
};

export function NavigationOverlay({
  segment,
  operationalState,
  distanceToStart,
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
  currentPosition,
  isBlocked,
}: Props) {
  const config = STATE_CONFIG[operationalState];
  const isRecording = operationalState === 'recording' || operationalState === 'deviated';
  const isApproach = operationalState === 'approaching' || operationalState === 'ready';
  const direction = segment.kmlMeta?.sentido || segment.direction || '—';

  // Recording elapsed time
  const [, setTick] = useState(0);
  const startedAt = segment.startedAt ? new Date(segment.startedAt).getTime() : null;

  // Force re-render every second during recording for elapsed time
  if (isRecording && startedAt) {
    setTimeout(() => setTick((t) => t + 1), 1000);
  }
  const elapsed = startedAt ? (Date.now() - startedAt) / 1000 : 0;

  return (
    <div className="absolute top-0 left-0 right-0 z-30 pointer-events-none">
      {/* === TOP HUD BAR === */}
      <div className="mx-2 mt-2 pointer-events-auto">
        <div className="bg-card/95 backdrop-blur-md border border-border rounded-xl shadow-2xl overflow-hidden">
          {/* Status bar */}
          <div className={`px-3 py-1.5 flex items-center gap-2 ${config.colorClass}`}>
            <config.icon className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="text-xs font-bold uppercase tracking-wider">{config.label}</span>
            {operationalState === 'deviated' && (
              <span className="text-[10px] ml-auto font-mono">↕ {Math.round(deviationMeters)}m</span>
            )}
          </div>

          {/* Segment info */}
          <div className="px-3 py-2 space-y-1.5">
            {/* Name + ID */}
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
              <div className="text-right flex-shrink-0">
                <p className="text-[10px] text-muted-foreground">Sentido</p>
                <p className="text-xs font-medium text-foreground">{direction}</p>
              </div>
            </div>

            {/* === APPROACH METRICS === */}
            {isApproach && (
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
            )}

            {/* === RECORDING METRICS === */}
            {isRecording && (
              <>
                {/* Progress */}
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
                    <p className="text-[8px] text-muted-foreground">Total</p>
                    <p className="text-xs font-bold text-foreground">{formatDistance(totalDistance)}</p>
                  </div>
                  <div className="bg-secondary/60 rounded-lg p-1 text-center">
                    <Gauge className="w-3 h-3 mx-auto text-muted-foreground" />
                    <p className="text-xs font-bold text-foreground">{Math.round(speedKmh)}</p>
                  </div>
                  <div className="bg-secondary/60 rounded-lg p-1 text-center">
                    <Clock className="w-3 h-3 mx-auto text-muted-foreground" />
                    <p className="text-xs font-bold text-foreground">{formatDuration(elapsed)}</p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* === APPROACH CONFIRMATION PROMPT === */}
      {showApproachPrompt && (
        <div className="mx-2 mt-2 pointer-events-auto">
          <div className="bg-card border-2 border-primary rounded-xl shadow-2xl p-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                <MapPin className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">Punto de inicio alcanzado</p>
                <p className="text-[10px] text-muted-foreground">Estás a {formatDistance(distanceToStart)} del inicio</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button
                disabled={isBlocked}
                onClick={onStartSegment}
                className="h-14 text-sm font-bold bg-primary text-primary-foreground"
              >
                <Play className="w-5 h-5 mr-1" />
                Iniciar
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

      {/* === DEVIATION WARNING === */}
      {operationalState === 'deviated' && !showApproachPrompt && (
        <div className="mx-2 mt-2 pointer-events-auto">
          <div className="bg-destructive/10 border-2 border-destructive/60 rounded-xl p-2.5 flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-destructive flex-shrink-0 animate-pulse" />
            <div className="flex-1">
              <p className="text-xs font-bold text-destructive">Desvío detectado</p>
              <p className="text-[10px] text-destructive/80">Estás a {Math.round(deviationMeters)}m del eje del tramo. Regresa a la ruta prevista.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
