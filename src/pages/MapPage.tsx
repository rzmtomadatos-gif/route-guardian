import { useNavigate } from 'react-router-dom';
import { Navigation, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MapDisplay } from '@/components/MapDisplay';
import { formatDistance, getTotalDistance } from '@/utils/route-optimizer';
import type { AppState } from '@/types/route';

interface Props {
  state: AppState;
  onStartNavigation: () => void;
  onReoptimize: () => void;
}

export default function MapPage({ state, onStartNavigation, onReoptimize }: Props) {
  const navigate = useNavigate();

  if (!state.route) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6">
        <p className="text-muted-foreground mb-4">No hay ruta cargada</p>
        <Button onClick={() => navigate('/')} className="driving-button bg-primary text-primary-foreground">
          Cargar archivo
        </Button>
      </div>
    );
  }

  const { route } = state;
  const pending = route.segments.filter((s) => s.status === 'pendiente').length;
  const completed = route.segments.filter((s) => s.status === 'completado').length;
  const totalDist = getTotalDistance(route.segments, route.optimizedOrder);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 bg-card border-b border-border">
        <h2 className="text-sm font-semibold text-foreground truncate">{route.name}</h2>
        <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
          <span>{route.segments.length} tramos</span>
          <span>{pending} pendientes</span>
          <span className="text-success">{completed} completados</span>
          <span>~{formatDistance(totalDist)}</span>
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        <MapDisplay
          segments={route.segments}
          activeSegmentId={state.activeSegmentId}
          currentPosition={state.currentPosition}
          optimizedOrder={route.optimizedOrder}
        />
      </div>

      {/* Actions */}
      <div className="flex-shrink-0 p-4 bg-card border-t border-border flex gap-3">
        <Button
          variant="outline"
          onClick={onReoptimize}
          className="driving-button border-border text-foreground flex-shrink-0"
        >
          <RotateCcw className="w-4 h-4 mr-2" />
          Reoptimizar
        </Button>
        <Button
          onClick={() => {
            onStartNavigation();
            navigate('/navigate');
          }}
          disabled={pending === 0}
          className="driving-button bg-primary text-primary-foreground hover:bg-primary/90 flex-1"
        >
          <Navigation className="w-4 h-4 mr-2" />
          Iniciar Navegación
        </Button>
      </div>
    </div>
  );
}
