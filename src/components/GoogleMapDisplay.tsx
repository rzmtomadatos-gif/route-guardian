/// <reference types="google.maps" />
import { useEffect, useRef, useCallback, useState } from 'react';
import type { Segment, LatLng } from '@/types/route';
import { getGoogleMapsApiKey } from '@/utils/google-directions';
import { MapDisplay } from './MapDisplay';

export type AreaSelectionMode = 'none' | 'rectangle' | 'polygon' | 'circle';

interface Props {
  segments: Segment[];
  activeSegmentId?: string | null;
  currentPosition?: LatLng | null;
  optimizedOrder?: string[];
  className?: string;
  onSegmentClick?: (segmentId: string) => void;
  /** Set of selected segment IDs to highlight */
  selectedSegmentIds?: Set<string>;
  /** Map of segment ID to layer color */
  layerColorMap?: Map<string, string>;
  /** Creation mode: when true, clicks on map trigger onMapClick */
  creationMode?: boolean;
  onMapClick?: (latlng: LatLng) => void;
  /** Preview markers/route for creation mode */
  creationStartPoint?: LatLng | null;
  creationEndPoint?: LatLng | null;
  creationRoutePreview?: LatLng[] | null;
  /** Area selection mode */
  areaSelectionMode?: AreaSelectionMode;
  areaPoints?: LatLng[];
  onAreaClick?: (latlng: LatLng) => void;
  /** When true, zoom/fit map to the active segment */
  fitToActiveSegment?: boolean;
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
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const posMarkerRef = useRef<google.maps.Marker | null>(null);
  const connectionLinesRef = useRef<google.maps.Polyline[]>([]);
  const creationMarkersRef = useRef<google.maps.Marker[]>([]);
  const creationPolylineRef = useRef<google.maps.Polyline | null>(null);
  const areaOverlayRef = useRef<google.maps.Polygon | google.maps.Rectangle | null>(null);
  const areaMarkersRef = useRef<google.maps.Marker[]>([]);
  const areaClickListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const clickListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [fallbackToLeaflet, setFallbackToLeaflet] = useState(false);

  const clearOverlays = useCallback(() => {
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    connectionLinesRef.current.forEach((l) => l.setMap(null));
    connectionLinesRef.current = [];
  }, []);

  // Listen for Google Maps auth errors
  useEffect(() => {
    const handler = () => {
      console.warn('Google Maps auth error detected, falling back to Leaflet');
      setFallbackToLeaflet(true);
    };

    // Google Maps dispatches gm_authFailure on window
    (window as any).gm_authFailure = handler;

    return () => {
      delete (window as any).gm_authFailure;
    };
  }, []);

  // Initialize map
  useEffect(() => {
    if (fallbackToLeaflet) return;
    if (!containerRef.current || mapRef.current) return;

    const apiKey = getGoogleMapsApiKey();
    if (!apiKey) {
      setFallbackToLeaflet(true);
      return;
    }

    let cancelled = false;

    loadGoogleMaps(apiKey)
      .then(() => {
        if (cancelled || !containerRef.current) return;

        const map = new google.maps.Map(containerRef.current, {
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

        // Check for auth failure after a short delay
        setTimeout(() => {
          if (cancelled) return;
          const errorDiv = containerRef.current?.querySelector('.gm-err-container');
          if (errorDiv) {
            console.warn('Google Maps error container detected, falling back to Leaflet');
            setFallbackToLeaflet(true);
            return;
          }
          mapRef.current = map;
          setMapReady(true);
        }, 1500);
      })
      .catch(() => {
        if (!cancelled) setFallbackToLeaflet(true);
      });

    return () => {
      cancelled = true;
      mapRef.current = null;
      setMapReady(false);
    };
  }, [fallbackToLeaflet]);

  // Update segments
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    // Verify the map is a real Google Maps instance
    try {
      if (typeof map.getCenter !== 'function') return;
    } catch { return; }
    clearOverlays();

    const bounds = new google.maps.LatLngBounds();
    if (optimizedOrder && optimizedOrder.length > 1) {
      const segMap = new Map(segments.map((s) => [s.id, s]));
      for (let i = 0; i < optimizedOrder.length - 1; i++) {
        const curr = segMap.get(optimizedOrder[i]);
        const next = segMap.get(optimizedOrder[i + 1]);
        if (curr && next) {
          const endCoord = curr.coordinates[curr.coordinates.length - 1];
          const startCoord = next.coordinates[0];
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
        }
      }
    }

    segments.forEach((seg) => {
      const path = seg.coordinates.map((c) => ({ lat: c.lat, lng: c.lng }));
      const isActive = seg.id === activeSegmentId;
      const isSelected = selectedSegmentIds?.has(seg.id);
      const color = isSelected ? '#8b5cf6' : (seg.color || layerColorMap?.get(seg.id) || STATUS_COLORS[seg.status]);

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
      path.forEach((p) => bounds.extend(new google.maps.LatLng(p.lat, p.lng)));

      const orderIdx = optimizedOrder?.indexOf(seg.id);
      if (orderIdx !== undefined && orderIdx >= 0) {
        const startCoord = seg.coordinates[0];
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
        markersRef.current.push(marker);
      }
    });

    if (!bounds.isEmpty()) {
      try {
        map.fitBounds(bounds, 40);
      } catch (e) {
        console.warn('fitBounds failed:', e);
      }
    }
  }, [segments, activeSegmentId, optimizedOrder, onSegmentClick, selectedSegmentIds, layerColorMap, clearOverlays, mapReady]);

