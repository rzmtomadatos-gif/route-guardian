import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Segment, LatLng } from '@/types/route';
import { useSmartFitLeaflet } from '@/hooks/useSmartFit';
import { useConnectivity } from '@/hooks/useConnectivity';
import { resolveSegmentColor, resolveTrimbleSegmentColor } from '@/utils/segment-colors';
import type { TrimbleSegmentStatus } from '@/types/trimble';
import { TRIMBLE_LIVE_STATUS_COLOR, type TrimbleLiveCoverageItem } from '@/utils/trimble/live-coverage';
import { getSegmentArrows, clearArrowCache } from '@/utils/segment-arrows';
import { isValidLatLng } from '@/utils/coord-validation';
import {
  getOfflineTileData,
  listOfflineTileSources,
  getActiveOfflineMapId,
  setActiveOfflineMapId,
  shouldUseOfflineMap,
  getOfflineMapMode,
  OFFLINE_MAP_CHANGED_EVENT,
} from '@/utils/offline-tiles';
import { selectBestSource } from '@/hooks/useMapState';
import { toast } from 'sonner';

// Dynamic import for protomaps-leaflet (only loaded when needed)
let protomapsModule: any = null;
async function getProtomapsLayer(blobUrl: string): Promise<L.Layer | null> {
  try {
    if (!protomapsModule) {
      protomapsModule = await import('protomaps-leaflet');
    }
    return (protomapsModule.leafletLayer as any)({
      url: blobUrl,
      theme: 'dark',
    });
  } catch (e) {
    console.error('Failed to load protomaps-leaflet:', e);
    return null;
  }
}

interface Props {
  segments: Segment[];
  activeSegmentId?: string | null;
  currentPosition?: LatLng | null;
  optimizedOrder?: string[];
  className?: string;
  onSegmentClick?: (segmentId: string) => void;
  fitToActiveSegment?: boolean;
  centerActiveRequest?: number;
  arrowSegmentIds?: string[];
  /** Callback to notify parent about offline map state changes */
  onOfflineStateChange?: (state: { active: boolean; noTiles: boolean }) => void;
  /** All campaign segments for coverage-based offline map selection */
  allSegments?: Segment[];
  /** Whether this map is currently visible (for resize invalidation) */
  visible?: boolean;
  /** Buscador (ver GoogleMapDisplay para semántica). */
  searchTargetSegmentId?: string | null;
  searchTargetLocation?: LatLng | null;
  searchTargetBounds?: { north: number; south: number; east: number; west: number } | null;
  searchCenterRequest?: number;
  /** Solicitud de refresco manual del mapa (ver GoogleMapDisplay). */
  mapRefreshRequest?: number;
  /** Modo Trimble: si se provee, sobreescribe el color del tramo por estado Trimble. */
  trimbleStatusBySegment?: Map<string, TrimbleSegmentStatus> | null;
  trimbleLiveCoverageBySegment?: Map<string, TrimbleLiveCoverageItem> | null;
}

/** Create an arrow SVG icon for Leaflet — 60% of original size */
function arrowIcon(angle: number, color: string): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [9, 9],
    iconAnchor: [4, 4],
    html: `<svg width="9" height="9" viewBox="0 0 12 12" style="transform:rotate(${angle}deg)">
      <path d="M6 1 L10 9 L6 7 L2 9 Z" fill="${color}" opacity="0.55"/>
    </svg>`,
  });
}

/** Build a fingerprint to detect when segments actually change */
function buildFingerprint(
  segments: Segment[],
  activeSegmentId: string | null | undefined,
  optimizedOrder: string[] | undefined,
  arrowSegmentIds: string[] | undefined,
): string {
  const parts: string[] = [
    activeSegmentId || '',
    optimizedOrder?.join(',') || '',
    arrowSegmentIds?.join(',') || '',
  ];
  for (const seg of segments) {
    parts.push(`${seg.id}:${seg.status}:${seg.color || ''}:${seg.coordinates.length}`);
  }
  return parts.join('|');
}

// Track active blob URL to revoke on switch
let activeBlobUrl: string | null = null;

