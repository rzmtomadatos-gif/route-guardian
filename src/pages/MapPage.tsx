import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Upload, Plus, Square, Pentagon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GoogleMapDisplay, type AreaSelectionMode } from '@/components/GoogleMapDisplay';
import { MapControlPanel } from '@/components/MapControlPanel';
import { SegmentCreatorPanel } from '@/components/SegmentCreatorPanel';
import { AreaSelectionDialog } from '@/components/AreaSelectionDialog';
import { useGeolocation } from '@/hooks/useGeolocation';
import { distanceToSegment } from '@/utils/route-optimizer';
import { playDeviationSound } from '@/utils/sounds';
import { computeDirectionsRoute, getGoogleMapsApiKey } from '@/utils/google-directions';
import { fetchRoadsInArea, type RoadCategory } from '@/utils/overpass-api';
import { toast } from 'sonner';
import type { AppState, IncidentCategory, LatLng, BaseLocation, Segment } from '@/types/route';

const DEVIATION_THRESHOLD = 100;

interface Props {
  state: AppState;
  onStartNavigation: () => void;
  onStopNavigation: () => void;
  onConfirmStart: (segmentId: string) => void;
  onComplete: (segmentId: string) => void;
  onResetSegment: (segmentId: string) => void;
  onAddIncident: (segmentId: string, category: IncidentCategory, note?: string, location?: LatLng) => void;
  onReoptimize: (pos?: LatLng | null) => void;
  onSetActiveSegment: (segmentId: string) => void;
  onSetBase: (base: BaseLocation) => void;
  onAddSegment: (segment: Segment) => void;
}

