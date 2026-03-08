import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Segment, LatLng } from '@/types/route';
import { useSmartFitLeaflet } from '@/hooks/useSmartFit';
import { resolveSegmentColor } from '@/utils/segment-colors';
import { getSegmentArrows, clearArrowCache } from '@/utils/segment-arrows';

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

const ARROW_INTERVAL_M = 50;

function haversine(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function bearing(a: LatLng, b: LatLng): number {
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function sampleArrowPositions(coords: LatLng[], interval: number): Array<{ pos: LatLng; angle: number }> {
  const arrows: Array<{ pos: LatLng; angle: number }> = [];
  if (coords.length < 2) return arrows;
  let accumulated = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = haversine(coords[i - 1], coords[i]);
    accumulated += d;
    if (accumulated >= interval) {
      accumulated = 0;
      arrows.push({ pos: coords[i], angle: bearing(coords[i - 1], coords[i]) });
    }
  }
  return arrows;
}

/** Create an arrow SVG icon for Leaflet */
function arrowIcon(angle: number, color: string): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    html: `<svg width="12" height="12" viewBox="0 0 12 12" style="transform:rotate(${angle}deg)">
      <path d="M6 1 L10 9 L6 7 L2 9 Z" fill="${color}" opacity="0.7"/>
    </svg>`,
  });
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

    segments.forEach((seg) => {
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

      // Direction arrows
      const arrows = sampleArrowPositions(seg.coordinates, ARROW_INTERVAL_M);
      arrows.forEach(({ pos, angle }) => {
        L.marker([pos.lat, pos.lng], { icon: arrowIcon(angle, color), interactive: false })
          .addTo(layersRef.current!);
      });

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
