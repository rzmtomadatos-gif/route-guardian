import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Upload, Plus, Square, Pentagon, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GoogleMapDisplay, type AreaSelectionMode } from '@/components/GoogleMapDisplay';
import { MapControlPanel } from '@/components/MapControlPanel';
import { SegmentCreatorPanel } from '@/components/SegmentCreatorPanel';
import { AreaSelectionDialog } from '@/components/AreaSelectionDialog';
import { AreaResultsDialog } from '@/components/AreaResultsDialog';
import { useGeolocation } from '@/hooks/useGeolocation';
import { distanceToSegment } from '@/utils/route-optimizer';
import { playDeviationSound } from '@/utils/sounds';
import { computeDirectionsRoute, getGoogleMapsApiKey } from '@/utils/google-directions';
import { fetchRoadsInArea, fetchRoadsInCircle, fetchCompleteRoads, mergeWaysByName, fetchNearestRoad, type RoadCategory, type OverpassWay } from '@/utils/overpass-api';
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
  onMergeSegments: (ids: string[]) => void;
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
  onMergeSegments,
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
  const [fetchedWays, setFetchedWays] = useState<OverpassWay[]>([]);
  const [showResultsDialog, setShowResultsDialog] = useState(false);
  const [pendingLayerName, setPendingLayerName] = useState('');
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
  const [creationRoadInfo, setCreationRoadInfo] = useState<{ name: string; highway: string; oneway: boolean } | null>(null);
  const [isLoadingRoadInfo, setIsLoadingRoadInfo] = useState(false);

  useEffect(() => {
    if (!creationStart || !creationEnd) return;
    const apiKey = getGoogleMapsApiKey();
    if (!apiKey) {
      setCreationRoute([creationStart, creationEnd]);
      return;
    }

    setIsLoadingRoute(true);
    computeDirectionsRoute([creationStart, creationEnd], apiKey)
      .then((result) => {
        if (result) {
          fetchDirectionsRoute(creationStart, creationEnd, apiKey);
        } else {
          setCreationRoute([creationStart, creationEnd]);
          setIsLoadingRoute(false);
        }
      })
      .catch(() => {
        setCreationRoute([creationStart, creationEnd]);
        setIsLoadingRoute(false);
      });

    // Query Overpass for road info at midpoint
    setIsLoadingRoadInfo(true);
    setCreationRoadInfo(null);
    const mid: LatLng = {
      lat: (creationStart.lat + creationEnd.lat) / 2,
      lng: (creationStart.lng + creationEnd.lng) / 2,
    };
    fetchNearestRoad(mid)
      .then((info) => {
        if (info) setCreationRoadInfo(info);
      })
      .catch(() => {})
      .finally(() => setIsLoadingRoadInfo(false));
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
    setCreationMode(false);
    setCreationStart(null);
    setCreationEnd(null);
    setCreationRoute(null);
    setCreationRoadInfo(null);
  }, [onAddSegment]);

  const handleCancelCreation = useCallback(() => {
    setCreationMode(false);
    setCreationStart(null);
    setCreationEnd(null);
    setCreationRoute(null);
    setCreationRoadInfo(null);
  }, []);

  // Area selection handlers
  const handleAreaClick = useCallback((latlng: LatLng) => {
    if (areaMode === 'rectangle') {
      setAreaPoints((prev) => {
        if (prev.length >= 2) return prev;
        const next = [...prev, latlng];
        if (next.length === 2) {
          setTimeout(() => setShowAreaDialog(true), 100);
        }
        return next;
      });
    } else if (areaMode === 'polygon') {
      setAreaPoints((prev) => [...prev, latlng]);
    } else if (areaMode === 'circle') {
      setAreaPoints((prev) => {
        if (prev.length >= 2) return prev;
        const next = [...prev, latlng];
        if (next.length === 2) {
          setTimeout(() => setShowAreaDialog(true), 100);
        }
        return next;
      });
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

  const getCircleParams = useCallback((): { center: LatLng; radiusMeters: number } | null => {
    if (areaMode !== 'circle' || areaPoints.length < 2) return null;
    const center = areaPoints[0];
    const edge = areaPoints[1];
    const R = 6371000;
    const dLat = (edge.lat - center.lat) * Math.PI / 180;
    const dLng = (edge.lng - center.lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(center.lat * Math.PI / 180) * Math.cos(edge.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    const radiusMeters = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return { center, radiusMeters };
  }, [areaMode, areaPoints]);

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
    if (areaMode === 'circle' && areaPoints.length >= 2) {
      // Approximate circle as polygon for fallback
      const params = getCircleParams();
      if (!params) return areaPoints;
      const { center, radiusMeters } = params;
      const points: LatLng[] = [];
      const n = 32;
      for (let i = 0; i < n; i++) {
        const angle = (2 * Math.PI * i) / n;
        const dLat = (radiusMeters / 6371000) * (180 / Math.PI);
        const dLng = dLat / Math.cos(center.lat * Math.PI / 180);
        points.push({
          lat: center.lat + dLat * Math.cos(angle),
          lng: center.lng + dLng * Math.sin(angle),
        });
      }
      return points;
    }
    return areaPoints;
  }, [areaMode, areaPoints, getCircleParams]);

  const handleFetchRoads = useCallback(async (categories: RoadCategory[], layerName: string) => {
    setIsLoadingArea(true);
    setPendingLayerName(layerName);
    try {
      let ways: OverpassWay[];
      const circleParams = getCircleParams();

      if (areaMode === 'circle' && circleParams) {
        const initialWays = await fetchRoadsInCircle(circleParams.center, circleParams.radiusMeters, categories);
        
        if (initialWays.length === 0) {
          toast.warning('No se encontraron vías en la zona seleccionada');
          setIsLoadingArea(false);
          return;
        }

        const realNames = [...new Set(initialWays.filter((w) => w.name && !w.name.startsWith('Vía ')).map((w) => w.name))];
        
        if (realNames.length > 0) {
          toast.info(`Completando ${realNames.length} vías...`);
          const completeWays = await fetchCompleteRoads(circleParams.center, circleParams.radiusMeters, realNames, categories);
          const unnamedWays = initialWays.filter((w) => w.name.startsWith('Vía '));
          ways = [...mergeWaysByName(completeWays), ...unnamedWays];
        } else {
          ways = initialWays;
        }
      } else {
        const polygon = getAreaPolygon();
        ways = await fetchRoadsInArea(polygon, categories);
      }

      if (!ways || ways.length === 0) {
        toast.warning('No se encontraron vías en la zona seleccionada');
        setIsLoadingArea(false);
        return;
      }

      setFetchedWays(ways);
      setShowAreaDialog(false);
      setShowResultsDialog(true);
    } catch (err) {
      console.error('Overpass error:', err);
      toast.error('Error al consultar las vías. Intenta con una zona más pequeña.');
    } finally {
      setIsLoadingArea(false);
    }
  }, [getAreaPolygon, getCircleParams, areaMode]);

  const handleConfirmGeneration = useCallback((generateReverse: boolean) => {
    const ways = fetchedWays;
    const layerName = pendingLayerName;

    for (const way of ways) {
      const isReversed = way.onewayReverse;
      const coords = isReversed ? [...way.coordinates].reverse() : way.coordinates;

      const segment: Segment = {
        id: Math.random().toString(36).substring(2, 10),
        routeId: state.route?.id || 'area',
        trackNumber: null,
        trackHistory: [],
        kmlId: `osm-${way.id}`,
        name: way.name,
        notes: `Tipo: ${way.highway}${way.oneway ? ' | Sentido único' : ''}`,
        coordinates: coords,
        direction: 'creciente',
        type: 'tramo',
        status: 'pendiente',
        kmlMeta: { carretera: way.name, tipo: way.highway, sentido: way.oneway ? 'único' : undefined },
        layer: layerName || undefined,
      };
      onAddSegment(segment);
    }

    if (generateReverse) {
      const reverseLayerName = layerName ? `${layerName} (decreciente)` : 'Decreciente';
      const reversibleWays = ways.filter((w) => !w.oneway);
      for (const way of reversibleWays) {
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
      const skipped = ways.length - reversibleWays.length;
      const skippedMsg = skipped > 0 ? ` (${skipped} vías de sentido único excluidas)` : '';
      toast.success(`Se generaron ${ways.length} tramos (+ ${reversibleWays.length} en sentido inverso)${skippedMsg}`);
    } else {
      toast.success(`Se generaron ${ways.length} tramos en sentido creciente`);
    }

    setShowResultsDialog(false);
    setFetchedWays([]);
    handleCancelArea();
  }, [fetchedWays, pendingLayerName, state.route?.id, onAddSegment, handleCancelArea]);

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
          fitToActiveSegment={state.navigationActive && !!state.activeSegmentId}
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
          roadInfo={creationRoadInfo}
          isLoadingRoadInfo={isLoadingRoadInfo}
        />
      )}

      {/* Area selection panel */}
      {areaMode !== 'none' && !showAreaDialog && (
        <div className="absolute top-3 left-3 right-3 z-30 bg-card/95 backdrop-blur-sm border border-border rounded-xl shadow-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              {areaMode === 'rectangle' ? <Square className="w-4 h-4 text-primary" /> : areaMode === 'circle' ? <Circle className="w-4 h-4 text-primary" /> : <Pentagon className="w-4 h-4 text-primary" />}
              {areaMode === 'rectangle' ? 'Selección rectangular' : areaMode === 'circle' ? 'Selección circular' : 'Selección por polígono'}
            </h3>
            <button onClick={handleCancelArea} className="text-xs text-muted-foreground hover:text-foreground">
              Cancelar
            </button>
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            {areaMode === 'rectangle'
              ? `Haz click en 2 esquinas opuestas del rectángulo. (${areaPoints.length}/2)`
              : areaMode === 'circle'
                ? `Haz click en el centro y luego en el borde del círculo. (${areaPoints.length}/2)`
                : `Haz click para definir los vértices del polígono. (${areaPoints.length} puntos)`}
          </p>
          {areaMode === 'circle' && areaPoints.length >= 2 && (
            <p className="text-[10px] text-accent mb-2">
              ⓘ Las vías se completarán de inicio a fin, incluso si se extienden fuera del círculo.
            </p>
          )}
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
        onConfirm={handleFetchRoads}
        pointCount={areaPoints.length}
        isLoading={isLoadingArea}
        layers={layers}
      />

      {/* Area results dialog */}
      <AreaResultsDialog
        open={showResultsDialog}
        onClose={() => { setShowResultsDialog(false); setFetchedWays([]); handleCancelArea(); }}
        onConfirm={handleConfirmGeneration}
        ways={fetchedWays}
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
          <button
            onClick={() => setAreaMode('circle')}
            className="w-10 h-10 rounded-full bg-accent text-accent-foreground shadow-lg flex items-center justify-center hover:bg-accent/90 transition-colors"
            title="Selección circular (vías completas)"
          >
            <Circle className="w-4 h-4" />
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
          onMergeSegments={onMergeSegments}
        />
      )}
    </div>
  );
}