export function MapDisplay({
  segments,
  activeSegmentId,
  currentPosition,
  optimizedOrder,
  className = '',
  onSegmentClick,
  fitToActiveSegment = false,
  centerActiveRequest = 0,
  arrowSegmentIds,
  onOfflineStateChange,
  allSegments,
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
  const mapRef = useRef<L.Map | null>(null);
  const segmentLayerRef = useRef<L.LayerGroup | null>(null);
  const arrowLayerRef = useRef<L.LayerGroup | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const offlineLayerRef = useRef<L.Layer | null>(null);
  const posMarkerRef = useRef<L.CircleMarker | null>(null);
  const searchMarkerRef = useRef<L.Marker | null>(null);
  const currentZoomRef = useRef(6);
  const { requestFitBounds: smartFit } = useSmartFitLeaflet();
  const prevFingerprintRef = useRef('');
  const [offlineMapActive, setOfflineMapActive] = useState(false);
  const [noTilesWarning, setNoTilesWarning] = useState(false);
  const { isOnline, wasOffline, ackRecovery } = useConnectivity();

  // Notify parent of state changes
  useEffect(() => {
    onOfflineStateChange?.({ active: offlineMapActive, noTiles: noTilesWarning });
  }, [offlineMapActive, noTilesWarning, onOfflineStateChange]);

  // IMPORTANT: include `mapRefreshRequest` so the draw effect re-runs
  // deterministically when the user presses "Refresh map". This avoids
  // depending on ref mutations (which don't trigger re-renders) to force
  // a real repaint of polylines and arrows.
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
    () => `${mapRefreshRequest}|${buildFingerprint(segments, activeSegmentId, optimizedOrder, arrowSegmentIds)}|T:${trimbleStatusFingerprint}|L:${trimbleLiveFingerprint}`,
    [mapRefreshRequest, segments, activeSegmentId, optimizedOrder, arrowSegmentIds, trimbleStatusFingerprint, trimbleLiveFingerprint],
  );

  // Tracks only the SET of segment IDs (not status/colors). Used to decide
  // whether to refit the map: only when the set actually changes (load,
  // delete, replace) and never on pure additions (manual segment).
  const idSetFingerprint = useMemo(
    () => segments.map((s) => s.id).sort().join(','),
    [segments],
  );
  const prevIdSetFingerprintRef = useRef('');

  const orderNumberIds = useMemo(() => {
    const ids = new Set<string>();
    if (activeSegmentId) ids.add(activeSegmentId);
    if (arrowSegmentIds) arrowSegmentIds.forEach((id) => ids.add(id));
    return ids;
  }, [activeSegmentId, arrowSegmentIds]);

  /**
   * Apply or remove offline map layer.
   */
  const syncOfflineMap = useCallback(async (map: L.Map, forceOffline?: boolean) => {
    const currentOnline = navigator.onLine;
    let targetMapId = getActiveOfflineMapId();
    const wantOffline = forceOffline ?? shouldUseOfflineMap(currentOnline);

    // Get campaign context for coverage-based selection
    const campaignSegs = allSegments ?? segments;
    const activeSeg = activeSegmentId ? campaignSegs.find(s => s.id === activeSegmentId) : undefined;
    const center = map.getCenter();
    const fallbackPos = { lat: center.lat, lng: center.lng };

    // If going offline with no active map, auto-select best source by campaign coverage
    if (wantOffline && !targetMapId) {
      const sources = await listOfflineTileSources();
      if (sources.length > 0) {
        const best = selectBestSource(sources, campaignSegs, activeSeg, fallbackPos);
        if (best) {
          targetMapId = best.source.id;
          setActiveOfflineMapId(targetMapId);
          toast.info(`Mapa offline "${best.source.name}" seleccionado por cobertura de campaña`);
        }
      }
    }

    // Validate coverage of active map against campaign context
    if (wantOffline && targetMapId) {
      const sources = await listOfflineTileSources();
      const activeSource = sources.find((s) => s.id === targetMapId);
      if (activeSource && sources.length > 1) {
        const best = selectBestSource(sources, campaignSegs, activeSeg, fallbackPos);
        if (best && best.source.id !== targetMapId && best.score > 0.5) {
          const currentScore = selectBestSource([activeSource], campaignSegs, activeSeg, fallbackPos);
          if (currentScore && currentScore.score < best.score - 0.2) {
            targetMapId = best.source.id;
            setActiveOfflineMapId(targetMapId);
            toast.info(`Cambiando a mapa "${best.source.name}" — cubre mejor tu campaña`);
          }
        }
      }
      if (activeSource) {
        const score = selectBestSource([activeSource], campaignSegs, activeSeg, fallbackPos);
        if (score && score.score < 0.3) {
          toast.warning('El mapa offline activo no cubre bien esta campaña', { duration: 4000 });
        }
      }
    }

    // --- Deactivate offline layer ---
    if (!targetMapId || !wantOffline) {
      if (offlineLayerRef.current) {
        offlineLayerRef.current.remove();
        offlineLayerRef.current = null;
      }
      if (activeBlobUrl) {
        URL.revokeObjectURL(activeBlobUrl);
        activeBlobUrl = null;
      }
      if (tileLayerRef.current && !map.hasLayer(tileLayerRef.current)) {
        tileLayerRef.current.addTo(map);
      }
      setOfflineMapActive(false);
      setNoTilesWarning(false);
      return;
    }

    // --- PMTiles loading paused ---
    // PMTiles ArrayBuffer loading is disabled by default due to excessive
    // RAM usage on mobile devices. The app now relies on the Service Worker
    // tile cache (CacheFirst) for offline map coverage.
    // PMTiles can be re-enabled in the future via Capacitor native file access.
    console.info('[MapDisplay] PMTiles loading skipped — relying on SW tile cache');
    setNoTilesWarning(!currentOnline && !offlineLayerRef.current);
  }, [segments, activeSegmentId, allSegments]);

  // Stable ref for syncOfflineMap — avoids re-triggering init/event effects
  const syncOfflineMapRef = useRef(syncOfflineMap);
  useEffect(() => { syncOfflineMapRef.current = syncOfflineMap; }, [syncOfflineMap]);

  // ─── Auto-switch on connectivity changes ───
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    if (!isOnline) {
      if (!offlineMapActive) {
        syncOfflineMapRef.current(map, true).then(() => {
          if (offlineLayerRef.current) {
            toast.info('Sin conexión — mapa offline activado', { duration: 3000 });
          } else {
            toast.warning('Sin conexión — no hay mapa offline disponible', { duration: 4000 });
          }
        });
      }
    } else if (wasOffline) {
      const mode = getOfflineMapMode();
      if (mode !== 'offline') {
        syncOfflineMapRef.current(map, false);
        toast.success('Conexión restaurada — mapa online', { duration: 2000 });
      }
      setNoTilesWarning(false);
      ackRecovery();
    }
  }, [isOnline, wasOffline]);

  // Initialize map — stable effect, no syncOfflineMap in deps
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: false,
    }).setView([40.4168, -3.7038], 6);

    const savedTheme = (() => {
      try { return localStorage.getItem('vialroute_map_theme') || 'light'; } catch { return 'light'; }
    })();
    const tileUrl = savedTheme === 'dark'
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
    const tileLayer = L.tileLayer(tileUrl, {
      maxZoom: 19,
      errorTileUrl: '',
    }).addTo(map);
    tileLayerRef.current = tileLayer;

    let tileErrors = 0;
    tileLayer.on('tileerror', () => {
      tileErrors++;
      if (tileErrors >= 3 && !offlineLayerRef.current) {
        setNoTilesWarning(true);
        const activeMapId = getActiveOfflineMapId();
        if (activeMapId) {
          syncOfflineMapRef.current(map, true);
        }
      }
    });

    segmentLayerRef.current = L.layerGroup().addTo(map);
    arrowLayerRef.current = L.layerGroup().addTo(map);
    currentZoomRef.current = map.getZoom();

    map.on('zoomend', () => {
      const zoom = map.getZoom();
      const prevZoom = currentZoomRef.current;
      currentZoomRef.current = zoom;
      if (zoom < 15 && prevZoom >= 15) {
        arrowLayerRef.current?.remove();
      } else if (zoom >= 15 && prevZoom < 15) {
        arrowLayerRef.current?.addTo(map);
      }
    });

    mapRef.current = map;
    syncOfflineMapRef.current(map);

    return () => {
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      offlineLayerRef.current = null;
      if (activeBlobUrl) {
        URL.revokeObjectURL(activeBlobUrl);
        activeBlobUrl = null;
      }
    };
  }, []);

  // Listen for offline map changes — use ref to avoid re-subscribing
  useEffect(() => {
    const handler = () => {
      if (mapRef.current) syncOfflineMapRef.current(mapRef.current);
    };
    window.addEventListener(OFFLINE_MAP_CHANGED_EVENT, handler);
    return () => window.removeEventListener(OFFLINE_MAP_CHANGED_EVENT, handler);
  }, []);

  // Listen for map theme changes
  useEffect(() => {
    const handler = () => {
      if (!mapRef.current || !tileLayerRef.current) return;
      const theme = (() => {
        try { return localStorage.getItem('vialroute_map_theme') || 'light'; } catch { return 'light'; }
      })();
      const tileUrl = theme === 'dark'
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
      tileLayerRef.current.setUrl(tileUrl);
    };
    window.addEventListener('vialroute:map-theme-changed', handler);
    return () => window.removeEventListener('vialroute:map-theme-changed', handler);
  }, []);

  // Resize when becoming visible (tab switch persistence).
  // When the parent toggles display:none -> visible, Leaflet container goes
  // from 0×0 to real size and we must invalidateSize AND force a repaint.
  const prevVisibleRef = useRef(visible);
  useEffect(() => {
    if (visible && !prevVisibleRef.current && mapRef.current) {
      setTimeout(() => mapRef.current?.invalidateSize(), 100);
      // Force the segment-draw effect to re-run on the now-visible map.
      prevFingerprintRef.current = '__force_repaint__';
      prevIdSetFingerprintRef.current = '';
    }
    prevVisibleRef.current = visible;
  }, [visible]);

  // Draw static segments
  useEffect(() => {
    if (!mapRef.current || !segmentLayerRef.current || !arrowLayerRef.current) return;
    if (visible === false) return; // map is hidden — defer paint
    if (segmentFingerprint === prevFingerprintRef.current) return;

    segmentLayerRef.current.clearLayers();
    arrowLayerRef.current.clearLayers();
    clearArrowCache();

    // Decide if we need to auto-fit (same policy as GoogleMapDisplay):
    // first paint or set change with deletions; pure additions don't refit.
    const isFirstPaint = prevIdSetFingerprintRef.current === '';
    let shouldFit = false;
    if (isFirstPaint) {
      shouldFit = idSetFingerprint !== '';
    } else if (idSetFingerprint !== prevIdSetFingerprintRef.current) {
      const prevIds = new Set(prevIdSetFingerprintRef.current.split(','));
      const currIds = idSetFingerprint.split(',');
      const onlyAdded = Array.from(prevIds).every((id) => currIds.includes(id));
      shouldFit = !onlyAdded;
    }

    const bounds = L.latLngBounds([]);
    let hasValidBounds = false;

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
          L.polyline(
            [[endCoord.lat, endCoord.lng], [startCoord.lat, startCoord.lng]],
            { color: '#ffffff20', weight: 1, dashArray: '4 8' }
          ).addTo(segmentLayerRef.current!);
        } catch (e) {
          console.warn('[MapDisplay] connection line skipped:', e);
        }
      }
    }

    const arrowSet = arrowSegmentIds ? new Set(arrowSegmentIds) : null;

    segments.forEach((seg) => {
      try {
        const validCoords = (seg.coordinates || []).filter(isValidLatLng);
        if (validCoords.length < 2) return;

        const latLngs = validCoords.map((c) => [c.lat, c.lng] as L.LatLngTuple);
        const isActive = seg.id === activeSegmentId;
        const trimbleStatus = trimbleStatusBySegment?.get(seg.id);
        const color = trimbleStatus
          ? resolveTrimbleSegmentColor(trimbleStatus)
          : resolveSegmentColor(seg, activeSegmentId);

        const polyline = L.polyline(latLngs, {
          color,
          weight: isActive ? 6 : 3,
          opacity: isActive ? 1 : 0.7,
        }).addTo(segmentLayerRef.current!);

        if (onSegmentClick) {
          polyline.on('click', () => onSegmentClick(seg.id));
        }

        polyline.bindTooltip(seg.name, {
          permanent: false,
          className: 'bg-card text-foreground border-border text-xs px-2 py-1 rounded shadow-lg',
        });

        bounds.extend(latLngs);
        hasValidBounds = true;

        if (!arrowSet || arrowSet.has(seg.id)) {
          const arrows = getSegmentArrows(seg.id, validCoords);
          arrows.forEach(({ pos, angle }) => {
            L.marker([pos.lat, pos.lng], { icon: arrowIcon(angle, color), interactive: false })
              .addTo(arrowLayerRef.current!);
          });
        }

        if (optimizedOrder && orderNumberIds.has(seg.id)) {
          const orderIdx = optimizedOrder.indexOf(seg.id);
          if (orderIdx >= 0) {
            const startCoord = validCoords[0];
            L.circleMarker([startCoord.lat, startCoord.lng], {
              radius: 10,
              fillColor: color,
              fillOpacity: 1,
              color: '#000',
              weight: 1,
            })
              .bindTooltip(`${orderIdx + 1}`, {
                permanent: true,
                direction: 'center',
                className: 'bg-transparent border-0 shadow-none text-[10px] font-bold text-primary-foreground',
              })
              .addTo(segmentLayerRef.current!);
          }
        }
      } catch (e) {
        console.warn('[MapDisplay] segment skipped due to draw error:', seg.id, e);
      }
    });

    if (currentZoomRef.current < 15 && mapRef.current && arrowLayerRef.current) {
      arrowLayerRef.current.remove();
    }

    if (shouldFit && hasValidBounds && bounds.isValid()) {
      smartFit(mapRef.current, bounds, 'segmentsLoaded');
    }

    // Defensive warning: non-empty segment list but nothing painted means
    // upstream filtering is leaving the map blank.
    if (segments.length > 0 && segmentLayerRef.current && segmentLayerRef.current.getLayers().length === 0) {
      console.warn(
        '[MapDisplay] received',
        segments.length,
        'segments but painted 0 polylines — check coordinates / visibility filters',
      );
    }

    // Mark fingerprints painted ONLY after a complete repaint succeeded.
    prevFingerprintRef.current = segmentFingerprint;
    prevIdSetFingerprintRef.current = idSetFingerprint;
  }, [segmentFingerprint, idSetFingerprint, visible, onSegmentClick, smartFit, orderNumberIds, optimizedOrder, segments, activeSegmentId, arrowSegmentIds]);


  // Fit to active segment
  useEffect(() => {
    if (!mapRef.current || !fitToActiveSegment || !activeSegmentId) return;
    const seg = segments.find((s) => s.id === activeSegmentId);
    if (!seg || seg.coordinates.length === 0) return;
    const bounds = L.latLngBounds(seg.coordinates.map((c) => [c.lat, c.lng] as L.LatLngTuple));
    if (bounds.isValid()) {
      smartFit(mapRef.current, bounds, 'activeChanged');
    }
  }, [fitToActiveSegment, activeSegmentId, segments, smartFit]);

  // Manual center
  useEffect(() => {
    if (!mapRef.current || !activeSegmentId || centerActiveRequest === 0) return;
    const seg = segments.find((s) => s.id === activeSegmentId);
    if (!seg || seg.coordinates.length === 0) return;
    const bounds = L.latLngBounds(seg.coordinates.map((c) => [c.lat, c.lng] as L.LatLngTuple));
    if (bounds.isValid()) {
      smartFit(mapRef.current, bounds, 'manual');
    }
  }, [centerActiveRequest, smartFit]);

  // GPS position marker
  useEffect(() => {
    if (!mapRef.current || !segmentLayerRef.current) return;
    if (posMarkerRef.current) {
      if (currentPosition) {
        posMarkerRef.current.setLatLng([currentPosition.lat, currentPosition.lng]);
        return;
      } else {
        posMarkerRef.current.remove();
        posMarkerRef.current = null;
        return;
      }
    }
    if (currentPosition) {
      posMarkerRef.current = L.circleMarker(
        [currentPosition.lat, currentPosition.lng],
        { radius: 8, fillColor: '#3b82f6', fillOpacity: 1, color: '#fff', weight: 3 }
      ).addTo(segmentLayerRef.current);
    }
  }, [currentPosition]);

  // --- Search: center on a target segment ---
  useEffect(() => {
    if (!mapRef.current || visible === false) return;
    if (!searchTargetSegmentId || searchCenterRequest === 0) return;
    const seg = segments.find((s) => s.id === searchTargetSegmentId);
    if (!seg || !Array.isArray(seg.coordinates) || seg.coordinates.length === 0) return;
    const valid = seg.coordinates.filter(isValidLatLng);
    if (valid.length === 0) return;
    const bounds = L.latLngBounds(valid.map((c) => [c.lat, c.lng] as L.LatLngTuple));
    if (bounds.isValid()) smartFit(mapRef.current, bounds, 'manual');
  }, [searchCenterRequest, searchTargetSegmentId, segments, smartFit, visible]);

  // --- Search: center on geocoded location + temp marker ---
  useEffect(() => {
    if (!mapRef.current || visible === false) return;
    if (!searchTargetLocation || searchCenterRequest === 0) {
      if (searchMarkerRef.current) {
        searchMarkerRef.current.remove();
        searchMarkerRef.current = null;
      }
      return;
    }
    if (!isValidLatLng(searchTargetLocation)) return;
    const map = mapRef.current;
    if (searchTargetBounds) {
      const b = L.latLngBounds(
        [searchTargetBounds.south, searchTargetBounds.west],
        [searchTargetBounds.north, searchTargetBounds.east],
      );
      if (b.isValid()) smartFit(map, b, 'manual');
    } else {
      map.setView(
        [searchTargetLocation.lat, searchTargetLocation.lng],
        Math.max(map.getZoom() ?? 6, 17),
      );
    }
    if (searchMarkerRef.current) {
      searchMarkerRef.current.remove();
      searchMarkerRef.current = null;
    }
    const icon = L.divIcon({
      className: '',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
      html: `<div style="width:18px;height:18px;border-radius:50%;background:#8b5cf6;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,0.5);"></div>`,
    });
    searchMarkerRef.current = L.marker(
      [searchTargetLocation.lat, searchTargetLocation.lng],
      { icon, title: 'Resultado de búsqueda' },
    ).addTo(map);
  }, [searchCenterRequest, searchTargetLocation, searchTargetBounds, smartFit, visible]);

  // --- Manual map refresh request ---
  // Repintado seguro Leaflet: el repintado real está garantizado porque
  // `mapRefreshRequest` forma parte de `segmentFingerprint`. Aquí solo:
  //  1) invalidateSize para recalcular el contenedor.
  //  2) reseteamos `prevIdSetFingerprintRef` para permitir refit si procede.
  //  3) recuperamos vista solo si el mapa parece "perdido" tras pintar.
  // Nunca usa [0,0] como destino.
  const prevRefreshRef = useRef(0);
  useEffect(() => {
    if (mapRefreshRequest === 0 || mapRefreshRequest === prevRefreshRef.current) return;
    prevRefreshRef.current = mapRefreshRequest;
    const map = mapRef.current;
    if (!map || visible === false) return;

    // 1) Recalcula tamaño real del contenedor.
    try { map.invalidateSize(); } catch { /* noop */ }

    // 2) Permitir reevaluación de fit en el effect de dibujo si fuera necesario.
    prevIdSetFingerprintRef.current = '';

    // 3) Recuperación segura SOLO si procede, tras dejar al effect de dibujo
    // ejecutarse (disparado por el cambio en segmentFingerprint).
    const timer = setTimeout(() => {
      if (!mapRef.current) return;
      let centerLost = false;
      try {
        const c = map.getCenter();
        if (Math.abs(c.lat) < 0.01 && Math.abs(c.lng) < 0.01) centerLost = true;
      } catch { /* noop */ }
      const drawnCount = segmentLayerRef.current?.getLayers().length ?? 0;
      const noPolylinesButData = drawnCount === 0 && segments.length > 0;

      if ((centerLost || noPolylinesButData) && segments.length > 0) {
        const bounds = L.latLngBounds([]);
        let added = 0;
        for (const seg of segments) {
          if (!Array.isArray(seg.coordinates)) continue;
          for (const c of seg.coordinates) {
            if (!isValidLatLng(c)) continue;
            bounds.extend([c.lat, c.lng]);
            added++;
          }
        }
        if (added >= 2 && bounds.isValid()) {
          smartFit(map, bounds, 'manual');
        }
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [mapRefreshRequest, visible, segments, smartFit]);

  return (
    <div ref={containerRef} className={`w-full h-full ${className}`} />
  );
}
