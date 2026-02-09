/// <reference types="google.maps" />
import { useEffect, useRef, useCallback } from 'react';
import type { Segment, LatLng } from '@/types/route';
import { getGoogleMapsApiKey } from '@/utils/google-directions';

interface Props {
  segments: Segment[];
  activeSegmentId?: string | null;
  currentPosition?: LatLng | null;
  optimizedOrder?: string[];
  className?: string;
  onSegmentClick?: (segmentId: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  pendiente: '#6b7280',
  en_progreso: '#f59e0b',
  completado: '#22c55e',
};

let googleMapsPromise: Promise<void> | null = null;

function loadGoogleMaps(apiKey: string): Promise<void> {
  if ((window as any).google?.maps?.Map) return Promise.resolve();
  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise((resolve, reject) => {
    // Remove any existing script
    const existing = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existing) existing.remove();

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=geometry`;
    script.async = true;
    script.onload = () => {
      googleMapsPromise = null;
      resolve();
    };
    script.onerror = () => {
      googleMapsPromise = null;
      reject(new Error('Failed to load Google Maps'));
    };
    document.head.appendChild(script);
  });

  return googleMapsPromise;
}

export function GoogleMapDisplay({
  segments,
  activeSegmentId,
  currentPosition,
  optimizedOrder,
  className = '',
  onSegmentClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const posMarkerRef = useRef<google.maps.Marker | null>(null);
  const connectionLinesRef = useRef<google.maps.Polyline[]>([]);
  const initRef = useRef(false);

  const clearOverlays = useCallback(() => {
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    connectionLinesRef.current.forEach((l) => l.setMap(null));
    connectionLinesRef.current = [];
  }, []);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || initRef.current) return;

    const apiKey = getGoogleMapsApiKey();
    if (!apiKey) return;

    initRef.current = true;

    loadGoogleMaps(apiKey)
      .then(() => {
        if (!containerRef.current) return;

        mapRef.current = new google.maps.Map(containerRef.current, {
          center: { lat: 40.4168, lng: -3.7038 },
          zoom: 6,
          disableDefaultUI: true,
          zoomControl: true,
          styles: [
            { elementType: 'geometry', stylers: [{ color: '#1a1d23' }] },
            { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1d23' }] },
            { elementType: 'labels.text.fill', stylers: [{ color: '#8a8f98' }] },
            { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2c3038' }] },
            { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#8a8f98' }] },
            { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1626' }] },
            { featureType: 'poi', stylers: [{ visibility: 'off' }] },
            { featureType: 'transit', stylers: [{ visibility: 'off' }] },
          ],
        });
      })
      .catch((err) => {
        console.error('Google Maps init error:', err);
        initRef.current = false;
      });

    return () => {
      // cleanup on unmount
      mapRef.current = null;
      initRef.current = false;
    };
  }, []);

  // Update segments
  useEffect(() => {
    if (!mapRef.current) return;
    clearOverlays();

    const bounds = new google.maps.LatLngBounds();

    // Connection lines for optimized order
    if (optimizedOrder && optimizedOrder.length > 1) {
      const segMap = new Map(segments.map((s) => [s.id, s]));
      for (let i = 0; i < optimizedOrder.length - 1; i++) {
        const curr = segMap.get(optimizedOrder[i]);
        const next = segMap.get(optimizedOrder[i + 1]);
        if (curr && next) {
          const endCoord = curr.coordinates[curr.coordinates.length - 1];
          const startCoord = next.coordinates[0];
          const line = new google.maps.Polyline({
            path: [endCoord, startCoord],
            strokeColor: '#ffffff',
            strokeOpacity: 0.12,
            strokeWeight: 1,
            geodesic: true,
            map: mapRef.current,
          });
          connectionLinesRef.current.push(line);
        }
      }
    }

    segments.forEach((seg) => {
      const path = seg.coordinates.map((c) => ({ lat: c.lat, lng: c.lng }));
      const isActive = seg.id === activeSegmentId;
      const color = STATUS_COLORS[seg.status];

      const polyline = new google.maps.Polyline({
        path,
        strokeColor: color,
        strokeWeight: isActive ? 6 : 3,
        strokeOpacity: isActive ? 1 : 0.7,
        map: mapRef.current,
      });

      if (onSegmentClick) {
        polyline.addListener('click', () => onSegmentClick(seg.id));
      }

      polylinesRef.current.push(polyline);

      // Extend bounds
      path.forEach((p) => bounds.extend(p));

      // Number marker
      const orderIdx = optimizedOrder?.indexOf(seg.id);
      if (orderIdx !== undefined && orderIdx >= 0) {
        const startCoord = seg.coordinates[0];
        const marker = new google.maps.Marker({
          position: startCoord,
          map: mapRef.current,
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
        markersRef.current.push(marker);
      }
    });

    if (!bounds.isEmpty()) {
      mapRef.current.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });
    }
  }, [segments, activeSegmentId, optimizedOrder, onSegmentClick, clearOverlays]);

  // Current position marker
  useEffect(() => {
    if (!mapRef.current) return;

    if (posMarkerRef.current) {
      posMarkerRef.current.setMap(null);
      posMarkerRef.current = null;
    }

    if (currentPosition) {
      posMarkerRef.current = new google.maps.Marker({
        position: currentPosition,
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
  }, [currentPosition]);

  const apiKey = getGoogleMapsApiKey();

  if (!apiKey) {
    return (
      <div className={`w-full h-full flex items-center justify-center bg-background ${className}`}>
        <div className="text-center px-6 space-y-2">
          <p className="text-muted-foreground text-sm">
            Configura tu API Key de Google Maps en Ajustes para ver el mapa.
          </p>
        </div>
      </div>
    );
  }

  return <div ref={containerRef} className={`w-full h-full ${className}`} />;
}
