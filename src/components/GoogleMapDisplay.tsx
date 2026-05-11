/// <reference types="google.maps" />
import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import type { Segment, LatLng } from '@/types/route';
import { getGoogleMapsApiKey } from '@/utils/google-directions';
import { MapDisplay } from './MapDisplay';
import { useSmartFitGoogle, type FitReason } from '@/hooks/useSmartFit';
import { useConnectivity } from '@/hooks/useConnectivity';
import { resolveSegmentColor, resolveSegmentDisplayColor } from '@/utils/segment-colors';
import type { TrimbleSegmentStatus } from '@/types/trimble';
import { type TrimbleLiveCoverageItem } from '@/utils/trimble/live-coverage';
import { getSegmentArrows, clearArrowCache } from '@/utils/segment-arrows';
import { isValidLatLng } from '@/utils/coord-validation';

const DARK_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#1a1d23' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1d23' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a8f98' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2c3038' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#8a8f98' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1626' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

const LIGHT_STYLES: google.maps.MapTypeStyle[] = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

function getMapTheme(): 'light' | 'dark' {
  try { return (localStorage.getItem('vialroute_map_theme') as 'light' | 'dark') || 'light'; } catch { return 'light'; }
}

export type AreaSelectionMode = 'none' | 'rectangle' | 'polygon' | 'circle';

interface Props {
  segments: Segment[];
  activeSegmentId?: string | null;
  currentPosition?: LatLng | null;
  optimizedOrder?: string[];
  className?: string;
  onSegmentClick?: (segmentId: string) => void;
  selectedSegmentIds?: Set<string>;
  layerColorMap?: Map<string, string>;
  creationMode?: boolean;
  onMapClick?: (latlng: LatLng) => void;
  creationStartPoint?: LatLng | null;
  creationEndPoint?: LatLng | null;
  creationRoutePreview?: LatLng[] | null;
  areaSelectionMode?: AreaSelectionMode;
  areaPoints?: LatLng[];
  onAreaClick?: (latlng: LatLng) => void;
  fitToActiveSegment?: boolean;
  centerActiveRequest?: number;
  arrowSegmentIds?: string[];
  /** All campaign segments for offline coverage selection */
  allSegments?: Segment[];
  /** Notify parent about offline layer state */
  onOfflineStateChange?: (state: { active: boolean; noTiles: boolean }) => void;
  /** Whether this map is currently visible (for resize invalidation) */
  visible?: boolean;
  /**
   * Buscador: ubicación a la que centrar el mapa (calle/lugar). Cuando cambia
   * `searchCenterRequest`, el mapa centra en `searchTargetLocation` (con
   * bounds si vienen) y coloca un marcador temporal de búsqueda.
   */
  searchTargetSegmentId?: string | null;
  searchTargetLocation?: LatLng | null;
  searchTargetBounds?: { north: number; south: number; east: number; west: number } | null;
  searchCenterRequest?: number;
  /**
   * Solicitud de refresco manual del mapa (contador incremental).
   * Cuando cambia, el componente fuerza `resize` + repintado de overlays
   * y, si detecta el mapa "perdido" (sin polilíneas con datos disponibles
   * o centrado en [0,0]), realiza una recuperación segura con `smartFit`.
   * No mueve el mapa cuando el estado actual es correcto.
   */
  mapRefreshRequest?: number;
  /**
   * Modo Trimble: si se provee, sobreescribe el color del tramo por el
   * estado Trimble derivado. No afecta cuando es undefined o vacío.
   */
  trimbleStatusBySegment?: Map<string, TrimbleSegmentStatus> | null;
  /** Cobertura GPS provisional durante una grabación Trimble activa.
   *  Tiene prioridad visual sobre `trimbleStatusBySegment` y
   *  desaparece automáticamente al perder la sesión activa. */
  trimbleLiveCoverageBySegment?: Map<string, TrimbleLiveCoverageItem> | null;
}

let googleMapsPromise: Promise<void> | null = null;

