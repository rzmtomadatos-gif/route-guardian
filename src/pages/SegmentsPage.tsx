import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/StatusBadge';
import { MapPin } from 'lucide-react';
import type { AppState, Incident } from '@/types/route';

interface Props {
  state: AppState;
}

export default function SegmentsPage({ state }: Props) {
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

  const { route, incidents } = state;
  const ordered = route.optimizedOrder
    .map((id) => route.segments.find((s) => s.id === id)!)
    .filter(Boolean);

  const getIncidents = (segId: string): Incident[] =>
    incidents.filter((i) => i.segmentId === segId);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 px-4 py-3 bg-card border-b border-border">
        <h2 className="text-lg font-bold text-foreground">Tramos</h2>
        <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
          <span>{ordered.filter((s) => s.status === 'pendiente').length} pendientes</span>
          <span className="text-primary">{ordered.filter((s) => s.status === 'en_progreso').length} en progreso</span>
          <span className="text-success">{ordered.filter((s) => s.status === 'completado').length} completados</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="divide-y divide-border">
          {ordered.map((seg, idx) => {
            const segIncidents = getIncidents(seg.id);
            return (
              <div key={seg.id} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
                  <span className="text-xs font-bold text-secondary-foreground">{idx + 1}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{seg.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <StatusBadge status={seg.status} />
                    {segIncidents.length > 0 && (
                      <span className="text-[10px] text-destructive">
                        {segIncidents.length} incidencia{segIncidents.length > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>
                <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