  // Current position marker
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;

    if (posMarkerRef.current) {
      posMarkerRef.current.setMap(null);
      posMarkerRef.current = null;
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

  // Creation mode: map click listener
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    // Remove old listener
    if (clickListenerRef.current) {
      clickListenerRef.current.remove();
      clickListenerRef.current = null;
    }

    if (creationMode && onMapClick) {
      mapRef.current.setOptions({ draggableCursor: 'crosshair' });
      clickListenerRef.current = mapRef.current.addListener('click', (e: google.maps.MapMouseEvent) => {
        if (e.latLng) {
          onMapClick({ lat: e.latLng.lat(), lng: e.latLng.lng() });
        }
      });
    } else {
      mapRef.current.setOptions({ draggableCursor: undefined });
    }

    return () => {
      if (clickListenerRef.current) {
        clickListenerRef.current.remove();
        clickListenerRef.current = null;
      }
    };
  }, [creationMode, onMapClick, mapReady]);

  // Creation mode: preview markers and route line
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    // Clear previous creation overlays
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

  // Area selection: click listener
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    if (areaClickListenerRef.current) {
      areaClickListenerRef.current.remove();
      areaClickListenerRef.current = null;
    }

    if (areaSelectionMode !== 'none' && onAreaClick) {
      mapRef.current.setOptions({ draggableCursor: 'crosshair' });
      areaClickListenerRef.current = mapRef.current.addListener('click', (e: google.maps.MapMouseEvent) => {
        if (e.latLng) {
          onAreaClick({ lat: e.latLng.lat(), lng: e.latLng.lng() });
        }
      });
    } else if (!creationMode) {
      mapRef.current.setOptions({ draggableCursor: undefined });
    }

    return () => {
      if (areaClickListenerRef.current) {
        areaClickListenerRef.current.remove();
        areaClickListenerRef.current = null;
      }
    };
  }, [areaSelectionMode, onAreaClick, mapReady, creationMode]);

  // Area selection: draw overlay
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    // Clear previous
    if (areaOverlayRef.current) {
      areaOverlayRef.current.setMap(null);
      areaOverlayRef.current = null;
    }
    areaMarkersRef.current.forEach((m) => m.setMap(null));
    areaMarkersRef.current = [];

    if (areaPoints.length === 0) return;

    // Draw point markers
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
      // Calculate radius in meters from center to edge point
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
      }) as any; // Circle has setMap like Polygon
    }
  }, [areaPoints, areaSelectionMode, mapReady]);

  // Fit map to active segment during navigation
  useEffect(() => {
    if (!mapReady || !mapRef.current || !fitToActiveSegment || !activeSegmentId) return;
    const seg = segments.find((s) => s.id === activeSegmentId);
    if (!seg || seg.coordinates.length === 0) return;

    const bounds = new google.maps.LatLngBounds();
    seg.coordinates.forEach((c) => bounds.extend(new google.maps.LatLng(c.lat, c.lng)));

    if (!bounds.isEmpty()) {
      try {
        // Smooth animated transition: first pan to center, then zoom
        const map = mapRef.current;
        const targetCenter = bounds.getCenter();
        map.panTo(targetCenter);
        setTimeout(() => {
          map.fitBounds(bounds, { top: 40, bottom: 160, left: 40, right: 40 });
        }, 400);
      } catch (e) {
        console.warn('fitBounds to active segment failed:', e);
      }
    }
  }, [fitToActiveSegment, activeSegmentId, segments, mapReady]);

  if (fallbackToLeaflet) {
    return (
      <MapDisplay
        segments={segments}
        activeSegmentId={activeSegmentId}
        currentPosition={currentPosition}
        optimizedOrder={optimizedOrder}
        className={className}
        onSegmentClick={onSegmentClick}
      />
    );
  }

  return <div ref={containerRef} className={`w-full h-full ${className}`} />;
}
