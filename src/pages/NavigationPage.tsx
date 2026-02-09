import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Square, AlertTriangle, Check, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GoogleMapDisplay } from '@/components/GoogleMapDisplay';
import { StatusBadge } from '@/components/StatusBadge';
import { IncidentDialog } from '@/components/IncidentDialog';
import { useGeolocation } from '@/hooks/useGeolocation';
import { distanceToSegment, formatDistance } from '@/utils/route-optimizer';
import { playStartSound, playEndSound, playDeviationSound } from '@/utils/sounds';
import type { AppState, IncidentCategory, LatLng } from '@/types/route';

interface Props {
  state: AppState;
  onConfirmStart: (segmentId: string) => void;
  onComplete: (segmentId: string) => void;
  onStopNavigation: () => void;
  onAddIncident: (segmentId: string, category: IncidentCategory, note?: string, location?: LatLng) => void;
  onReoptimize: (pos?: LatLng | null) => void;
}

const DEVIATION_THRESHOLD = 100; // meters

export default function NavigationPage({
  state,
  onConfirmStart,
  onComplete,
  onStopNavigation,
  onAddIncident,
  onReoptimize,
}: Props) {
  const navigate = useNavigate();
  const geo = useGeolocation(state.navigationActive);
  const [showConfirmStart, setShowConfirmStart] = useState(false);
  const [showConfirmEnd, setShowConfirmEnd] = useState(false);
  const lastDeviationRef = useRef(0);

  const activeSegment = state.route?.segments.find((s) => s.id === state.activeSegmentId);

  // Deviation detection
  useEffect(() => {
    if (!geo.position || !activeSegment || activeSegment.status !== 'en_progreso') return;

    const dist = distanceToSegment(geo.position, activeSegment);
    if (dist > DEVIATION_THRESHOLD && Date.now() - lastDeviationRef.current > 10000) {
      playDeviationSound();
      lastDeviationRef.current = Date.now();
      onReoptimize(geo.position);
    }
  }, [geo.position, activeSegment, onReoptimize]);

  if (!state.route || !state.navigationActive) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6">
        <p className="text-muted-foreground mb-4">Inicia la navegación desde el mapa</p>
        <Button onClick={() => navigate('/map')} className="driving-button bg-primary text-primary-foreground">
          Ir al mapa
        </Button>
      </div>
    );
  }

  const route = state.route;
  const remaining = route.optimizedOrder.filter((id) => {
    const seg = route.segments.find((s) => s.id === id);
    return seg?.status === 'pendiente' || seg?.status === 'en_progreso';
  });

  const handleConfirmStart = () => {
    if (!activeSegment) return;
    playStartSound();
    onConfirmStart(activeSegment.id);
    setShowConfirmStart(false);
  };

  const handleComplete = () => {
    if (!activeSegment) return;
    playEndSound();
    onComplete(activeSegment.id);
    setShowConfirmEnd(false);
  };

  const distToActive = activeSegment && geo.position
    ? distanceToSegment(geo.position, activeSegment)
    : null;

  return (
    <div className="flex flex-col h-full">
      {/* Map */}
      <div className="flex-1 relative">
        <GoogleMapDisplay
          segments={route.segments}
          activeSegmentId={state.activeSegmentId}
          currentPosition={geo.position}
          optimizedOrder={route.optimizedOrder}
        />

        {/* GPS info overlay */}
        {geo.position && (
          <div className="absolute top-3 left-3 bg-card/90 backdrop-blur-sm border border-border rounded-lg px-3 py-2 text-xs space-y-0.5">
            {geo.speed !== null && <p className="text-foreground">{Math.round(geo.speed * 3.6)} km/h</p>}
            {geo.accuracy !== null && <p className="text-muted-foreground">±{Math.round(geo.accuracy)}m</p>}
          </div>
        )}

        {geo.error && (
          <div className="absolute top-3 right-3 bg-destructive/20 border border-destructive/40 rounded-lg px-3 py-2 text-xs text-destructive max-w-48">
            {geo.error}
          </div>
        )}
      </div>

      {/* Active segment panel */}
      <div className="flex-shrink-0 bg-card border-t border-border animate-slide-up">
        {activeSegment ? (
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">
                  Tramo {remaining.indexOf(activeSegment.id) + 1} de {remaining.length}
                </p>
                <h3 className="text-lg font-bold text-foreground truncate">{activeSegment.name}</h3>
              </div>
              <StatusBadge status={activeSegment.status} />
            </div>

            {distToActive !== null && (
              <p className="text-sm text-muted-foreground">
                Distancia: {formatDistance(distToActive)}
              </p>
            )}

            <div className="flex gap-2">
              {activeSegment.status === 'pendiente' && (
                showConfirmStart ? (
                  <div className="flex gap-2 w-full">
                    <Button onClick={handleConfirmStart} className="flex-1 driving-button bg-primary text-primary-foreground">
                      <Check className="w-5 h-5 mr-2" />
                      Confirmar Inicio
                    </Button>
                    <Button onClick={() => setShowConfirmStart(false)} variant="outline" className="driving-button border-border text-foreground">
                      Cancelar
                    </Button>
                  </div>
                ) : (
                  <Button onClick={() => setShowConfirmStart(true)} className="flex-1 driving-button bg-primary text-primary-foreground">
                    <Play className="w-5 h-5 mr-2" />
                    Iniciar Grabación
                  </Button>
                )
              )}

              {activeSegment.status === 'en_progreso' && (
                showConfirmEnd ? (
                  <div className="flex gap-2 w-full">
                    <Button onClick={handleComplete} className="flex-1 driving-button bg-success text-success-foreground">
                      <Check className="w-5 h-5 mr-2" />
                      Confirmar Fin
                    </Button>
                    <Button onClick={() => setShowConfirmEnd(false)} variant="outline" className="driving-button border-border text-foreground">
                      Cancelar
                    </Button>
                  </div>
                ) : (
                  <>
                    <Button onClick={() => setShowConfirmEnd(true)} className="flex-1 driving-button bg-success text-success-foreground">
                      <Square className="w-5 h-5 mr-2" />
                      Finalizar Tramo
                    </Button>
                    <IncidentDialog
                      onSubmit={(cat, note) => onAddIncident(activeSegment.id, cat, note, geo.position ?? undefined)}
                    >
                      <Button variant="outline" className="driving-button border-destructive/40 text-destructive">
                        <AlertTriangle className="w-5 h-5" />
                      </Button>
                    </IncidentDialog>
                  </>
                )
              )}
            </div>
          </div>
        ) : (
          <div className="p-4 text-center space-y-3">
            <p className="text-success font-semibold">¡Todos los tramos completados!</p>
            <Button
              onClick={() => { onStopNavigation(); navigate('/segments'); }}
              variant="outline"
              className="driving-button border-border text-foreground"
            >
              Ver resumen
            </Button>
          </div>
        )}

        {/* Stop navigation */}
        {activeSegment && (
          <div className="px-4 pb-4">
            <Button
              onClick={onStopNavigation}
              variant="ghost"
              className="w-full text-xs text-muted-foreground hover:text-destructive"
            >
              Detener navegación
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
