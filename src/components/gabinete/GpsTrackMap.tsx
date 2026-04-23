/**
 * Mapa Leaflet ligero para visualizar el recorrido GPS de un único track.
 *
 * - Polilínea de transporte (accent / turquesa).
 * - Polilínea de grabación (primary / amarillo operativo).
 * - Marcador de inicio y fin de track.
 * - Marcadores opcionales de cambio de fase y frontera de segmento.
 *
 * Decisión: usamos Leaflet directamente y no GoogleMapDisplay porque este
 * último está acoplado a la lógica de Segment/optimizedOrder. Para gabinete
 * basta con un mapa de lectura simple.
 */

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { TrackGpsPoint } from '@/types/route';
import { buildTrackGpsPolylines } from '@/utils/gabinete/track-gps-geometry';
import { computeTrackGpsMilestones } from '@/utils/gabinete/track-gps-derived';

interface Props {
  points: TrackGpsPoint[];
  className?: string;
}

const TRANSPORT_COLOR = 'hsl(174 72% 40%)'; // accent
const RECORDING_COLOR = 'hsl(38 95% 50%)'; // primary (amarillo operativo)
const START_COLOR = 'hsl(142 76% 36%)'; // success
const END_COLOR = 'hsl(0 84% 60%)'; // destructive
const BOUNDARY_COLOR = 'hsl(210 20% 95%)'; // foreground

function dotIcon(color: string, size = 12, label?: string): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid hsl(220 20% 7%);box-shadow:0 0 0 1px ${color};display:flex;align-items:center;justify-content:center;color:hsl(220 20% 7%);font-size:9px;font-weight:700;">${label ?? ''}</div>`,
  });
}

export function GpsTrackMap({ points, className = '' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.Layer[]>([]);

  // Init Leaflet map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [40.4168, -3.7038],
      zoom: 6,
      zoomControl: true,
      attributionControl: false,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Render overlays whenever points change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Limpiar capas previas
    layersRef.current.forEach((l) => l.remove());
    layersRef.current = [];

    if (!points || points.length === 0) return;

    const { transport, recording, bounds } = buildTrackGpsPolylines(points);
    const milestones = computeTrackGpsMilestones(points);

    // Polilíneas transport
    transport.forEach((line) => {
      const poly = L.polyline(
        line.map((p) => [p.lat, p.lng]),
        {
          color: TRANSPORT_COLOR,
          weight: 4,
          opacity: 0.75,
          dashArray: '6 6',
        },
      ).addTo(map);
      layersRef.current.push(poly);
    });

    // Polilíneas recording
    recording.forEach((line) => {
      const poly = L.polyline(
        line.map((p) => [p.lat, p.lng]),
        {
          color: RECORDING_COLOR,
          weight: 5,
          opacity: 0.95,
        },
      ).addTo(map);
      layersRef.current.push(poly);
    });

    // Marcador inicio
    if (milestones.first) {
      const m = L.marker([milestones.first.lat, milestones.first.lng], {
        icon: dotIcon(START_COLOR, 16, 'I'),
        title: 'Inicio del track',
      }).addTo(map);
      layersRef.current.push(m);
    }

    // Marcador fin
    if (milestones.last && milestones.last !== milestones.first) {
      const m = L.marker([milestones.last.lat, milestones.last.lng], {
        icon: dotIcon(END_COLOR, 16, 'F'),
        title: 'Fin del track',
      }).addTo(map);
      layersRef.current.push(m);
    }

    // Fronteras de segmentos grabados (puntos pequeños). Limitamos para no saturar.
    const maxBoundaries = 30;
    const boundaries = milestones.segmentBoundaries.slice(0, maxBoundaries);
    boundaries.forEach((b, i) => {
      const m = L.marker([b.point.lat, b.point.lng], {
        icon: dotIcon(BOUNDARY_COLOR, 10, String(i + 1)),
        title: `Inicio tramo ${b.segmentId}`,
      }).addTo(map);
      layersRef.current.push(m);
    });

    // Encuadre
    if (bounds) {
      const [minLat, minLng, maxLat, maxLng] = bounds;
      map.fitBounds(
        [
          [minLat, minLng],
          [maxLat, maxLng],
        ],
        { padding: [20, 20], maxZoom: 17 },
      );
    }

    // Forzar resize por si el mapa se montó dentro de un dialog que se acaba de abrir
    setTimeout(() => map.invalidateSize(), 50);
  }, [points]);

  return (
    <div className={`relative w-full ${className}`}>
      <div ref={containerRef} className="absolute inset-0 rounded-md overflow-hidden" />
    </div>
  );
}