export default function MapPage({
  state,
  onStartNavigation,
  onStopNavigation,
  onConfirmStart,
  onComplete,
  onResetSegment,
  onAddIncident,
  onReoptimize,
  onSetActiveSegment,
  onSetBase,
  onAddSegment,
}: Props) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [basePosition, setBasePosition] = useState<LatLng | null>(null);
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<Set<string>>(() => {
    const param = searchParams.get('selected');
    if (param) return new Set(param.split(',').filter(Boolean));
    return new Set();
  });

  // Creation mode state
  const [creationMode, setCreationMode] = useState(false);
  const [creationStart, setCreationStart] = useState<LatLng | null>(null);
  const [creationEnd, setCreationEnd] = useState<LatLng | null>(null);
  const [creationRoute, setCreationRoute] = useState<LatLng[] | null>(null);
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);

  // Area selection state
  const [areaMode, setAreaMode] = useState<AreaSelectionMode>('none');
  const [areaPoints, setAreaPoints] = useState<LatLng[]>([]);
  const [showAreaDialog, setShowAreaDialog] = useState(false);
  const [isLoadingArea, setIsLoadingArea] = useState(false);

  const geo = useGeolocation(gpsEnabled);
  const lastDeviationRef = useRef(0);

  // Save first GPS position as base
  useEffect(() => {
    if (geo.position && !basePosition) {
      setBasePosition(geo.position);
    }
  }, [geo.position, basePosition]);

  // Deviation detection during active recording
  const activeSegment = state.route?.segments.find((s) => s.id === state.activeSegmentId);
  useEffect(() => {
    if (!geo.position || !activeSegment || activeSegment.status !== 'en_progreso') return;
    const dist = distanceToSegment(geo.position, activeSegment);
    if (dist > DEVIATION_THRESHOLD && Date.now() - lastDeviationRef.current > 10000) {
      playDeviationSound();
      lastDeviationRef.current = Date.now();
    }
  }, [geo.position, activeSegment]);

  // Auto-calculate route when both points are set
  useEffect(() => {
    if (!creationStart || !creationEnd) return;
    const apiKey = getGoogleMapsApiKey();
    if (!apiKey) {
      // Fallback: straight line
      setCreationRoute([creationStart, creationEnd]);
      return;
    }

    setIsLoadingRoute(true);
    computeDirectionsRoute([creationStart, creationEnd], apiKey)
      .then((result) => {
        if (result) {
          // We need to decode the route from the Directions response
          // computeDirectionsRoute doesn't return the path, so we use a direct approach
          fetchDirectionsRoute(creationStart, creationEnd, apiKey);
        } else {
          // Fallback to straight line
          setCreationRoute([creationStart, creationEnd]);
          setIsLoadingRoute(false);
        }
      })
      .catch(() => {
        setCreationRoute([creationStart, creationEnd]);
        setIsLoadingRoute(false);
      });
  }, [creationStart, creationEnd]);

  const fetchDirectionsRoute = useCallback(async (start: LatLng, end: LatLng, apiKey: string) => {
    try {
      // Use Google Maps DirectionsService to get the actual route path
      const gmaps = (window as any).google?.maps;
      if (!gmaps) {
        setCreationRoute([start, end]);
        setIsLoadingRoute(false);
        return;
      }

      const directionsService = new gmaps.DirectionsService();
      directionsService.route(
        {
          origin: new gmaps.LatLng(start.lat, start.lng),
          destination: new gmaps.LatLng(end.lat, end.lng),
          travelMode: gmaps.TravelMode.DRIVING,
        },
        (result: any, status: string) => {
          if (status === 'OK' && result?.routes?.[0]) {
            const path = result.routes[0].overview_path;
            const coords: LatLng[] = path.map((p: any) => ({
              lat: p.lat(),
              lng: p.lng(),
            }));
            setCreationRoute(coords);
          } else {
            setCreationRoute([start, end]);
          }
          setIsLoadingRoute(false);
        }
      );
    } catch {
      setCreationRoute([start, end]);
      setIsLoadingRoute(false);
    }
  }, []);

  const handleMapClick = useCallback((latlng: LatLng) => {
    if (!creationMode) return;
    if (!creationStart) {
      setCreationStart(latlng);
    } else if (!creationEnd) {
      setCreationEnd(latlng);
    }
    // If both are set, ignore further clicks until reset
  }, [creationMode, creationStart, creationEnd]);

  const handleCreateSegment = useCallback((segment: Segment) => {
    onAddSegment(segment);
    // Reset creation state
    setCreationMode(false);
    setCreationStart(null);
    setCreationEnd(null);
    setCreationRoute(null);
  }, [onAddSegment]);

  const handleCancelCreation = useCallback(() => {
    setCreationMode(false);
    setCreationStart(null);
    setCreationEnd(null);
    setCreationRoute(null);
  }, []);

  // Area selection handlers
  const handleAreaClick = useCallback((latlng: LatLng) => {
    if (areaMode === 'rectangle') {
      setAreaPoints((prev) => {
        if (prev.length >= 2) return prev;
        const next = [...prev, latlng];
        if (next.length === 2) {
          // Auto-show dialog when rectangle is complete
          setTimeout(() => setShowAreaDialog(true), 100);
        }
        return next;
      });
    } else if (areaMode === 'polygon') {
      setAreaPoints((prev) => [...prev, latlng]);
    }
  }, [areaMode]);

  const handleFinishPolygon = useCallback(() => {
    if (areaPoints.length >= 3) {
      setShowAreaDialog(true);
    }
  }, [areaPoints]);

  const handleCancelArea = useCallback(() => {
    setAreaMode('none');
    setAreaPoints([]);
    setShowAreaDialog(false);
  }, []);

  const getAreaPolygon = useCallback((): LatLng[] => {
    if (areaMode === 'rectangle' && areaPoints.length >= 2) {
      const [a, b] = areaPoints;
      return [
        { lat: Math.min(a.lat, b.lat), lng: Math.min(a.lng, b.lng) },
        { lat: Math.min(a.lat, b.lat), lng: Math.max(a.lng, b.lng) },
        { lat: Math.max(a.lat, b.lat), lng: Math.max(a.lng, b.lng) },
        { lat: Math.max(a.lat, b.lat), lng: Math.min(a.lng, b.lng) },
      ];
    }
    return areaPoints;
  }, [areaMode, areaPoints]);

  const handleGenerateSegments = useCallback(async (categories: RoadCategory[], layerName: string, generateReverse: boolean) => {
    setIsLoadingArea(true);
    try {
      const polygon = getAreaPolygon();
      const ways = await fetchRoadsInArea(polygon, categories);

      if (ways.length === 0) {
        toast.warning('No se encontraron vías en la zona seleccionada');
        setIsLoadingArea(false);
        return;
      }

      // Generate "creciente" segments
      for (const way of ways) {
        const segment: Segment = {
          id: Math.random().toString(36).substring(2, 10),
          routeId: state.route?.id || 'area',
          trackNumber: null,
          trackHistory: [],
          kmlId: `osm-${way.id}`,
          name: way.name,
          notes: `Tipo: ${way.highway}`,
          coordinates: way.coordinates,
          direction: 'creciente',
          type: 'tramo',
          status: 'pendiente',
          kmlMeta: { carretera: way.name, tipo: way.highway },
          layer: layerName || undefined,
        };
        onAddSegment(segment);
      }

      // Generate reverse ("decreciente") segments in a separate layer
      if (generateReverse) {
        const reverseLayerName = layerName ? `${layerName} (decreciente)` : 'Decreciente';
        for (const way of ways) {
          const segment: Segment = {
            id: Math.random().toString(36).substring(2, 10),
            routeId: state.route?.id || 'area',
            trackNumber: null,
            trackHistory: [],
            kmlId: `osm-${way.id}-rev`,
            name: `${way.name} (dec.)`,
            notes: `Tipo: ${way.highway} | Sentido decreciente`,
            coordinates: [...way.coordinates].reverse(),
            direction: 'creciente',
            type: 'tramo',
            status: 'pendiente',
            kmlMeta: { carretera: way.name, tipo: way.highway, sentido: 'decreciente' },
            layer: reverseLayerName,
          };
          onAddSegment(segment);
        }
        toast.success(`Se generaron ${ways.length} tramos (+ ${ways.length} en sentido inverso)`);
      } else {
        toast.success(`Se generaron ${ways.length} tramos en sentido creciente`);
      }

      handleCancelArea();
    } catch (err) {
      console.error('Overpass error:', err);
      toast.error('Error al consultar las vías. Intenta con una zona más pequeña.');
    } finally {
      setIsLoadingArea(false);
    }
  }, [getAreaPolygon, state.route?.id, onAddSegment, handleCancelArea]);

  const handleReoptimize = useCallback(() => {
    if (!gpsEnabled) setGpsEnabled(true);
    onReoptimize(geo.position);
  }, [gpsEnabled, geo.position, onReoptimize]);

  const handleStartNavigation = useCallback(() => {
    if (!gpsEnabled) setGpsEnabled(true);
    onStartNavigation();
  }, [gpsEnabled, onStartNavigation]);

  const handleExportToGoogleMaps = useCallback(() => {
    if (!state.route) return;
    const route = state.route;
    const itinerary = route.optimizedOrder
      .filter((id) => {
        const seg = route.segments.find((s) => s.id === id);
        return seg?.status === 'pendiente' || seg?.status === 'en_progreso';
      })
      .slice(0, 6);

    if (itinerary.length === 0) return;

    const waypoints: string[] = [];
    for (const id of itinerary) {
      const seg = route.segments.find((s) => s.id === id)!;
      const start = seg.coordinates[0];
      const end = seg.coordinates[seg.coordinates.length - 1];
      waypoints.push(`${start.lat},${start.lng}`);
      waypoints.push(`${end.lat},${end.lng}`);
    }

    const origin = waypoints[0];
    const destination = waypoints[waypoints.length - 1];
    const middle = waypoints.slice(1, -1).join('|');

    let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`;
    if (middle) url += `&waypoints=${middle}`;

    window.open(url, '_blank');
  }, [state.route]);

  const route = state.route;

  // Get unique layers for creation panel
  const layers = useMemo(() => {
    if (!route) return [];
    const set = new Set<string>();
    route.segments.forEach((s) => { if (s.layer) set.add(s.layer); });
    return Array.from(set).sort();
  }, [route]);

  const visibleSegments = useMemo(() => {
    if (!route || selectedSegmentIds.size === 0) return route?.segments ?? [];
    return route.segments.filter((s) => selectedSegmentIds.has(s.id));
  }, [route, selectedSegmentIds]);

  const visibleOrder = useMemo(() => {
    if (!route || selectedSegmentIds.size === 0) return route?.optimizedOrder ?? [];
    return route.optimizedOrder.filter((id) => selectedSegmentIds.has(id));
  }, [route, selectedSegmentIds]);

  if (!route) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6">
        <p className="text-muted-foreground mb-4">No hay ruta cargada</p>
        <Button onClick={() => navigate('/')} className="driving-button bg-primary text-primary-foreground">
          <Upload className="w-5 h-5 mr-2" />
          Cargar archivo
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      <div className="flex-1">
        <GoogleMapDisplay
          segments={visibleSegments}
          activeSegmentId={state.activeSegmentId}
          currentPosition={geo.position}
          optimizedOrder={visibleOrder}
          onSegmentClick={onSetActiveSegment}
          creationMode={creationMode}
          onMapClick={handleMapClick}
          creationStartPoint={creationStart}
          creationEndPoint={creationEnd}
          creationRoutePreview={creationRoute}
          areaSelectionMode={areaMode}
          areaPoints={areaPoints}
          onAreaClick={handleAreaClick}
        />
      </div>

      {/* Creation mode panel */}
      {creationMode && (
        <SegmentCreatorPanel
          layers={layers}
          onCreateSegment={handleCreateSegment}
          onCancel={handleCancelCreation}
          startPoint={creationStart}
          endPoint={creationEnd}
          routePreview={creationRoute}
          isLoadingRoute={isLoadingRoute}
        />
      )}

      {/* Area selection panel */}
      {areaMode !== 'none' && !showAreaDialog && (
        <div className="absolute top-3 left-3 right-3 z-30 bg-card/95 backdrop-blur-sm border border-border rounded-xl shadow-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              {areaMode === 'rectangle' ? <Square className="w-4 h-4 text-primary" /> : <Pentagon className="w-4 h-4 text-primary" />}
              {areaMode === 'rectangle' ? 'Selección rectangular' : 'Selección por polígono'}
            </h3>
            <button onClick={handleCancelArea} className="text-xs text-muted-foreground hover:text-foreground">
              Cancelar
            </button>
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            {areaMode === 'rectangle'
              ? `Haz click en 2 esquinas opuestas del rectángulo. (${areaPoints.length}/2)`
              : `Haz click para definir los vértices del polígono. (${areaPoints.length} puntos)`}
          </p>
          {areaMode === 'polygon' && areaPoints.length >= 3 && (
            <Button size="sm" onClick={handleFinishPolygon} className="w-full h-8 text-xs bg-primary text-primary-foreground">
              Cerrar polígono y generar
            </Button>
          )}
        </div>
      )}

      {/* Area selection dialog */}
      <AreaSelectionDialog
        open={showAreaDialog}
        onClose={handleCancelArea}
        onConfirm={handleGenerateSegments}
        pointCount={areaPoints.length}
        isLoading={isLoadingArea}
        layers={layers}
      />

      {/* FAB buttons */}
      {!creationMode && areaMode === 'none' && (
        <div className="absolute top-3 right-3 z-20 flex flex-col gap-2">
          <button
            onClick={() => setCreationMode(true)}
            className="w-10 h-10 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors"
            title="Crear tramo manual"
          >
            <Plus className="w-5 h-5" />
          </button>
          <button
            onClick={() => setAreaMode('rectangle')}
            className="w-10 h-10 rounded-full bg-accent text-accent-foreground shadow-lg flex items-center justify-center hover:bg-accent/90 transition-colors"
            title="Selección rectangular"
          >
            <Square className="w-4 h-4" />
          </button>
          <button
            onClick={() => setAreaMode('polygon')}
            className="w-10 h-10 rounded-full bg-accent text-accent-foreground shadow-lg flex items-center justify-center hover:bg-accent/90 transition-colors"
            title="Selección por polígono"
          >
            <Pentagon className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Control panel overlay */}
      {!creationMode && areaMode === 'none' && (
        <MapControlPanel
          segments={route.segments}
          optimizedOrder={route.optimizedOrder}
          activeSegmentId={state.activeSegmentId}
          gpsEnabled={gpsEnabled}
          currentPosition={geo.position}
          gpsAccuracy={geo.accuracy}
          gpsSpeed={geo.speed}
          gpsError={geo.error}
          navigationActive={state.navigationActive}
          base={state.base}
          onToggleGps={setGpsEnabled}
          onConfirmStart={onConfirmStart}
          onComplete={onComplete}
          onResetSegment={onResetSegment}
          onAddIncident={onAddIncident}
          onReoptimize={handleReoptimize}
          onStartNavigation={handleStartNavigation}
          onStopNavigation={onStopNavigation}
          onExportToGoogleMaps={handleExportToGoogleMaps}
          onSegmentSelect={onSetActiveSegment}
          onSetBase={onSetBase}
          selectedSegmentIds={selectedSegmentIds}
          onSelectedSegmentsChange={setSelectedSegmentIds}
        />
      )}
    </div>
  );
}
