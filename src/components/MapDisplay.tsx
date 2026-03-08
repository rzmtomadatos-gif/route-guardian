import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Segment, LatLng } from '@/types/route';
import { useSmartFitLeaflet } from '@/hooks/useSmartFit';

interface Props {
  segments: Segment[];
  activeSegmentId?: string | null;
  currentPosition?: LatLng | null;
  optimizedOrder?: string[];
  className?: string;
  onSegmentClick?: (segmentId: string) => void;
  fitToActiveSegment?: boolean;
  centerActiveRequest?: number;
}

const STATUS_COLORS: Record<string, string> = {
  pendiente: '#6b7280',
  en_progreso: '#f59e0b',
  completado: '#22c55e',
  posible_repetir: '#f97316',
};

/** Resolve display color with operational priority: status > layer */
function resolveSegmentColor(seg: Segment, activeSegmentId?: string | null): string {
  // 1. Active / in-progress → yellow
  if (seg.id === activeSegmentId || seg.status === 'en_progreso') return '#f59e0b';
  // 2. Completed → green (reserved)
  if (seg.status === 'completado') return '#22c55e';
  // 3. Non-recordable → dark gray
  if (seg.nonRecordable) return '#3f3f46';
  // 4. Needs repeat → orange
  if (seg.needsRepeat || seg.status === 'posible_repetir') return '#f97316';
  // 5. Pending → layer color or default gray
  return seg.color || '#6b7280';
}

export function MapDisplay({
  segments,
  activeSegmentId,
  currentPosition,
  optimizedOrder,
  className = '',
  onSegmentClick,
  fitToActiveSegment = false,
  centerActiveRequest = 0,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const posMarkerRef = useRef<L.CircleMarker | null>(null);
  const { requestFitBounds: smartFit } = useSmartFitLeaflet();

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: false,
    }).setView([40.4168, -3.7038], 6);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
    }).addTo(map);

    layersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update segments
  useEffect(() => {
    if (!mapRef.current || !layersRef.current) return;
    layersRef.current.clearLayers();

    const bounds = L.latLngBounds([]);

    // Draw order connections if optimized
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
          ).addTo(layersRef.current!);
        }
      }
    }

    segments.forEach((seg, idx) => {
      const latLngs = seg.coordinates.map((c) => [c.lat, c.lng] as L.LatLngTuple);
      const isActive = seg.id === activeSegmentId;
      const color = resolveSegmentColor(seg, activeSegmentId);

      const polyline = L.polyline(latLngs, {
        color,
        weight: isActive ? 6 : 3,
        opacity: isActive ? 1 : 0.7,
      }).addTo(layersRef.current!);

      if (onSegmentClick) {
        polyline.on('click', () => onSegmentClick(seg.id));
      }

      polyline.bindTooltip(seg.name, {
        permanent: false,
        className: 'bg-card text-foreground border-border text-xs px-2 py-1 rounded shadow-lg',
      });

      bounds.extend(latLngs);

      // Number marker at start
      const orderIdx = optimizedOrder?.indexOf(seg.id);
      if (orderIdx !== undefined && orderIdx >= 0) {
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
          .addTo(layersRef.current!);
      }
    });

    if (bounds.isValid()) {
      smartFit(mapRef.current, bounds, 'segmentsLoaded');
    }
  }, [segments, activeSegmentId, optimizedOrder, onSegmentClick, smartFit]);

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

  // Update current position
  useEffect(() => {
    if (!mapRef.current || !layersRef.current) return;

    if (posMarkerRef.current) {
      posMarkerRef.current.remove();
      posMarkerRef.current = null;
    }

    if (currentPosition) {
      posMarkerRef.current = L.circleMarker(
        [currentPosition.lat, currentPosition.lng],
        {
          radius: 8,
          fillColor: '#3b82f6',
          fillOpacity: 1,
          color: '#fff',
          weight: 3,
        }
      ).addTo(layersRef.current);
    }
  }, [currentPosition]);

  return <div ref={containerRef} className={`w-full h-full ${className}`} />;
}
