import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Upload, Plus, Square, Pentagon, Circle, MousePointer2, BoxSelect, Crosshair } from 'lucide-react';
import { NavigationOverlay } from '@/components/NavigationOverlay';
import { useNavigationTracker } from '@/hooks/useNavigationTracker';
import { playApproachSound, playDeviationAlertSound, playRecoverySound, playWrongDirectionSound, playPreAlertSound, playRef300Sound, playRef150Sound, playRef30Sound, playF5ReadySound, playInvalidationSound, playContiguousTransitionSound, playGpsUnstableSound, playF7Sound, playF9Sound } from '@/utils/sounds';
import { Button } from '@/components/ui/button';
import { GoogleMapDisplay, type AreaSelectionMode } from '@/components/GoogleMapDisplay';
import { MapControlPanel } from '@/components/MapControlPanel';
import { SegmentCreatorPanel } from '@/components/SegmentCreatorPanel';
import { AreaSelectionDialog } from '@/components/AreaSelectionDialog';
import { AreaResultsDialog } from '@/components/AreaResultsDialog';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useCopilotOperator, type QueueItem } from '@/hooks/useCopilotSession';
import { buildGoogleMapsBatchUrl, segmentsToStops, SEGMENTS_PER_BATCH } from '@/utils/google-maps-batch';
import { CopilotPanel } from '@/components/CopilotPanel';
import { OptimizerDebugPanel } from '@/components/OptimizerDebugPanel';
import { distanceToSegment } from '@/utils/route-optimizer';
import { computeRouteBlock, ROUTE_BLOCK_SIZE } from '@/utils/route-block';
import { MAX_ARROW_SEGMENTS } from '@/utils/segment-arrows';
import { generateDebugInfo, type OptimizerDebugInfo } from '@/utils/optimizer-debug';
import { playDeviationSound } from '@/utils/sounds';
import { primeAudio } from '@/utils/sounds';
import { computeDirectionsRoute, getGoogleMapsApiKey } from '@/utils/google-directions';
import { fetchRoadsInArea, fetchRoadsInCircle, fetchCompleteRoads, mergeWaysByName, fetchNearestRoad, type RoadCategory, type OverpassWay } from '@/utils/overpass-api';
import { SAFE_LAYER_COLORS } from '@/utils/segment-colors';
import { toast } from 'sonner';
import type { AppState, IncidentCategory, IncidentImpact, LatLng, BaseLocation, Segment } from '@/types/route';

const DEVIATION_THRESHOLD = 100;

