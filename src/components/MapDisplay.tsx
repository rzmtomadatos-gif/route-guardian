import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Segment, LatLng } from '@/types/route';
import { useSmartFitLeaflet } from '@/hooks/useSmartFit';
import { useConnectivity } from '@/hooks/useConnectivity';
import { resolveSegmentColor } from '@/utils/segment-colors';
import { getSegmentArrows, clearArrowCache } from '@/utils/segment-arrows';
import {
  getOfflineTileData,
  listOfflineTileSources,
  getActiveOfflineMapId,
  shouldUseOfflineMap,
  OFFLINE_MAP_CHANGED_EVENT,
} from '@/utils/offline-tiles';
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
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const segmentLayerRef = useRef<L.LayerGroup | null>(null);
  const arrowLayerRef = useRef<L.LayerGroup | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const offlineLayerRef = useRef<L.Layer | null>(null);
  const posMarkerRef = useRef<L.CircleMarker | null>(null);
  const currentZoomRef = useRef(6);
  const { requestFitBounds: smartFit } = useSmartFitLeaflet();
  const prevFingerprintRef = useRef('');
  const [offlineMapActive, setOfflineMapActive] = useState(false);
  const [noTilesWarning, setNoTilesWarning] = useState(false);
  const { isOnline, wasOffline, ackRecovery } = useConnectivity();

  const segmentFingerprint = useMemo(
    () => buildFingerprint(segments, activeSegmentId, optimizedOrder, arrowSegmentIds),
    [segments, activeSegmentId, optimizedOrder, arrowSegmentIds],
  );

  const orderNumberIds = useMemo(() => {
    const ids = new Set<string>();
    if (activeSegmentId) ids.add(activeSegmentId);
    if (arrowSegmentIds) arrowSegmentIds.forEach((id) => ids.add(id));
    return ids;
  }, [activeSegmentId, arrowSegmentIds]);

  /**
   * Apply or remove offline map layer.
   * @param forceOffline true = switch to offline, false = switch to online, undefined = auto-detect
   */
  const syncOfflineMap = useCallback(async (map: L.Map, forceOffline?: boolean) => {
    const currentOnline = navigator.onLine; // always read fresh, avoid stale closure
    let targetMapId = getActiveOfflineMapId();
    const wantOffline = forceOffline ?? shouldUseOfflineMap(currentOnline);

    // If going offline with no active map, auto-select first available source
    if (wantOffline && !targetMapId) {
      const sources = await listOfflineTileSources();
      if (sources.length > 0) {
        targetMapId = sources[0].id;
        // Persist selection so it sticks across reopens
        (await import('@/utils/offline-tiles')).setActiveOfflineMapId(targetMapId);
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
      // Restore online tiles
      if (tileLayerRef.current && !map.hasLayer(tileLayerRef.current)) {
        tileLayerRef.current.addTo(map);
      }
      setOfflineMapActive(false);
      setNoTilesWarning(false);
      return;
    }

    // --- Activate offline layer ---
    const sources = await listOfflineTileSources();
    const source = sources.find((s) => s.id === targetMapId);
    if (!source) {
      setNoTilesWarning(!currentOnline);
      return;
    }

    const data = await getOfflineTileData(targetMapId);
    if (!data) return;

    // Clean up previous offline layer
    if (offlineLayerRef.current) {
      offlineLayerRef.current.remove();
      offlineLayerRef.current = null;
    }
    if (activeBlobUrl) {
      URL.revokeObjectURL(activeBlobUrl);
    }

    const blob = new Blob([data], { type: 'application/octet-stream' });
    activeBlobUrl = URL.createObjectURL(blob);

    const layer = await getProtomapsLayer(activeBlobUrl);
    if (layer) {
      // Remove online tiles
      if (tileLayerRef.current && map.hasLayer(tileLayerRef.current)) {
        tileLayerRef.current.remove();
      }
      layer.addTo(map);
      offlineLayerRef.current = layer;
      setOfflineMapActive(true);
      setNoTilesWarning(false);
    }
  }, []);

  // ─── Auto-switch on connectivity changes ───
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    if (!isOnline) {
      // Went offline → try to switch to offline map
      if (!offlineMapActive) {
        syncOfflineMap(map, true).then(() => {
          // Check if switch succeeded (offlineLayerRef will be set)
          if (offlineLayerRef.current) {
            toast.info('Sin conexión — mapa offline activado automáticamente');
          } else {
            toast.warning('Sin conexión — no hay mapa offline disponible. Importa uno en Configuración.');
          }
        });
      }
    } else if (wasOffline) {
      // Came back online → restore online tiles
      const { getOfflineMapMode } = require('@/utils/offline-tiles');
      const mode = getOfflineMapMode();
      if (mode !== 'offline') {
        // Only restore online if user didn't force offline mode
        syncOfflineMap(map, false);
        toast.success('Conexión restaurada — mapa online activo');
      }
      setNoTilesWarning(false);
      ackRecovery();
    }
  }, [isOnline, wasOffline]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: false,
    }).setView([40.4168, -3.7038], 6);

    const tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      errorTileUrl: '',
    }).addTo(map);
    tileLayerRef.current = tileLayer;

    // Detect tile load failures (offline without PMTiles)
    let tileErrors = 0;
    tileLayer.on('tileerror', () => {
      tileErrors++;
      if (tileErrors >= 3 && !offlineLayerRef.current) {
        setNoTilesWarning(true);
        // Auto-try offline map if available
        const activeMapId = getActiveOfflineMapId();
        if (activeMapId) {
          syncOfflineMap(map, true);
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

    // Check for offline map on init
    syncOfflineMap(map);

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
  }, [syncOfflineMap]);

  // Listen for offline map changes (same-tab custom event from OfflineMapsManager)
  useEffect(() => {
    const handler = () => {
      if (mapRef.current) syncOfflineMap(mapRef.current);
    };
    window.addEventListener(OFFLINE_MAP_CHANGED_EVENT, handler);
    return () => window.removeEventListener(OFFLINE_MAP_CHANGED_EVENT, handler);
  }, [syncOfflineMap]);

  // Draw static segments (only when fingerprint changes)
  useEffect(() => {
    if (!mapRef.current || !segmentLayerRef.current || !arrowLayerRef.current) return;
    if (segmentFingerprint === prevFingerprintRef.current) return;
    prevFingerprintRef.current = segmentFingerprint;

    segmentLayerRef.current.clearLayers();
    arrowLayerRef.current.clearLayers();
    clearArrowCache();

    const bounds = L.latLngBounds([]);

    if (optimizedOrder && optimizedOrder.length > 1) {
      const segMap = new Map(segments.map((s) => [s.id, s]));
      for (let i = 0; i < optimizedOrder.length - 1; i++) {
        const curr = segMap.get(optimizedOrder[i]);
        const next = segMap.get(optimizedOrder[i + 1]);
        if (curr && next) {
          const endCoord = curr.coordinates[curr.coordinates.length - 1];
          const startCoord = next.coordinates[0];
          L.polyline(
            [[endCoord.lat, endCoord.lng], [startCoord.lat, startCoord.lng]],
            { color: '#ffffff20', weight: 1, dashArray: '4 8' }
          ).addTo(segmentLayerRef.current!);
        }
      }
    }

    const arrowSet = arrowSegmentIds ? new Set(arrowSegmentIds) : null;

    segments.forEach((seg) => {
      const latLngs = seg.coordinates.map((c) => [c.lat, c.lng] as L.LatLngTuple);
      const isActive = seg.id === activeSegmentId;
      const color = resolveSegmentColor(seg, activeSegmentId);

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

      if (!arrowSet || arrowSet.has(seg.id)) {
        const arrows = getSegmentArrows(seg.id, seg.coordinates);
        arrows.forEach(({ pos, angle }) => {
          L.marker([pos.lat, pos.lng], { icon: arrowIcon(angle, color), interactive: false })
            .addTo(arrowLayerRef.current!);
        });
      }

      if (optimizedOrder && orderNumberIds.has(seg.id)) {
        const orderIdx = optimizedOrder.indexOf(seg.id);
        if (orderIdx >= 0) {
          const startCoord = seg.coordinates[0];
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
    });

    if (currentZoomRef.current < 15 && mapRef.current && arrowLayerRef.current) {
      arrowLayerRef.current.remove();
    }

    if (bounds.isValid()) {
      smartFit(mapRef.current, bounds, 'segmentsLoaded');
    }
  }, [segmentFingerprint, onSegmentClick, smartFit, orderNumberIds, optimizedOrder, segments, activeSegmentId, arrowSegmentIds]);

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

  return (
    <div ref={containerRef} className={`w-full h-full ${className}`} style={{ position: 'relative' }}>
      {/* Offline map active badge */}
      {offlineMapActive && (
        <div
          style={{
            position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
            zIndex: 1000, background: 'rgba(0,80,40,0.85)', color: '#4ade80',
            padding: '3px 10px', borderRadius: 6, fontSize: 10, pointerEvents: 'none',
          }}
        >
          🗺 Mapa offline activo
        </div>
      )}

      {/* No tiles warning */}
      {noTilesWarning && !offlineMapActive && (
        <div
          style={{
            position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
            zIndex: 1000, background: 'rgba(120,80,0,0.9)', color: '#fbbf24',
            padding: '4px 12px', borderRadius: 6, fontSize: 11, pointerEvents: 'none',
            maxWidth: '90%', textAlign: 'center',
          }}
        >
          ⚠ Sin conexión — importa un mapa .pmtiles en Configuración para ver cartografía offline
        </div>
      )}
    </div>
  );
}
