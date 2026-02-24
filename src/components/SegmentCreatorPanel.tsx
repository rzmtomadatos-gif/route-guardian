import { useState, useCallback, useEffect } from 'react';
import {
  Plus, X, Check, MapPin, Route, Loader2, ChevronDown, Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { computeDirectionsRoute, getGoogleMapsApiKey } from '@/utils/google-directions';
import type { LatLng, Segment } from '@/types/route';

interface Props {
  layers: string[];
  onCreateSegment: (segment: Segment) => void;
  onCancel: () => void;
  startPoint: LatLng | null;
  endPoint: LatLng | null;
  routePreview: LatLng[] | null;
  isLoadingRoute: boolean;
  roadInfo?: { name: string; highway: string; oneway: boolean } | null;
  isLoadingRoadInfo?: boolean;
}

export function SegmentCreatorPanel({
  layers,
  onCreateSegment,
  onCancel,
  startPoint,
  endPoint,
  routePreview,
  isLoadingRoute,
  roadInfo,
  isLoadingRoadInfo,
}: Props) {
  const [name, setName] = useState('');
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
  const [layer, setLayer] = useState<string>('__none__');

  // Auto-fill name from road info
  useEffect(() => {
    if (roadInfo && !nameManuallyEdited) {
      setName(roadInfo.name);
    }
  }, [roadInfo, nameManuallyEdited]);

  const canCreate = startPoint && endPoint && routePreview && routePreview.length >= 2 && !isLoadingRoute;

  const handleCreate = () => {
    if (!canCreate || !routePreview) return;

    const segment: Segment = {
      id: Math.random().toString(36).substring(2, 10),
      routeId: 'manual',
      trackNumber: null,
      trackHistory: [],
      kmlId: '',
      name: name.trim() || roadInfo?.name || `Tramo manual ${Date.now()}`,
      notes: roadInfo ? `Tipo: ${roadInfo.highway}${roadInfo.oneway ? ' | Sentido único' : ''}` : '',
      coordinates: routePreview,
      direction: roadInfo?.oneway ? 'creciente' : 'ambos',
      type: 'tramo',
      status: 'pendiente',
      kmlMeta: roadInfo ? { carretera: roadInfo.name, tipo: roadInfo.highway, sentido: roadInfo.oneway ? 'único' : undefined } : {},
      layer: layer === '__none__' ? undefined : layer,
    };

    onCreateSegment(segment);
  };

  return (
    <div className="absolute top-3 left-3 right-3 z-30 bg-card/95 backdrop-blur-sm border border-border rounded-xl shadow-lg">
      <div className="p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Route className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground">Crear tramo</h3>
          </div>
          <button onClick={onCancel} className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Instructions */}
        <div className="space-y-1.5">
          <div className={`flex items-center gap-2 text-xs ${startPoint ? 'text-success' : 'text-foreground'}`}>
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
              startPoint ? 'bg-success/20 text-success' : 'bg-primary/20 text-primary animate-pulse'
            }`}>
              {startPoint ? <Check className="w-3 h-3" /> : '1'}
            </div>
            <span>{startPoint ? `Inicio: ${startPoint.lat.toFixed(5)}, ${startPoint.lng.toFixed(5)}` : 'Haz click en el mapa para marcar el inicio'}</span>
          </div>
          <div className={`flex items-center gap-2 text-xs ${endPoint ? 'text-success' : startPoint ? 'text-foreground' : 'text-muted-foreground'}`}>
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
              endPoint ? 'bg-success/20 text-success' : startPoint ? 'bg-primary/20 text-primary animate-pulse' : 'bg-muted text-muted-foreground'
            }`}>
              {endPoint ? <Check className="w-3 h-3" /> : '2'}
            </div>
            <span>{endPoint ? `Fin: ${endPoint.lat.toFixed(5)}, ${endPoint.lng.toFixed(5)}` : 'Haz click para marcar el final'}</span>
          </div>

          {isLoadingRoute && (
            <div className="flex items-center gap-2 text-xs text-primary">
              <Loader2 className="w-4 h-4 animate-spin" />
              Calculando ruta por carretera...
            </div>
          )}

          {routePreview && (
            <div className="flex items-center gap-2 text-xs text-success">
              <Route className="w-3.5 h-3.5" />
              Ruta calculada ({routePreview.length} puntos)
            </div>
          )}
          {isLoadingRoadInfo && (
            <div className="flex items-center gap-2 text-xs text-primary">
              <Loader2 className="w-4 h-4 animate-spin" />
              Consultando información de la vía...
            </div>
          )}

          {roadInfo && !isLoadingRoadInfo && (
            <div className="flex items-center gap-2 text-xs text-accent-foreground bg-accent/50 rounded-md px-2 py-1.5">
              <Info className="w-3.5 h-3.5 shrink-0" />
              <span>
                <strong>{roadInfo.name}</strong> · {roadInfo.highway}
                {roadInfo.oneway ? ' · 🔶 Sentido único' : ' · 🟢 Doble sentido'}
              </span>
            </div>
          )}
        </div>

        {/* Form fields (shown after route is calculated) */}
        {routePreview && (
          <div className="space-y-2 pt-1 border-t border-border">
            <Input
              value={name}
              onChange={(e) => { setName(e.target.value); setNameManuallyEdited(true); }}
              placeholder="Nombre del tramo..."
              className="h-8 text-xs"
            />
            <Select value={layer} onValueChange={setLayer}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Asignar a capa..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sin capa</SelectItem>
                {layers.map((l) => (
                  <SelectItem key={l} value={l}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onCancel}
            className="flex-1 h-8 text-xs"
          >
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={!canCreate}
            className="flex-1 h-8 text-xs bg-primary text-primary-foreground"
          >
            <Plus className="w-3 h-3 mr-1" />
            Crear tramo
          </Button>
        </div>
      </div>
    </div>
  );
}