interface Props {
  state: AppState;
  onStartNavigation: (hiddenLayers?: Set<string>) => void;
  onStopNavigation: () => void;
  onConfirmStart: (segmentId: string, hiddenLayers?: Set<string>) => void;
  onComplete: (segmentId: string, hiddenLayers?: Set<string>) => void;
  onResetSegment: (segmentId: string) => void;
  onAddIncident: (segmentId: string, category: IncidentCategory, impact: IncidentImpact, note?: string, location?: LatLng, currentSegmentNonRecordable?: boolean) => void;
  onRepeatSegment: (segmentId: string) => void;
  onReoptimize: (pos?: LatLng | null, hiddenLayers?: Set<string>) => void;
  onSetActiveSegment: (segmentId: string) => void;
  onSetBase: (base: BaseLocation) => void;
  onAddSegment: (segment: Segment) => void;
  onMergeSegments: (ids: string[]) => void;
  selectedIds: Set<string>;
  onSelectedIdsChange: (ids: Set<string>) => void;
  hiddenLayers: Set<string>;
  onSetRstMode: (enabled: boolean) => void;
  onSetRstGroupSize: (size: number) => void;
  onFinalizeTrack: () => void;
  onSkipSegment: (segmentId: string, hiddenLayers?: Set<string>) => void;
  onCloseBlockEndPrompt: () => void;
  onSetWorkDay: (day: number) => void;
  onReverseSegment: (segmentId: string) => void;
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
  onRepeatSegment,
  selectedIds: selectedSegmentIds,
  onSelectedIdsChange: setSelectedSegmentIds,
  hiddenLayers,
  onSetRstMode,
  onSetRstGroupSize,
  onFinalizeTrack,
  onSkipSegment,
  onCloseBlockEndPrompt,
  onSetWorkDay,
  onReverseSegment,
}: Props) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [basePosition, setBasePosition] = useState<LatLng | null>(null);
  const [mapMode, setMapMode] = useState<'google' | 'leaflet'>('leaflet');
  const [centerActiveRequest, setCenterActiveRequest] = useState(0);
  const [debugMode, setDebugMode] = useState(false);
  const videoEndBlocking = state.blockEndPrompt.isOpen;

  // Detect Google Maps availability and auth failures
  useEffect(() => {
    const key = getGoogleMapsApiKey();
    if (key) {
      setMapMode('google');
    }

    // Listen for Google Maps auth failure
    (window as any).gm_authFailure = () => {
      setMapMode('leaflet');
      toast.error('API key inválida o sin permisos. Cambiando a mapa offline (Leaflet).');
    };

    // Check for error containers periodically
    const checkErrors = setInterval(() => {
      const errContainer = document.querySelector('.gm-err-container');
      if (errContainer) {
        setMapMode('leaflet');
        toast.error('API key inválida o sin permisos. Cambiando a mapa offline (Leaflet).');
        clearInterval(checkErrors);
      }
    }, 3000);

    return () => clearInterval(checkErrors);
  }, []);

  // Sync URL param on mount
  useEffect(() => {
    const param = searchParams.get('selected');
    if (param) {
      const ids = new Set(param.split(',').filter(Boolean));
      if (ids.size > 0) setSelectedSegmentIds(ids);
    }
  }, []);

  // Selection mode state
  const [selectionMode, setSelectionMode] = useState(false);
  const [zoneSelectMode, setZoneSelectMode] = useState<AreaSelectionMode>('none');
  const [zoneSelectPoints, setZoneSelectPoints] = useState<LatLng[]>([]);

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
  const copilot = useCopilotOperator();
  const lastDeviationRef = useRef(0);



  const [activeRouteBlock, setActiveRouteBlock] = useState<string[]>([]);
  const blockVersionRef = useRef(0);

  const recalcBlock = useCallback(() => {
    if (!state.route) { setActiveRouteBlock([]); return; }
    const block = computeRouteBlock(state.route.segments, geo.position, hiddenLayers, ROUTE_BLOCK_SIZE);
    setActiveRouteBlock(block);
    blockVersionRef.current += 1;
  }, [state.route, geo.position, hiddenLayers]);

  // Recalc block when segments/layers change (completion, incident, layer toggle)
  const blockDepsFingerprint = useMemo(() => {
    if (!state.route) return '';
    return state.route.segments
      .filter((s) => s.status === 'pendiente' || (s.status === 'posible_repetir' && s.needsRepeat))
      .filter((s) => !s.nonRecordable && (!s.layer || !hiddenLayers.has(s.layer)))
      .map((s) => s.id)
      .join(',');
  }, [state.route, hiddenLayers]);

  const prevBlockFingerprint = useRef('');
  useEffect(() => {
    if (blockDepsFingerprint !== prevBlockFingerprint.current) {
      prevBlockFingerprint.current = blockDepsFingerprint;
      recalcBlock();
    }
  }, [blockDepsFingerprint, recalcBlock]);

  // === Debug info for optimizer ===
  const optimizerDebugInfo = useMemo<OptimizerDebugInfo | null>(() => {
    if (!debugMode || !state.route) return null;
    return generateDebugInfo(
      state.route.segments,
      activeRouteBlock,
      state.activeSegmentId || null,
      geo.position,
      hiddenLayers,
    );
  }, [debugMode, state.route, activeRouteBlock, state.activeSegmentId, geo.position, hiddenLayers]);


  useEffect(() => {
    if (geo.position && !basePosition) {
      setBasePosition(geo.position);
    }
  }, [geo.position, basePosition]);

  // Deviation detection during active recording
  const activeSegment = state.route?.segments.find((s) => s.id === state.activeSegmentId);
  const isRecording = activeSegment?.status === 'en_progreso';

  // Find next segment in optimized order for contiguous detection — only visible segments
  const nextSegment = useMemo(() => {
    if (!state.route || !state.activeSegmentId) return null;
    // Use activeRouteBlock first, fall back to optimizedOrder
    const order = activeRouteBlock.length > 0 ? activeRouteBlock : state.route.optimizedOrder;
    const idx = order.indexOf(state.activeSegmentId);
    if (idx < 0) {
      // Active segment not in block — find first pending in block
      for (const id of order) {
        const seg = state.route.segments.find((s) => s.id === id);
        if (!seg) continue;
        if (seg.layer && hiddenLayers.has(seg.layer)) continue;
        if (seg.status !== 'pendiente') continue;
        if (seg.nonRecordable) continue;
        if (seg.id === state.activeSegmentId) continue;
        return seg;
      }
      return null;
    }
    // Walk forward in order, skipping hidden layers and non-pending
    for (let i = idx + 1; i < order.length; i++) {
      const seg = state.route.segments.find((s) => s.id === order[i]);
      if (!seg) continue;
      if (seg.layer && hiddenLayers.has(seg.layer)) continue;
      if (seg.status !== 'pendiente') continue;
      if (seg.nonRecordable) continue;
      return seg;
    }
    return null;
  }, [state.route, state.activeSegmentId, hiddenLayers, activeRouteBlock]);

  // Arrow segment IDs — only show arrows on the next N navigation segments
  const arrowSegmentIds = useMemo(() => {
    if (!state.route) return [];
    const order = activeRouteBlock.length > 0 ? activeRouteBlock : state.route.optimizedOrder;
    // Include active segment + next segments up to MAX_ARROW_SEGMENTS
    const ids: string[] = [];
    if (state.activeSegmentId && !order.includes(state.activeSegmentId)) {
      ids.push(state.activeSegmentId);
    }
    for (const id of order) {
      if (ids.length >= MAX_ARROW_SEGMENTS) break;
      if (!ids.includes(id)) ids.push(id);
    }
    return ids;
  }, [state.route, activeRouteBlock, state.activeSegmentId]);

  // Navigation tracker
  const navTracker = useNavigationTracker(
    activeSegment,
    geo.position,
    geo.speed,
    geo.heading,
    geo.accuracy,
    !!isRecording,
    state.navigationActive,
    undefined,
    nextSegment,
  );

  // F5 event log
  const f5EventsRef = useRef<Array<import('@/types/route').F5Event>>([]);
  const handleConfirmF5 = useCallback((eventType: 'inicio' | 'pk' | 'fin' | 'f7_fin_adquisicion' | 'f9_modo_transporte', distanceMarker?: number) => {
    const evt: import('@/types/route').F5Event = {
      segmentId: activeSegment?.id || '',
      companySegmentId: activeSegment?.companySegmentId || '',
      eventType,
      distanceMarker: distanceMarker ?? null,
      confirmedAt: new Date().toISOString(),
      confirmedByUser: true,
      trackNumber: activeSegment?.trackNumber ?? null,
      workDay: state.workDay,
      attemptNumber: activeSegment?.repeatNumber ?? 0,
    };
    f5EventsRef.current = [...f5EventsRef.current, evt];
  }, [activeSegment, state.workDay]);

  // Handle restart after invalidation
  const handleRestartSegment = useCallback(() => {
    if (!activeSegment) return;
    navTracker.resetInvalidation();
    onResetSegment(activeSegment.id);
    toast.info('Tramo reiniciado — vuelve a la posición de aproximación.');
  }, [activeSegment, navTracker, onResetSegment]);

  // Sound effects for RST navigation state changes
  const prevNavState = useRef(navTracker.operationalState);
  useEffect(() => {
    const prev = prevNavState.current;
    const curr = navTracker.operationalState;
    prevNavState.current = curr;
    if (prev === curr) return;

    // Approach reference sounds
    if (curr === 'ref_300m' && prev === 'approaching') playRef300Sound();
    else if (curr === 'ref_150m' && prev === 'ref_300m') playRef150Sound();
    else if (curr === 'ref_30m' && prev === 'ref_150m') playRef30Sound();
    else if (curr === 'ready_f5_start') playF5ReadySound();
    // End reference sounds (now fire AFTER passing end)
    else if (curr === 'end_ref_30m' && (prev === 'past_end' || prev === 'recording')) playRef30Sound();
    else if (curr === 'end_ref_150m') playRef150Sound();
    else if (curr === 'end_ref_300m') playRef300Sound();
    else if (curr === 'ready_f5_end') {
      playF5ReadySound();
      if (navTracker.contiguousInfo.isContiguous) playContiguousTransitionSound();
    }
    // F7/F9 sounds
    else if (curr === 'ready_f7') playF7Sound();
    else if (curr === 'ready_f9_post' || curr === 'ready_f9_pre') playF9Sound();
    // Deviation / invalidation
    else if (curr === 'deviated' || curr === 'invalidated') playInvalidationSound();
    else if (curr === 'wrong_direction') playWrongDirectionSound();
    else if (curr === 'pre_alert') playPreAlertSound();
    else if (curr === 'recording' && prev === 'pre_alert') playRecoverySound();
    else if (curr === 'gps_unstable') playGpsUnstableSound();
  }, [navTracker.operationalState, navTracker.contiguousInfo.isContiguous]);
  
  // Warn and stop navigation if active segment becomes hidden due to layer filter change
  useEffect(() => {
    if (!activeSegment || !state.navigationActive) return;
    if (activeSegment.layer && hiddenLayers.has(activeSegment.layer)) {
      toast.warning('El tramo activo pertenece a una capa oculta. Selecciona una capa visible para continuar.');
      onStopNavigation();
    }
  }, [activeSegment, hiddenLayers, state.navigationActive, onStopNavigation]);

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
  }, [creationMode, creationStart, creationEnd]);

  // Handle segment click: selection mode vs active mode
  const handleSegmentClick = useCallback((segId: string) => {
    if (selectionMode) {
      const next = new Set(selectedSegmentIds);
      if (next.has(segId)) next.delete(segId);
      else next.add(segId);
      setSelectedSegmentIds(next);
    } else {
      onSetActiveSegment(segId);
    }
  }, [selectionMode, selectedSegmentIds, onSetActiveSegment, setSelectedSegmentIds]);

  // Zone selection for selecting existing segments
  const handleZoneSelectClick = useCallback((latlng: LatLng) => {
    if (zoneSelectMode === 'rectangle') {
      setZoneSelectPoints((prev) => {
        if (prev.length >= 2) return prev;
        const next = [...prev, latlng];
        if (next.length === 2) {
          setTimeout(() => selectSegmentsInZone(next), 100);
        }
        return next;
      });
    } else if (zoneSelectMode === 'polygon') {
      setZoneSelectPoints((prev) => [...prev, latlng]);
    } else if (zoneSelectMode === 'circle') {
      setZoneSelectPoints((prev) => {
        if (prev.length >= 2) return prev;
        const next = [...prev, latlng];
        if (next.length === 2) {
          setTimeout(() => selectSegmentsInZone(next), 100);
        }
        return next;
      });
    }
  }, [zoneSelectMode]);

  const finishZonePolygon = useCallback(() => {
    if (zoneSelectPoints.length >= 3) {
      selectSegmentsInZone(zoneSelectPoints);
    }
  }, [zoneSelectPoints]);

  const cancelZoneSelect = useCallback(() => {
    setZoneSelectMode('none');
    setZoneSelectPoints([]);
  }, []);

  const selectSegmentsInZone = useCallback((points: LatLng[]) => {
    const segs = state.route?.segments;
    if (!segs) return;
    const isInZone = (coord: LatLng): boolean => {
      if (zoneSelectMode === 'rectangle' && points.length >= 2) {
        const minLat = Math.min(points[0].lat, points[1].lat);
        const maxLat = Math.max(points[0].lat, points[1].lat);
        const minLng = Math.min(points[0].lng, points[1].lng);
        const maxLng = Math.max(points[0].lng, points[1].lng);
        return coord.lat >= minLat && coord.lat <= maxLat && coord.lng >= minLng && coord.lng <= maxLng;
      }
      if (zoneSelectMode === 'circle' && points.length >= 2) {
        const center = points[0];
        const edge = points[1];
        const R = 6371000;
        const dLat1 = (edge.lat - center.lat) * Math.PI / 180;
        const dLng1 = (edge.lng - center.lng) * Math.PI / 180;
        const a1 = Math.sin(dLat1 / 2) ** 2 + Math.cos(center.lat * Math.PI / 180) * Math.cos(edge.lat * Math.PI / 180) * Math.sin(dLng1 / 2) ** 2;
        const radius = R * 2 * Math.atan2(Math.sqrt(a1), Math.sqrt(1 - a1));
        const dLat2 = (coord.lat - center.lat) * Math.PI / 180;
        const dLng2 = (coord.lng - center.lng) * Math.PI / 180;
        const a2 = Math.sin(dLat2 / 2) ** 2 + Math.cos(center.lat * Math.PI / 180) * Math.cos(coord.lat * Math.PI / 180) * Math.sin(dLng2 / 2) ** 2;
        const dist = R * 2 * Math.atan2(Math.sqrt(a2), Math.sqrt(1 - a2));
        return dist <= radius;
      }
      if (zoneSelectMode === 'polygon' && points.length >= 3) {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const xi = points[i].lat, yi = points[i].lng;
          const xj = points[j].lat, yj = points[j].lng;
          const intersect = ((yi > coord.lng) !== (yj > coord.lng)) &&
            (coord.lat < (xj - xi) * (coord.lng - yi) / (yj - yi) + xi);
          if (intersect) inside = !inside;
        }
        return inside;
      }
      return false;
    };

    const matchedIds: string[] = [];
    segs.forEach((seg) => {
      if (seg.coordinates.some(isInZone)) matchedIds.push(seg.id);
    });

    if (matchedIds.length > 0) {
      const next = new Set(selectedSegmentIds);
      matchedIds.forEach((id) => next.add(id));
      setSelectedSegmentIds(next);
      toast.success(`${matchedIds.length} tramos seleccionados`);
    } else {
      toast.info('No se encontraron tramos en la zona');
    }
    setZoneSelectMode('none');
    setZoneSelectPoints([]);
  }, [state.route?.segments, zoneSelectMode, selectedSegmentIds, setSelectedSegmentIds]);

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
        plannedTrackNumber: null,
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
          plannedTrackNumber: null,
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

    // Count visible pending segments to give feedback
    const visiblePending = state.route?.segments.filter((s) => {
      if (s.nonRecordable) return false;
      if (s.layer && hiddenLayers.has(s.layer)) return false;
      return s.status === 'pendiente' || (s.status === 'posible_repetir' && s.needsRepeat);
    }) || [];

    if (visiblePending.length === 0) {
      toast.warning('No hay tramos visibles para optimizar');
      return;
    }

    onReoptimize(geo.position, hiddenLayers);
    // After full reoptimize, recalculate block
    setTimeout(() => recalcBlock(), 50);
    toast.success(`Itinerario optimizado (${visiblePending.length} tramos visibles)`);
  }, [gpsEnabled, geo.position, onReoptimize, recalcBlock, hiddenLayers, state.route]);

  const handleStartNavigation = useCallback(() => {
    if (!gpsEnabled) setGpsEnabled(true);
    primeAudio();
    recalcBlock();
    onStartNavigation(hiddenLayers);
  }, [gpsEnabled, onStartNavigation, hiddenLayers, recalcBlock]);

  // Play sound/vibration when blockEndPrompt opens
  const prevBlockOpenRef = useRef(false);
  useEffect(() => {
    if (state.blockEndPrompt.isOpen && !prevBlockOpenRef.current) {
      try { navigator.vibrate?.([200, 100, 200]); } catch {}
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        gain.gain.setValueAtTime(0.4, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
      } catch {}
    }
    prevBlockOpenRef.current = state.blockEndPrompt.isOpen;
  }, [state.blockEndPrompt.isOpen]);

  // Copilot: build queue of next eligible segments
  const getNextEligibleSegments = useCallback((fromCursor: number, count: number): { items: QueueItem[]; newCursor: number; segments: Segment[] } => {
    if (!state.route) return { items: [], newCursor: fromCursor, segments: [] };
    const order = state.route.optimizedOrder;
    const allSegments = state.route.segments;
    const items: QueueItem[] = [];
    const eligibleSegs: Segment[] = [];
    let cursor = fromCursor;

    while (items.length < count && cursor < order.length) {
      const seg = allSegments.find(s => s.id === order[cursor]);
      cursor++;
      if (!seg) continue;
      if (seg.layer && hiddenLayers.has(seg.layer)) continue;
      if (seg.nonRecordable) continue;
      if (seg.status === 'completado' && !seg.needsRepeat) continue;

      const start = seg.coordinates[0];
      items.push({ segmentId: seg.id, name: seg.name, lat: start.lat, lng: start.lng });
      eligibleSegs.push(seg);
    }
    return { items, newCursor: cursor, segments: eligibleSegs };
  }, [state.route, hiddenLayers]);

  // Copilot: compute a fingerprint of the "pending itinerary" to detect relevant changes
  const pendingFingerprint = useMemo(() => {
    if (!state.route || !copilot.active) return '';
    const order = state.route.optimizedOrder;
    const parts: string[] = [];
    for (const id of order) {
      const seg = state.route.segments.find(s => s.id === id);
      if (!seg) continue;
      if (seg.layer && hiddenLayers.has(seg.layer)) continue;
      if (seg.nonRecordable) continue;
      if (seg.status === 'completado' && !seg.needsRepeat) continue;
      parts.push(id);
    }
    return parts.join(',');
  }, [state.route, hiddenLayers, copilot.active]);

  // Copilot: auto-regenerate batch when itinerary changes (revision++)
  const prevFingerprintRef = useRef('');
  useEffect(() => {
    if (!copilot.active || !copilot.session || !state.route) return;
    if (!prevFingerprintRef.current) {
      // First load, don't trigger revision
      prevFingerprintRef.current = pendingFingerprint;
      return;
    }
    if (pendingFingerprint === prevFingerprintRef.current) return;
    prevFingerprintRef.current = pendingFingerprint;

    // Regenerate batch from scratch (cursor 0)
    const { items, newCursor, segments: batchSegs } = getNextEligibleSegments(0, SEGMENTS_PER_BATCH);
    if (items.length > 0) {
      const stops = segmentsToStops(batchSegs);
      const batchUrl = buildGoogleMapsBatchUrl(stops);
      copilot.pushQueue(items, newCursor, batchUrl);
    } else {
      // No pending segments
      copilot.pushQueue([], 0);
    }
  }, [pendingFingerprint]);

  // Copilot: initial queue fill when session starts
  const copilotInitRef = useRef(false);
  useEffect(() => {
    if (!copilot.active || !copilot.session || !state.route || copilotInitRef.current) return;
    const { items, newCursor, segments: batchSegs } = getNextEligibleSegments(0, SEGMENTS_PER_BATCH);
    if (items.length > 0) {
      const stops = segmentsToStops(batchSegs);
      const batchUrl = buildGoogleMapsBatchUrl(stops);
      copilot.pushQueue(items, newCursor, batchUrl);
    }
    copilotInitRef.current = true;
  }, [copilot.active, copilot.session, state.route]);

  // Reset init flag when session ends
  useEffect(() => {
    if (!copilot.active) copilotInitRef.current = false;
  }, [copilot.active]);

  // Copilot: auto-refill when queue drops to 1
  useEffect(() => {
    if (!copilot.active || !copilot.session || !state.route) return;
    const queue = copilot.session.queue || [];
    if (queue.length === 1) {
      const currentCursor = copilot.session.cursor_index;
      const { items: nextItems, newCursor, segments: batchSegs } = getNextEligibleSegments(currentCursor, SEGMENTS_PER_BATCH - 1);
      if (nextItems.length > 0) {
        const merged = [...queue, ...nextItems];
        const allSegs = batchSegs; // refill uses new segments only for URL
        const stops = segmentsToStops(allSegs);
        // Prepend current queue item stops (already in Maps, but regenerate full URL)
        const batchUrl = buildGoogleMapsBatchUrl(stops);
        copilot.pushQueue(merged, newCursor, batchUrl);
      }
    }
  }, [copilot.session?.queue?.length, copilot.active, state.route]);

  // Force send next batch (operator manual action)
  const handleForceSendBatch = useCallback(() => {
    if (!copilot.active || !copilot.session || !state.route) return;
    const { items, newCursor, segments: batchSegs } = getNextEligibleSegments(0, SEGMENTS_PER_BATCH);
    if (items.length > 0) {
      const stops = segmentsToStops(batchSegs);
      const batchUrl = buildGoogleMapsBatchUrl(stops);
      copilot.pushQueue(items, newCursor, batchUrl);
      toast.success(`Lote de ${items.length} tramos (${stops.length} paradas) enviado al conductor`);
    } else {
      toast.info('No quedan tramos pendientes para enviar');
    }
  }, [copilot.active, copilot.session, state.route, getNextEligibleSegments]);

  // Copilot: send blocked status when blockEndPrompt opens
  useEffect(() => {
    if (!copilot.active) return;
    if (state.blockEndPrompt.isOpen) {
      copilot.setBlocked();
    }
  }, [state.blockEndPrompt.isOpen, copilot.active]);

  const handleVideoEndContinue = useCallback(() => {
    onCloseBlockEndPrompt();
  }, [onCloseBlockEndPrompt]);


  const handleExportToGoogleMaps = useCallback(() => {
    if (!state.route) return;
    const route = state.route;
    // Get pending/in-progress segments from visible layers only
    const pendingIds = route.optimizedOrder.filter((id) => {
      const seg = route.segments.find((s) => s.id === id);
      if (!seg) return false;
      if (seg.layer && hiddenLayers.has(seg.layer)) return false;
      return seg.status === 'pendiente' || seg.status === 'en_progreso';
    });

    if (pendingIds.length === 0) return;

    // Build itinerary: start→end of each segment, then start of next, etc.
    // Max 9 segments (18 points = origin + up to 16 waypoints + destination = 18 ≤ 20)
    const selectedSegments = pendingIds.slice(0, 9).map((id) => route.segments.find((s) => s.id === id)!);

    const points: string[] = [];
    for (const seg of selectedSegments) {
      const start = seg.coordinates[0];
      const end = seg.coordinates[seg.coordinates.length - 1];
      points.push(`${start.lat},${start.lng}`);
      points.push(`${end.lat},${end.lng}`);
    }

    const origin = points[0];
    const destination = points[points.length - 1];
    const middle = points.slice(1, -1).join('|');

    let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`;
    if (middle) url += `&waypoints=${middle}`;

    window.open(url, '_blank');
  }, [state.route, hiddenLayers]);

  const route = state.route;

  // Get unique layers for creation panel
  const layers = useMemo(() => {
    if (!route) return [];
    const set = new Set<string>();
    route.segments.forEach((s) => { if (s.layer) set.add(s.layer); });
    return Array.from(set).sort();
  }, [route]);

  // Layer colors - safe palette (no green/yellow/red)
  const LAYER_COLORS = SAFE_LAYER_COLORS;

  // If there's a selection, show ONLY selected segments on the map; otherwise filter by hidden layers
  const visibleSegments = useMemo(() => {
    if (!route) return [];
    if (selectedSegmentIds.size > 0) {
      return route.segments.filter((s) => selectedSegmentIds.has(s.id));
    }
    return route.segments.filter((s) => !s.layer || !hiddenLayers.has(s.layer));
  }, [route, hiddenLayers, selectedSegmentIds]);

  const visibleOrder = useMemo(() => {
    if (!route) return [];
    const visibleIds = new Set(visibleSegments.map((s) => s.id));
    return route.optimizedOrder.filter((id) => visibleIds.has(id));
  }, [route, visibleSegments]);

  const layerColorMap = useMemo(() => {
    if (!route) return new Map<string, string>();
    // Build layer index map
    const layerNames = [...new Set(route.segments.map((s) => s.layer).filter(Boolean) as string[])].sort();
    const colorMap = new Map<string, string>();
    route.segments.forEach((seg) => {
      if (seg.layer) {
        const idx = layerNames.indexOf(seg.layer);
        colorMap.set(seg.id, LAYER_COLORS[idx % LAYER_COLORS.length]);
      }
    });
    return colorMap;
  }, [route]);

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
           onSegmentClick={handleSegmentClick}
           selectedSegmentIds={selectedSegmentIds.size > 0 || selectionMode ? selectedSegmentIds : undefined}
           layerColorMap={layerColorMap}
           creationMode={creationMode}
           onMapClick={handleMapClick}
           creationStartPoint={creationStart}
           creationEndPoint={creationEnd}
           creationRoutePreview={creationRoute}
           areaSelectionMode={zoneSelectMode !== 'none' ? zoneSelectMode : areaMode}
           areaPoints={zoneSelectMode !== 'none' ? zoneSelectPoints : areaPoints}
           onAreaClick={zoneSelectMode !== 'none' ? handleZoneSelectClick : handleAreaClick}
           fitToActiveSegment={state.navigationActive && !!state.activeSegmentId}
           centerActiveRequest={centerActiveRequest}
           arrowSegmentIds={arrowSegmentIds}
        />
      </div>

      {/* Map mode indicator */}
      <div className={`absolute top-3 left-3 z-10 px-2.5 py-1 rounded-full text-[10px] font-medium shadow-sm backdrop-blur-sm ${
        mapMode === 'google' 
          ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
          : 'bg-muted/80 text-muted-foreground border border-border'
      }`}>
        {mapMode === 'google' ? '● Google Maps activo' : '● Modo offline (Leaflet)'}
      </div>
      {/* Debug mode toggle */}
      <button
        onClick={() => setDebugMode(!debugMode)}
        className={`absolute top-12 left-3 z-10 px-2.5 py-1 rounded-full text-[10px] font-medium shadow-sm backdrop-blur-sm transition-colors ${
          debugMode
            ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
            : 'bg-muted/60 text-muted-foreground/50 border border-transparent hover:border-border'
        }`}
        title="Debug optimizador"
      >
        🐛 Debug
      </button>
      {state.activeSegmentId && state.navigationActive && (
        <button
          onClick={() => setCenterActiveRequest((c) => c + 1)}
          className="absolute top-3 left-48 z-10 w-9 h-9 rounded-full bg-card/90 backdrop-blur-sm border border-border shadow-sm flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          title="Centrar en tramo activo"
        >
          <Crosshair className="w-4 h-4" />
        </button>
      )}

      {/* === NAVIGATION OVERLAY (operational HUD) === */}
      {state.navigationActive && activeSegment && navTracker.operationalState !== 'idle' && (
        <NavigationOverlay
          segment={activeSegment}
          operationalState={navTracker.operationalState}
          distanceToStart={navTracker.distanceToStart}
          distanceToEnd={navTracker.distanceToEnd}
          etaToStart={navTracker.etaToStart}
          progressPercent={navTracker.progressPercent}
          distanceRemaining={navTracker.distanceRemaining}
          totalDistance={navTracker.totalDistance}
          speedKmh={navTracker.speedKmh}
          deviationMeters={navTracker.deviationMeters}
          showApproachPrompt={navTracker.showApproachPrompt}
          onStartSegment={() => {
            navTracker.dismissApproachPrompt();
            onConfirmStart(activeSegment.id, hiddenLayers);
          }}
          onCompleteSegment={() => onComplete(activeSegment.id, hiddenLayers)}
          onSkipSegment={() => onSkipSegment(activeSegment.id, hiddenLayers)}
          onPostpone={() => {
            navTracker.dismissApproachPrompt();
            onSkipSegment(activeSegment.id, hiddenLayers);
          }}
          onAddIncident={(cat, impact, note, nonRec) => onAddIncident(activeSegment.id, cat, impact, note, geo.position ?? undefined, nonRec)}
          onRestartSegment={handleRestartSegment}
          onConfirmF5={handleConfirmF5}
          currentPosition={geo.position}
          isBlocked={videoEndBlocking}
          isInvalidated={navTracker.isInvalidated}
          contiguousInfo={navTracker.contiguousInfo}
          activeReference={navTracker.activeReference}
          headingDelta={navTracker.headingDelta}
          stats={navTracker.stats}
          approachSequenceValid={navTracker.approachSequenceValid}
          geometricRecoveryOnly={navTracker.geometricRecoveryOnly}
          f5Events={f5EventsRef.current}
          distanceCovered={navTracker.stats.validDistanceM + navTracker.stats.invalidDistanceM}
          distancePastEnd={navTracker.distancePastEnd}
          showF7Prompt={navTracker.showF7Prompt}
          showF9PostPrompt={navTracker.showF9PostPrompt}
          distanceToNextSegment={navTracker.distanceToNextSegment}
          onInvertSegment={() => {
            if (activeSegment) {
              onReverseSegment(activeSegment.id);
            }
          }}
        />
      )}

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

      {/* Zone selection panel */}
      {zoneSelectMode !== 'none' && (
        <div className="absolute top-3 left-3 right-3 z-30 bg-card/95 backdrop-blur-sm border border-accent/30 rounded-xl shadow-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <BoxSelect className="w-4 h-4 text-accent" />
              Seleccionar por zona
            </h3>
            <button onClick={cancelZoneSelect} className="text-xs text-muted-foreground hover:text-foreground">
              Cancelar
            </button>
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            {zoneSelectMode === 'rectangle'
              ? `Haz click en 2 esquinas opuestas. (${zoneSelectPoints.length}/2)`
              : zoneSelectMode === 'circle'
                ? `Haz click en el centro y luego en el borde. (${zoneSelectPoints.length}/2)`
                : `Haz click para definir los vértices. (${zoneSelectPoints.length} puntos)`}
          </p>
          {zoneSelectMode === 'polygon' && zoneSelectPoints.length >= 3 && (
            <Button size="sm" onClick={finishZonePolygon} className="w-full h-8 text-xs bg-accent text-accent-foreground">
              Cerrar polígono y seleccionar
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
      {!creationMode && areaMode === 'none' && zoneSelectMode === 'none' && (
        <div className="absolute top-3 right-3 z-20 flex flex-col gap-2">
          {/* Selection mode toggle */}
          <button
            onClick={() => {
              setSelectionMode(!selectionMode);
              if (selectionMode) setSelectedSegmentIds(new Set());
            }}
            className={`w-10 h-10 rounded-full shadow-lg flex items-center justify-center transition-colors ${
              selectionMode
                ? 'bg-accent text-accent-foreground ring-2 ring-accent/50'
                : 'bg-secondary text-muted-foreground hover:text-foreground'
            }`}
            title={selectionMode ? 'Desactivar selección' : 'Seleccionar tramos'}
          >
            <MousePointer2 className="w-4 h-4" />
          </button>

          {/* Zone selection buttons - only show in selection mode */}
          {selectionMode && (
            <>
              <button
                onClick={() => setZoneSelectMode('rectangle')}
                className="w-10 h-10 rounded-full bg-accent/80 text-accent-foreground shadow-lg flex items-center justify-center hover:bg-accent transition-colors"
                title="Seleccionar por rectángulo"
              >
                <Square className="w-4 h-4" />
              </button>
              <button
                onClick={() => setZoneSelectMode('polygon')}
                className="w-10 h-10 rounded-full bg-accent/80 text-accent-foreground shadow-lg flex items-center justify-center hover:bg-accent transition-colors"
                title="Seleccionar por polígono"
              >
                <Pentagon className="w-4 h-4" />
              </button>
              <button
                onClick={() => setZoneSelectMode('circle')}
                className="w-10 h-10 rounded-full bg-accent/80 text-accent-foreground shadow-lg flex items-center justify-center hover:bg-accent transition-colors"
                title="Seleccionar por círculo"
              >
                <Circle className="w-4 h-4" />
              </button>
            </>
          )}

          {/* Divider */}
          {selectionMode && <div className="w-6 h-px bg-border mx-auto" />}

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
            title="Generar tramos - Rectángulo"
          >
            <Square className="w-4 h-4" />
          </button>
           <button
            onClick={() => setAreaMode('polygon')}
            className="w-10 h-10 rounded-full bg-accent text-accent-foreground shadow-lg flex items-center justify-center hover:bg-accent/90 transition-colors"
            title="Generar tramos - Polígono"
          >
            <Pentagon className="w-4 h-4" />
          </button>
          <button
            onClick={() => setAreaMode('circle')}
            className="w-10 h-10 rounded-full bg-accent text-accent-foreground shadow-lg flex items-center justify-center hover:bg-accent/90 transition-colors"
            title="Generar tramos - Círculo"
          >
            <Circle className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Optimizer debug panel */}
      {debugMode && (
        <OptimizerDebugPanel
          debugInfo={optimizerDebugInfo}
          segments={state.route?.segments || []}
        />
      )}

      {/* Control panel overlay */}
      {!creationMode && areaMode === 'none' && zoneSelectMode === 'none' && (
        <MapControlPanel
          segments={visibleSegments}
          optimizedOrder={visibleOrder}
          activeSegmentId={state.activeSegmentId}
          gpsEnabled={gpsEnabled}
          currentPosition={geo.position}
          gpsAccuracy={geo.accuracy}
          gpsSpeed={geo.speed}
          gpsError={geo.error}
          navigationActive={state.navigationActive}
          base={state.base}
          rstMode={state.rstMode}
          rstGroupSize={state.rstGroupSize}
          trackSession={state.trackSession}
          onToggleGps={(v) => { if (v) primeAudio(); setGpsEnabled(v); }}
          onConfirmStart={(segId) => onConfirmStart(segId, hiddenLayers)}
          onComplete={(segId) => onComplete(segId, hiddenLayers)}
          onResetSegment={onResetSegment}
          onAddIncident={onAddIncident}
          onRepeatSegment={onRepeatSegment}
          onReoptimize={handleReoptimize}
          onStartNavigation={handleStartNavigation}
          onStopNavigation={onStopNavigation}
          onExportToGoogleMaps={handleExportToGoogleMaps}
          onSegmentSelect={onSetActiveSegment}
          onSetBase={onSetBase}
          selectedSegmentIds={selectedSegmentIds}
          onSelectedSegmentsChange={setSelectedSegmentIds}
          onMergeSegments={onMergeSegments}
          onSetRstMode={onSetRstMode}
          onSetRstGroupSize={onSetRstGroupSize}
          onFinalizeTrack={onFinalizeTrack}
          onSkipSegment={(segId) => onSkipSegment(segId, hiddenLayers)}
          workDay={state.workDay}
          onSetWorkDay={onSetWorkDay}
          activeRouteBlock={activeRouteBlock}
          videoEndBlocking={videoEndBlocking}
          onVideoEndContinue={handleVideoEndContinue}
          
          copilotSession={copilot.session}
          copilotActive={copilot.active}
          onCopilotStart={copilot.createSession}
          onCopilotEnd={copilot.endSession}
          onForceSendBatch={handleForceSendBatch}
        />
      )}
    </div>
  );
}