function loadGoogleMaps(apiKey: string): Promise<void> {
  if ((window as any).google?.maps?.Map) return Promise.resolve();
  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existing) existing.remove();

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=geometry`;
    script.async = true;
    script.onload = () => { googleMapsPromise = null; resolve(); };
    script.onerror = () => { googleMapsPromise = null; reject(new Error('Failed to load Google Maps')); };
    document.head.appendChild(script);
  });

  return googleMapsPromise;
}

/**
 * Build a fingerprint string for segment geometry + styling to detect real changes.
 * This avoids full overlay rebuild when only GPS position changes.
 */
function buildSegmentFingerprint(
  segments: Segment[],
  activeSegmentId: string | null | undefined,
  optimizedOrder: string[] | undefined,
  selectedSegmentIds: Set<string> | undefined,
  arrowSegmentIds: string[] | undefined,
): string {
  // Include factors that affect polyline/marker rendering
  const parts: string[] = [
    activeSegmentId || '',
    optimizedOrder?.join(',') || '',
    arrowSegmentIds?.join(',') || '',
    selectedSegmentIds ? Array.from(selectedSegmentIds).sort().join(',') : '',
  ];
  for (const seg of segments) {
    parts.push(`${seg.id}:${seg.status}:${seg.color || ''}:${seg.coordinates.length}`);
  }
  return parts.join('|');
}

export function GoogleMapDisplay({
  segments,
  activeSegmentId,
  currentPosition,
  optimizedOrder,
  className = '',
  onSegmentClick,
  selectedSegmentIds,
  layerColorMap,
  creationMode = false,
  onMapClick,
  creationStartPoint,
  creationEndPoint,
  creationRoutePreview,
  areaSelectionMode = 'none',
  areaPoints = [],
  onAreaClick,
  fitToActiveSegment = false,
  centerActiveRequest = 0,
  arrowSegmentIds,
  allSegments,
  onOfflineStateChange,
  visible,
  searchTargetSegmentId,
  searchTargetLocation,
  searchTargetBounds,
  searchCenterRequest = 0,
  mapRefreshRequest = 0,
  trimbleStatusBySegment = null,
  trimbleLiveCoverageBySegment = null,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  // Static overlays (polylines + order markers)
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const orderMarkersRef = useRef<google.maps.Marker[]>([]);
  const connectionLinesRef = useRef<google.maps.Polyline[]>([]);
  // Dynamic overlays (arrows — depend on zoom)
  const arrowMarkersRef = useRef<google.maps.Marker[]>([]);
  // GPS position marker (separate lifecycle)
  const posMarkerRef = useRef<google.maps.Marker | null>(null);
  // Marcador temporal del buscador (resultado de geocoding)
  const searchMarkerRef = useRef<google.maps.Marker | null>(null);
  // Creation & area overlays
  const creationMarkersRef = useRef<google.maps.Marker[]>([]);
  const creationPolylineRef = useRef<google.maps.Polyline | null>(null);
  const areaOverlayRef = useRef<google.maps.Polygon | google.maps.Rectangle | null>(null);
  const areaMarkersRef = useRef<google.maps.Marker[]>([]);
  const areaClickListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const clickListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const zoomListenerRef = useRef<google.maps.MapsEventListener | null>(null);

  const [mapReady, setMapReady] = useState(false);
  const [fallbackToLeaflet, setFallbackToLeaflet] = useState(false);
  const [offlineSwitch, setOfflineSwitch] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(6);
  const { requestFitBounds: smartFit, resetFitState } = useSmartFitGoogle();
  const { isOnline, wasOffline, ackRecovery } = useConnectivity();
  const hadGoogleRef = useRef(false);

  // Track segment fingerprint to avoid redundant rebuilds
  const prevFingerprintRef = useRef('');

  // --- Helpers ---
  const clearStaticOverlays = useCallback(() => {
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];
    orderMarkersRef.current.forEach((m) => m.setMap(null));
    orderMarkersRef.current = [];
    connectionLinesRef.current.forEach((l) => l.setMap(null));
    connectionLinesRef.current = [];
  }, []);

  const clearArrowOverlays = useCallback(() => {
    arrowMarkersRef.current.forEach((m) => m.setMap(null));
    arrowMarkersRef.current = [];
  }, []);

  // Determine which segment IDs should show order numbers (active + block)
  const orderNumberIds = useMemo(() => {
    const ids = new Set<string>();
    if (activeSegmentId) ids.add(activeSegmentId);
    if (arrowSegmentIds) arrowSegmentIds.forEach((id) => ids.add(id));
    return ids;
  }, [activeSegmentId, arrowSegmentIds]);

  // --- Auth error detection ---
  useEffect(() => {
    const handler = () => {
      console.warn('Google Maps auth error detected, falling back to Leaflet');
      setFallbackToLeaflet(true);
    };
    (window as any).gm_authFailure = handler;
    return () => { delete (window as any).gm_authFailure; };
  }, []);

  // --- Connectivity-aware switching ---
  // When offline: switch to Leaflet (which has offline tile support)
  // When back online: restore Google Maps if it was previously active
  useEffect(() => {
    if (!isOnline && !fallbackToLeaflet) {
      // Going offline — remember we had Google and switch to Leaflet
      hadGoogleRef.current = hadGoogleRef.current || mapReady;
      setOfflineSwitch(true);
    } else if (isOnline && wasOffline) {
      // Coming back online — restore Google Maps if we had it
      if (hadGoogleRef.current && !fallbackToLeaflet && offlineSwitch) {
        setOfflineSwitch(false);
      }
      ackRecovery(); // Always clear wasOffline
    }
  }, [isOnline, wasOffline, fallbackToLeaflet, mapReady, offlineSwitch, ackRecovery]);

  // Track that Google Maps was successfully initialized
  useEffect(() => {
    if (mapReady) hadGoogleRef.current = true;
  }, [mapReady]);

  // --- Initialize map ---
  useEffect(() => {
    if (fallbackToLeaflet || offlineSwitch) return;
    if (!containerRef.current || mapRef.current) return;

    const apiKey = getGoogleMapsApiKey();
    if (!apiKey) { setFallbackToLeaflet(true); return; }

    let cancelled = false;

    loadGoogleMaps(apiKey)
      .then(() => {
        if (cancelled || !containerRef.current) return;

        const map = new google.maps.Map(containerRef.current, {
          center: { lat: 40.4168, lng: -3.7038 },
          zoom: 6,
          disableDefaultUI: true,
          zoomControl: true,
          styles: getMapTheme() === 'dark' ? DARK_STYLES : LIGHT_STYLES,
        });

        setTimeout(() => {
          if (cancelled) return;
          const errorDiv = containerRef.current?.querySelector('.gm-err-container');
          if (errorDiv) { setFallbackToLeaflet(true); return; }
          mapRef.current = map;
          setCurrentZoom(map.getZoom() || 6);
          setMapReady(true);
        }, 1500);
      })
      .catch(() => { if (!cancelled) setFallbackToLeaflet(true); });

    return () => { cancelled = true; mapRef.current = null; setMapReady(false); };
  }, [fallbackToLeaflet, offlineSwitch]);

  // --- Zoom listener (for arrow/number visibility) ---
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    if (zoomListenerRef.current) zoomListenerRef.current.remove();
    zoomListenerRef.current = map.addListener('zoom_changed', () => {
      setCurrentZoom(map.getZoom() || 6);
    });

    return () => { zoomListenerRef.current?.remove(); zoomListenerRef.current = null; };
  }, [mapReady]);

  // --- Listen for map theme changes ---
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const handler = () => {
      mapRef.current?.setOptions({
        styles: getMapTheme() === 'dark' ? DARK_STYLES : LIGHT_STYLES,
      });
    };
    window.addEventListener('vialroute:map-theme-changed', handler);
    return () => window.removeEventListener('vialroute:map-theme-changed', handler);
  }, [mapReady]);

  // --- Resize when becoming visible (tab switch persistence) ---
  // When MapPage was hidden via display:none and becomes visible again,
  // Google Maps needs a manual 'resize' AND we must force a full repaint
  // (we skip rebuilds while hidden because the container has 0×0 size, which
  // makes fitBounds calculate garbage centers — e.g. Gulf of Guinea).
  const prevVisibleRef = useRef(visible);
  useEffect(() => {
    if (visible && !prevVisibleRef.current && mapRef.current) {
      google.maps.event.trigger(mapRef.current, 'resize');
      // Invalidate fingerprints so the segment-draw effect re-runs against
      // the now-correctly-sized container and re-fits bounds if needed.
      // The draw effect depends on segmentFingerprint (which now embeds
      // mapRefreshRequest); resetting the prev ref is enough — when segments
      // change next, or when a refresh is requested, the effect will re-run.
      prevFingerprintRef.current = '__force_repaint__';
      prevIdSetFingerprintRef.current = '';
      resetFitState();
    }
    prevVisibleRef.current = visible;
  }, [visible, resetFitState]);

  // Compute segment fingerprint.
  // IMPORTANT: include `mapRefreshRequest` so the draw effect re-runs
  // deterministically when the user presses "Refresh map" — this is the
  // only reliable way to force a full repaint of overlays without depending
  // on ref mutations (which don't trigger re-renders) or no-op state updates.
  const trimbleStatusFingerprint = useMemo(() => {
    if (!trimbleStatusBySegment || trimbleStatusBySegment.size === 0) return '';
    const parts: string[] = [];
    trimbleStatusBySegment.forEach((status, id) => parts.push(`${id}:${status}`));
    return parts.sort().join(',');
  }, [trimbleStatusBySegment]);

  const trimbleLiveFingerprint = useMemo(() => {
    if (!trimbleLiveCoverageBySegment || trimbleLiveCoverageBySegment.size === 0) return '';
    const parts: string[] = [];
    trimbleLiveCoverageBySegment.forEach((it, id) =>
      parts.push(`${id}:${it.status}:${Math.round(it.coverageRatio * 100)}`),
    );
    return parts.sort().join(',');
  }, [trimbleLiveCoverageBySegment]);

  const segmentFingerprint = useMemo(
    () => `${mapRefreshRequest}|${buildSegmentFingerprint(segments, activeSegmentId, optimizedOrder, selectedSegmentIds, arrowSegmentIds)}|T:${trimbleStatusFingerprint}|L:${trimbleLiveFingerprint}`,
    [mapRefreshRequest, segments, activeSegmentId, optimizedOrder, selectedSegmentIds, arrowSegmentIds, trimbleStatusFingerprint, trimbleLiveFingerprint],
  );

  // Fingerprint that ONLY tracks the set of segment IDs (not status/colors).
  // Used to decide whether to re-run fitBounds: we only want to auto-frame
  // the map when the segment set itself changes (initial load, delete,
  // KML reload), NOT when a manual segment is added on top of the
  // current view (that would visually push existing segments off-screen).
  const idSetFingerprint = useMemo(
    () => segments.map((s) => s.id).sort().join(','),
    [segments],
  );
  const prevIdSetFingerprintRef = useRef('');

  // --- Draw static overlays (polylines, connection lines, order markers) ---
  // Only rebuild when segment data actually changes, NOT on GPS position updates.
  // CRITICAL: skip while map is hidden (display:none on parent). Container has
  // size 0×0, fitBounds would calculate garbage. We re-trigger when visible
  // becomes true (see visible-effect above which resets fingerprints).
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    if (visible === false) return; // map is hidden — defer paint
    if (segmentFingerprint === prevFingerprintRef.current) return;

    const map = mapRef.current;
    try { if (typeof map.getCenter !== 'function') return; } catch { return; }

    // NOTE: prevFingerprintRef is updated AT THE END of this effect (after a
    // successful repaint). Updating it earlier caused a critical bug where
    // creating a manual segment would clear all polylines but, if the effect
    // got interrupted (StrictMode, cleanup, micro-task race), the next render
    // would see fingerprint===prev and skip the repaint, leaving the map blank
    // until a full reload.
    clearStaticOverlays();
    clearArrowOverlays();
    clearArrowCache();

    // Decide if we need to auto-fit:
    // - First paint (initial load): always fit.
    // - Subsequent changes: fit only if the new ID set is NOT a strict
    //   superset of the previous one (i.e. something was deleted or
    //   replaced). Pure additions (manual segment) don't refit so the
    //   user keeps the current viewport.
    const isFirstPaint = prevIdSetFingerprintRef.current === '';
    let shouldFit = false;
    if (isFirstPaint) {
      shouldFit = idSetFingerprint !== '';
    } else if (idSetFingerprint !== prevIdSetFingerprintRef.current) {
      const prevIds = new Set(prevIdSetFingerprintRef.current.split(','));
      const currIds = idSetFingerprint.split(',');
      // If any previous id is missing now -> set changed (delete/replace) -> refit.
      // If only new ids were added -> don't refit.
      const onlyAdded = Array.from(prevIds).every((id) => currIds.includes(id));
      shouldFit = !onlyAdded;
    }


    const bounds = new google.maps.LatLngBounds();
    let hasValidBounds = false;

    // Connection lines for optimized order
    if (optimizedOrder && optimizedOrder.length > 1) {
      const segMap = new Map(segments.map((s) => [s.id, s]));
      for (let i = 0; i < optimizedOrder.length - 1; i++) {
        const curr = segMap.get(optimizedOrder[i]);
        const next = segMap.get(optimizedOrder[i + 1]);
        if (!curr || !next) continue;
        const endCoord = curr.coordinates[curr.coordinates.length - 1];
        const startCoord = next.coordinates[0];
        if (!isValidLatLng(endCoord) || !isValidLatLng(startCoord)) continue;
        try {
          const line = new google.maps.Polyline({
            path: [
              { lat: endCoord.lat, lng: endCoord.lng },
              { lat: startCoord.lat, lng: startCoord.lng },
            ],
            strokeColor: '#ffffff',
            strokeOpacity: 0.12,
            strokeWeight: 1,
            geodesic: true,
            map,
          });
          connectionLinesRef.current.push(line);
        } catch (e) {
          console.warn('[GoogleMapDisplay] connection line skipped:', e);
        }
      }
    }

    // Segment polylines — wrap each segment so a single bad coord does not
    // abort the whole repaint and leave the map blank.
    segments.forEach((seg) => {
      try {
        const validCoords = (seg.coordinates || []).filter(isValidLatLng);
        if (validCoords.length < 2) return; // not drawable

        const path = validCoords.map((c) => ({ lat: c.lat, lng: c.lng }));
        const isActive = seg.id === activeSegmentId;
        const isSelected = selectedSegmentIds?.has(seg.id);
        const layerColor = seg.color || layerColorMap?.get(seg.id);
        const trimbleStatus = trimbleStatusBySegment?.get(seg.id);
        const liveItem = trimbleLiveCoverageBySegment?.get(seg.id);
        const baseColor = liveItem
          ? TRIMBLE_LIVE_STATUS_COLOR[liveItem.status]
          : trimbleStatus
            ? resolveTrimbleSegmentColor(trimbleStatus)
            : resolveSegmentColor(seg, activeSegmentId, layerColor);
        const color = isSelected ? '#8b5cf6' : baseColor;

        const polyline = new google.maps.Polyline({
          path,
          strokeColor: color,
          strokeWeight: isActive ? 6 : isSelected ? 5 : 3,
          strokeOpacity: isActive ? 1 : isSelected ? 0.95 : 0.7,
          map,
        });

        if (onSegmentClick) {
          polyline.addListener('click', () => onSegmentClick(seg.id));
        }

        polylinesRef.current.push(polyline);
        path.forEach((p) => {
          bounds.extend(new google.maps.LatLng(p.lat, p.lng));
          hasValidBounds = true;
        });

        // Order number markers — only for active block segments
        if (optimizedOrder && orderNumberIds.has(seg.id)) {
          const orderIdx = optimizedOrder.indexOf(seg.id);
          if (orderIdx >= 0) {
            const startCoord = validCoords[0];
            const marker = new google.maps.Marker({
              position: { lat: startCoord.lat, lng: startCoord.lng },
              map,
              label: {
                text: `${orderIdx + 1}`,
                color: '#fff',
                fontSize: '10px',
                fontWeight: 'bold',
              },
              icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 12,
                fillColor: color,
                fillOpacity: 1,
                strokeColor: '#000',
                strokeWeight: 1,
              },
            });
            orderMarkersRef.current.push(marker);
          }
        }
      } catch (e) {
        console.warn('[GoogleMapDisplay] segment skipped due to draw error:', seg.id, e);
      }
    });

    // Only fit bounds when the segment set really changed AND we have valid
    // coordinates. Never auto-fit just because a single segment was appended.
    if (shouldFit && hasValidBounds && !bounds.isEmpty()) {
      // Clear cooldown so this fit is guaranteed to happen
      resetFitState();
      smartFit(map, bounds, 'segmentsLoaded');
    }

    // Defensive warning: if we received a non-empty segment list but ended up
    // painting zero polylines, something upstream is filtering them out (bad
    // coords, stale selection) and the user will see a blank map. Surface it.
    if (segments.length > 0 && polylinesRef.current.length === 0) {
      console.warn(
        '[GoogleMapDisplay] received',
        segments.length,
        'segments but painted 0 polylines — check coordinates / visibility filters',
      );
    }

    // Mark fingerprints as painted ONLY after a complete repaint succeeded.
    prevFingerprintRef.current = segmentFingerprint;
    prevIdSetFingerprintRef.current = idSetFingerprint;
  }, [segmentFingerprint, idSetFingerprint, mapReady, visible, layerColorMap, onSegmentClick, clearStaticOverlays, clearArrowOverlays, smartFit, orderNumberIds, segments, activeSegmentId, optimizedOrder, selectedSegmentIds, resetFitState]);


  // --- Draw/hide arrow overlays based on zoom ---
  // Arrows only render at zoom >= 15 and only for arrowSegmentIds
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    clearArrowOverlays();

    // Don't render arrows at low zoom
    if (currentZoom < 15) return;

    const arrowSet = arrowSegmentIds ? new Set(arrowSegmentIds) : null;
    if (!arrowSet || arrowSet.size === 0) return;

    segments.forEach((seg) => {
      if (!arrowSet.has(seg.id)) return;

      const layerColor = seg.color || layerColorMap?.get(seg.id);
      const color = selectedSegmentIds?.has(seg.id)
        ? '#8b5cf6'
        : resolveSegmentColor(seg, activeSegmentId, layerColor);

      const arrows = getSegmentArrows(seg.id, seg.coordinates);
      arrows.forEach(({ pos, angle }) => {
        const arrowMarker = new google.maps.Marker({
          position: { lat: pos.lat, lng: pos.lng },
          map,
          icon: {
            path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
            scale: 2,
            fillColor: color,
            fillOpacity: 0.55,
            strokeColor: color,
            strokeWeight: 0.5,
            rotation: angle,
          },
          clickable: false,
          zIndex: 10,
        });
        arrowMarkersRef.current.push(arrowMarker);
      });
    });
  }, [currentZoom, segmentFingerprint, arrowSegmentIds, mapReady, clearArrowOverlays, segments, activeSegmentId, selectedSegmentIds, layerColorMap]);

  // --- GPS position marker (completely separate from segment rendering) ---
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;

    if (posMarkerRef.current) {
      if (currentPosition) {
        // Just update position, don't recreate
        posMarkerRef.current.setPosition({ lat: currentPosition.lat, lng: currentPosition.lng });
        return;
      } else {
        posMarkerRef.current.setMap(null);
        posMarkerRef.current = null;
        return;
      }
    }

    if (currentPosition) {
      posMarkerRef.current = new google.maps.Marker({
        position: { lat: currentPosition.lat, lng: currentPosition.lng },
        map: mapRef.current,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#3b82f6',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 3,
        },
        zIndex: 999,
      });
    }
  }, [currentPosition, mapReady]);

  // --- Order marker visibility based on zoom ---
  useEffect(() => {
    if (!mapReady) return;
    const visible = currentZoom >= 14;
    orderMarkersRef.current.forEach((m) => m.setVisible(visible));
  }, [currentZoom, mapReady]);

  // --- Creation mode: map click listener ---
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    if (clickListenerRef.current) {
      clickListenerRef.current.remove();
      clickListenerRef.current = null;
    }

    if (creationMode && onMapClick) {
      mapRef.current.setOptions({ draggableCursor: 'crosshair' });
      clickListenerRef.current = mapRef.current.addListener('click', (e: google.maps.MapMouseEvent) => {
        if (e.latLng) onMapClick({ lat: e.latLng.lat(), lng: e.latLng.lng() });
      });
    } else {
      mapRef.current.setOptions({ draggableCursor: undefined });
    }

    return () => {
      if (clickListenerRef.current) { clickListenerRef.current.remove(); clickListenerRef.current = null; }
    };
  }, [creationMode, onMapClick, mapReady]);

  // --- Creation mode: preview markers and route ---
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    creationMarkersRef.current.forEach((m) => m.setMap(null));
    creationMarkersRef.current = [];
    if (creationPolylineRef.current) {
      creationPolylineRef.current.setMap(null);
      creationPolylineRef.current = null;
    }

    if (creationStartPoint) {
      const marker = new google.maps.Marker({
        position: { lat: creationStartPoint.lat, lng: creationStartPoint.lng },
        map,
        label: { text: 'A', color: '#fff', fontSize: '12px', fontWeight: 'bold' },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 14,
          fillColor: '#22c55e',
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 2,
        },
        zIndex: 1000,
      });
      creationMarkersRef.current.push(marker);
    }

    if (creationEndPoint) {
      const marker = new google.maps.Marker({
        position: { lat: creationEndPoint.lat, lng: creationEndPoint.lng },
        map,
        label: { text: 'B', color: '#fff', fontSize: '12px', fontWeight: 'bold' },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 14,
          fillColor: '#ef4444',
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 2,
        },
        zIndex: 1000,
      });
      creationMarkersRef.current.push(marker);
    }

    if (creationRoutePreview && creationRoutePreview.length >= 2) {
      creationPolylineRef.current = new google.maps.Polyline({
        path: creationRoutePreview.map((c) => ({ lat: c.lat, lng: c.lng })),
        strokeColor: '#3b82f6',
        strokeWeight: 5,
        strokeOpacity: 0.9,
        geodesic: true,
        map,
      });
    }
  }, [creationStartPoint, creationEndPoint, creationRoutePreview, mapReady]);

  // --- Area selection: click listener ---
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    if (areaClickListenerRef.current) {
      areaClickListenerRef.current.remove();
      areaClickListenerRef.current = null;
    }

    if (areaSelectionMode !== 'none' && onAreaClick) {
      mapRef.current.setOptions({ draggableCursor: 'crosshair' });
      areaClickListenerRef.current = mapRef.current.addListener('click', (e: google.maps.MapMouseEvent) => {
        if (e.latLng) onAreaClick({ lat: e.latLng.lat(), lng: e.latLng.lng() });
      });
    } else if (!creationMode) {
      mapRef.current.setOptions({ draggableCursor: undefined });
    }

    return () => {
      if (areaClickListenerRef.current) { areaClickListenerRef.current.remove(); areaClickListenerRef.current = null; }
    };
  }, [areaSelectionMode, onAreaClick, mapReady, creationMode]);

  // --- Area selection: draw overlay ---
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    if (areaOverlayRef.current) {
      areaOverlayRef.current.setMap(null);
      areaOverlayRef.current = null;
    }
    areaMarkersRef.current.forEach((m) => m.setMap(null));
    areaMarkersRef.current = [];

    if (areaPoints.length === 0) return;

    areaPoints.forEach((pt, i) => {
      const marker = new google.maps.Marker({
        position: { lat: pt.lat, lng: pt.lng },
        map,
        label: { text: `${i + 1}`, color: '#fff', fontSize: '10px', fontWeight: 'bold' },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: '#8b5cf6',
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 2,
        },
        zIndex: 1001,
      });
      areaMarkersRef.current.push(marker);
    });

    if (areaSelectionMode === 'rectangle' && areaPoints.length >= 2) {
      const lats = areaPoints.map((p) => p.lat);
      const lngs = areaPoints.map((p) => p.lng);
      areaOverlayRef.current = new google.maps.Rectangle({
        bounds: {
          north: Math.max(...lats),
          south: Math.min(...lats),
          east: Math.max(...lngs),
          west: Math.min(...lngs),
        },
        map,
        fillColor: '#8b5cf6',
        fillOpacity: 0.15,
        strokeColor: '#8b5cf6',
        strokeWeight: 2,
        strokeOpacity: 0.8,
      });
    } else if (areaSelectionMode === 'polygon' && areaPoints.length >= 3) {
      areaOverlayRef.current = new google.maps.Polygon({
        paths: areaPoints.map((p) => ({ lat: p.lat, lng: p.lng })),
        map,
        fillColor: '#8b5cf6',
        fillOpacity: 0.15,
        strokeColor: '#8b5cf6',
        strokeWeight: 2,
        strokeOpacity: 0.8,
      });
    } else if (areaSelectionMode === 'circle' && areaPoints.length >= 2) {
      const center = areaPoints[0];
      const edge = areaPoints[1];
      const R = 6371000;
      const dLat = (edge.lat - center.lat) * Math.PI / 180;
      const dLng = (edge.lng - center.lng) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(center.lat * Math.PI / 180) * Math.cos(edge.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
      const radiusMeters = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      areaOverlayRef.current = new google.maps.Circle({
        center: { lat: center.lat, lng: center.lng },
        radius: radiusMeters,
        map,
        fillColor: '#8b5cf6',
        fillOpacity: 0.15,
        strokeColor: '#8b5cf6',
        strokeWeight: 2,
        strokeOpacity: 0.8,
      }) as any;
    }
  }, [areaPoints, areaSelectionMode, mapReady]);

  // --- Fit to active segment ---
  useEffect(() => {
    if (!mapReady || !mapRef.current || !fitToActiveSegment || !activeSegmentId) return;
    const seg = segments.find((s) => s.id === activeSegmentId);
    if (!seg || seg.coordinates.length === 0) return;

    const bounds = new google.maps.LatLngBounds();
    seg.coordinates.forEach((c) => bounds.extend(new google.maps.LatLng(c.lat, c.lng)));

    if (!bounds.isEmpty()) {
      smartFit(mapRef.current, bounds, 'activeChanged');
    }
  }, [fitToActiveSegment, activeSegmentId, segments, mapReady, smartFit]);

  // --- Manual center request ---
  useEffect(() => {
    if (!mapReady || !mapRef.current || !activeSegmentId || centerActiveRequest === 0) return;
    const seg = segments.find((s) => s.id === activeSegmentId);
    if (!seg || seg.coordinates.length === 0) return;

    const bounds = new google.maps.LatLngBounds();
    seg.coordinates.forEach((c) => bounds.extend(new google.maps.LatLng(c.lat, c.lng)));

    if (!bounds.isEmpty()) {
      smartFit(mapRef.current, bounds, 'manual');
    }
  }, [centerActiveRequest, mapReady, smartFit]);

  // --- Search: center on a target segment by id (independent del activo) ---
  useEffect(() => {
    if (!mapReady || !mapRef.current || visible === false) return;
    if (!searchTargetSegmentId || searchCenterRequest === 0) return;
    const seg = segments.find((s) => s.id === searchTargetSegmentId);
    if (!seg || !Array.isArray(seg.coordinates) || seg.coordinates.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    let added = 0;
    for (const c of seg.coordinates) {
      if (!isValidLatLng(c)) continue;
      bounds.extend(new google.maps.LatLng(c.lat, c.lng));
      added++;
    }
    if (added < 1 || bounds.isEmpty()) return;
    smartFit(mapRef.current, bounds, 'manual');
  }, [searchCenterRequest, searchTargetSegmentId, segments, mapReady, smartFit, visible]);

  // --- Search: center on a geocoded location + temp marker ---
  useEffect(() => {
    if (!mapReady || !mapRef.current || visible === false) return;
    if (!searchTargetLocation || searchCenterRequest === 0) {
      // Sin objetivo → limpia marcador si existía
      if (searchMarkerRef.current) {
        searchMarkerRef.current.setMap(null);
        searchMarkerRef.current = null;
      }
      return;
    }
    if (!isValidLatLng(searchTargetLocation)) return;
    const map = mapRef.current;
    if (searchTargetBounds) {
      const b = searchTargetBounds;
      const gb = new google.maps.LatLngBounds(
        new google.maps.LatLng(b.south, b.west),
        new google.maps.LatLng(b.north, b.east),
      );
      if (!gb.isEmpty()) smartFit(map, gb, 'manual');
    } else {
      map.panTo(new google.maps.LatLng(searchTargetLocation.lat, searchTargetLocation.lng));
      const z = map.getZoom() ?? 6;
      if (z < 16) map.setZoom(17);
    }
    // (re)crea marcador temporal
    if (searchMarkerRef.current) {
      searchMarkerRef.current.setMap(null);
      searchMarkerRef.current = null;
    }
    searchMarkerRef.current = new google.maps.Marker({
      position: { lat: searchTargetLocation.lat, lng: searchTargetLocation.lng },
      map,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: '#8b5cf6',
        fillOpacity: 0.9,
        strokeColor: '#fff',
        strokeWeight: 2,
      },
      zIndex: 9999,
      title: 'Resultado de búsqueda',
    });
  }, [searchCenterRequest, searchTargetLocation, searchTargetBounds, mapReady, smartFit, visible]);

  // --- Manual map refresh request ---
  // Repintado seguro: el repintado real se garantiza porque `mapRefreshRequest`
  // forma parte de `segmentFingerprint`, lo que provoca que el effect de
  // dibujo se ejecute sí o sí al cambiar el contador. Aquí solo:
  //  1) Disparamos resize del proveedor para recalcular el contenedor.
  //  2) Reseteamos `prevIdSetFingerprintRef` para permitir refit si procede.
  //  3) Recuperamos la vista SOLO si el mapa parece "perdido" tras pintar.
  // NUNCA se usa [0,0] como destino: bounds se calculan desde tramos.
  const prevRefreshRef = useRef(0);
  useEffect(() => {
    if (mapRefreshRequest === 0 || mapRefreshRequest === prevRefreshRef.current) return;
    prevRefreshRef.current = mapRefreshRequest;
    if (!mapReady || !mapRef.current || visible === false) return;

    const map = mapRef.current;
    // 1) Resize del proveedor para que el contenedor recalcule tamaño real.
    try { google.maps.event.trigger(map, 'resize'); } catch { /* noop */ }

    // 2) Permitir reevaluación de fit en el effect de dibujo si fuera necesario.
    prevIdSetFingerprintRef.current = '';
    resetFitState();

    // 3) Recuperación segura SOLO si procede. Comprobamos en el siguiente
    // microtick para dejar al effect de dibujo (disparado por el cambio de
    // segmentFingerprint) ejecutarse antes de medir polilíneas.
    const timer = setTimeout(() => {
      if (!mapRef.current) return;
      let centerLost = false;
      try {
        const c = map.getCenter();
        if (c && Math.abs(c.lat()) < 0.01 && Math.abs(c.lng()) < 0.01) centerLost = true;
      } catch { /* noop */ }
      const noPolylinesButData =
        polylinesRef.current.length === 0 && segments.length > 0;

      if ((centerLost || noPolylinesButData) && segments.length > 0) {
        const bounds = new google.maps.LatLngBounds();
        let added = 0;
        for (const seg of segments) {
          if (!Array.isArray(seg.coordinates)) continue;
          for (const c of seg.coordinates) {
            if (!isValidLatLng(c)) continue;
            bounds.extend(new google.maps.LatLng(c.lat, c.lng));
            added++;
          }
        }
        if (added >= 2 && !bounds.isEmpty()) {
          smartFit(map, bounds, 'manual');
        }
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [mapRefreshRequest, mapReady, visible, segments, smartFit, resetFitState]);

  // Render Leaflet if: permanent fallback (auth error / no key) OR temporary offline switch
  if (fallbackToLeaflet || offlineSwitch) {
    return (
      <MapDisplay
        segments={segments}
        activeSegmentId={activeSegmentId}
        currentPosition={currentPosition}
        optimizedOrder={optimizedOrder}
        className={className}
        onSegmentClick={onSegmentClick}
        fitToActiveSegment={fitToActiveSegment}
        centerActiveRequest={centerActiveRequest}
        arrowSegmentIds={arrowSegmentIds}
        allSegments={allSegments}
        onOfflineStateChange={onOfflineStateChange}
        visible={visible}
        searchTargetSegmentId={searchTargetSegmentId}
        searchTargetLocation={searchTargetLocation}
        searchTargetBounds={searchTargetBounds}
        searchCenterRequest={searchCenterRequest}
        mapRefreshRequest={mapRefreshRequest}
      />
    );
  }

  return <div ref={containerRef} className={`w-full h-full ${className}`} />;
}
