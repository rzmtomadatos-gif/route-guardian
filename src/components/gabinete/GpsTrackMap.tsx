/**
 * Mapa Leaflet de un track GPS:
 *
 * - Polilínea de transporte (accent / turquesa, discontinua).
 * - Polilínea de grabación (primary / amarillo operativo).
 * - Marcadores de inicio / fin de track.
 * - Marcadores de inicio de tramo claramente legibles, con etiqueta humana
 *   (companySegmentId / name / kmlId) — NUNCA el id interno como etiqueta principal.
 * - Marcadores de incidencia coloreados por impacto, con popup informativo.
 * - Click en marcador de tramo → abre la ficha de gabinete del tramo.
 */

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Incident, Segment, TrackGpsPoint } from '@/types/route';
import { buildTrackGpsPolylines } from '@/utils/gabinete/track-gps-geometry';
import {
  computeTrackGpsMilestones,
  getSegmentDisplayId,
  getSegmentDisplayName,
} from '@/utils/gabinete/track-gps-derived';

interface Props {
  points: TrackGpsPoint[];
  /** Índice de segmentos para resolver etiquetas humanas en el mapa. */
  segmentsById?: Map<string, Segment>;
  /** Incidencias geolocalizadas a pintar sobre este track. */
  incidents?: Incident[];
  /** Callback al pulsar un marcador de tramo (abre ficha de gabinete). */
  onOpenSegment?: (segmentId: string) => void;
  className?: string;
}

const TRANSPORT_COLOR = 'hsl(174 72% 40%)';
const RECORDING_COLOR = 'hsl(38 95% 50%)';
const START_COLOR = 'hsl(142 76% 36%)';
const END_COLOR = 'hsl(0 84% 60%)';
const SEGMENT_MARKER_BG = 'hsl(220 25% 12%)';
const SEGMENT_MARKER_BORDER = 'hsl(38 95% 55%)';

const INCIDENT_COLORS: Record<Incident['impact'], string> = {
  critica_invalida_bloque: 'hsl(0 84% 55%)',
  critica_no_grabable: 'hsl(32 95% 55%)',
  informativa: 'hsl(210 35% 65%)',
};

const INCIDENT_LABELS: Record<Incident['impact'], string> = {
  critica_invalida_bloque: 'Crítica · invalida bloque',
  critica_no_grabable: 'Crítica · no grabable',
  informativa: 'Informativa',
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function endpointIcon(color: string, label: string): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<div style="width:22px;height:22px;border-radius:50%;background:${color};border:2px solid hsl(220 20% 7%);box-shadow:0 0 0 1px ${color};display:flex;align-items:center;justify-content:center;color:hsl(0 0% 100%);font-size:11px;font-weight:700;line-height:1;">${escapeHtml(label)}</div>`,
  });
}

function segmentMarkerIcon(label: string, index: number): L.DivIcon {
  // Tamaño mayor + etiqueta lateral: cápsula con número + texto pequeño.
  const safe = escapeHtml(label);
  return L.divIcon({
    className: '',
    iconSize: [0, 0],
    iconAnchor: [11, 11],
    html: `
      <div style="display:inline-flex;align-items:center;gap:4px;transform:translate(-11px,-11px);pointer-events:auto;">
        <div style="width:22px;height:22px;border-radius:50%;background:${SEGMENT_MARKER_BG};border:2px solid ${SEGMENT_MARKER_BORDER};color:${SEGMENT_MARKER_BORDER};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;line-height:1;box-shadow:0 1px 4px rgba(0,0,0,0.5);">${index}</div>
        <div style="background:${SEGMENT_MARKER_BG};color:hsl(0 0% 100%);font-size:10px;font-weight:600;padding:2px 6px;border-radius:10px;border:1px solid ${SEGMENT_MARKER_BORDER};white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis;box-shadow:0 1px 4px rgba(0,0,0,0.5);">${safe}</div>
      </div>
    `,
  });
}

function incidentIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: `<div style="width:20px;height:20px;border-radius:50%;background:${color};border:2px solid hsl(0 0% 100%);box-shadow:0 0 0 1px ${color};display:flex;align-items:center;justify-content:center;color:hsl(0 0% 100%);font-size:12px;font-weight:900;line-height:1;">!</div>`,
  });
}

export function GpsTrackMap({
  points,
  segmentsById,
  incidents,
  onOpenSegment,
  className = '',
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.Layer[]>([]);
  // Guardamos la última ref del callback para usarla dentro del effect sin re-renderizar capas.
  const onOpenSegmentRef = useRef(onOpenSegment);
  onOpenSegmentRef.current = onOpenSegment;

  // Init
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    layersRef.current.forEach((l) => l.remove());
    layersRef.current = [];

    if (!points || points.length === 0) return;

    const { transport, recording, bounds } = buildTrackGpsPolylines(points);
    const milestones = computeTrackGpsMilestones(points);

    transport.forEach((line) => {
      const latlngs: L.LatLngTuple[] = line.map((p) => [p.lat, p.lng]);
      const poly = L.polyline(latlngs, {
        color: TRANSPORT_COLOR,
        weight: 4,
        opacity: 0.75,
        dashArray: '6 6',
      }).addTo(map);
      layersRef.current.push(poly);
    });

    recording.forEach((line) => {
      const latlngs: L.LatLngTuple[] = line.map((p) => [p.lat, p.lng]);
      const poly = L.polyline(latlngs, {
        color: RECORDING_COLOR,
        weight: 5,
        opacity: 0.95,
      }).addTo(map);
      layersRef.current.push(poly);
    });

    if (milestones.first) {
      const m = L.marker([milestones.first.lat, milestones.first.lng], {
        icon: endpointIcon(START_COLOR, 'I'),
        title: 'Inicio del track',
      }).addTo(map);
      layersRef.current.push(m);
    }

    if (milestones.last && milestones.last !== milestones.first) {
      const m = L.marker([milestones.last.lat, milestones.last.lng], {
        icon: endpointIcon(END_COLOR, 'F'),
        title: 'Fin del track',
      }).addTo(map);
      layersRef.current.push(m);
    }

    // Marcadores de inicio de tramo legibles + click → abrir ficha
    const maxBoundaries = 60;
    const boundaries = milestones.segmentBoundaries.slice(0, maxBoundaries);
    boundaries.forEach((b, i) => {
      const seg = segmentsById?.get(b.segmentId);
      const displayId = seg ? getSegmentDisplayId(seg) : b.segmentId;
      const displayName = seg ? getSegmentDisplayName(seg) : '(tramo no en campaña)';
      const idx = i + 1;

      const marker = L.marker([b.point.lat, b.point.lng], {
        icon: segmentMarkerIcon(displayId, idx),
        title: displayName,
        riseOnHover: true,
      }).addTo(map);

      const popupHtml = `
        <div style="font-size:12px;line-height:1.35;min-width:160px;">
          <div style="font-weight:700;color:hsl(220 20% 12%);margin-bottom:2px;">${escapeHtml(displayId)}</div>
          ${
            seg
              ? `<div style="color:hsl(220 10% 35%);">${escapeHtml(displayName)}</div>`
              : `<div style="color:hsl(0 84% 45%);font-style:italic;">Tramo no encontrado en la campaña</div>`
          }
          <div style="margin-top:4px;color:hsl(220 10% 45%);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;">${escapeHtml(b.segmentId)}</div>
          ${
            seg && onOpenSegmentRef.current
              ? `<div style="margin-top:6px;"><button data-open-segment="${escapeHtml(b.segmentId)}" style="background:hsl(38 95% 50%);color:hsl(220 25% 10%);border:none;padding:4px 8px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;">Abrir ficha</button></div>`
              : ''
          }
        </div>
      `;
      marker.bindPopup(popupHtml, { closeButton: true });

      // Click directo en marcador → abrir ficha si existe segmento
      marker.on('click', () => {
        if (seg && onOpenSegmentRef.current) {
          onOpenSegmentRef.current(seg.id);
        } else {
          marker.openPopup();
        }
      });

      // Click delegado en botón dentro del popup
      marker.on('popupopen', (ev) => {
        const popupNode = (ev as L.PopupEvent).popup.getElement();
        if (!popupNode) return;
        const btn = popupNode.querySelector<HTMLButtonElement>('button[data-open-segment]');
        if (btn) {
          btn.onclick = () => {
            const id = btn.getAttribute('data-open-segment');
            if (id && onOpenSegmentRef.current) onOpenSegmentRef.current(id);
          };
        }
      });

      layersRef.current.push(marker);
    });

    // Incidencias
    (incidents ?? []).forEach((inc) => {
      if (!inc.location) return;
      const color = INCIDENT_COLORS[inc.impact] ?? INCIDENT_COLORS.informativa;
      const seg = segmentsById?.get(inc.segmentId);
      const segLabel = seg ? getSegmentDisplayId(seg) : inc.segmentId;
      const time = (() => {
        try {
          return new Date(inc.timestamp).toLocaleString();
        } catch {
          return inc.timestamp;
        }
      })();

      const marker = L.marker([inc.location.lat, inc.location.lng], {
        icon: incidentIcon(color),
        title: `Incidencia · ${INCIDENT_LABELS[inc.impact]}`,
        riseOnHover: true,
      }).addTo(map);

      const popupHtml = `
        <div style="font-size:12px;line-height:1.4;min-width:200px;max-width:260px;">
          <div style="font-weight:700;color:${color};margin-bottom:2px;">${escapeHtml(INCIDENT_LABELS[inc.impact])}</div>
          <div style="color:hsl(220 20% 12%);">${escapeHtml(inc.category)}</div>
          ${inc.note ? `<div style="margin-top:4px;color:hsl(220 10% 30%);">${escapeHtml(inc.note)}</div>` : ''}
          <div style="margin-top:6px;color:hsl(220 10% 35%);">${escapeHtml(time)}</div>
          <div style="margin-top:2px;color:hsl(220 10% 35%);">Tramo: <strong>${escapeHtml(segLabel)}</strong></div>
          <div style="margin-top:2px;color:hsl(220 10% 45%);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;">${inc.location.lat.toFixed(5)}, ${inc.location.lng.toFixed(5)}</div>
          ${
            seg && onOpenSegmentRef.current
              ? `<div style="margin-top:6px;"><button data-open-segment="${escapeHtml(seg.id)}" style="background:hsl(220 25% 12%);color:hsl(0 0% 100%);border:1px solid ${color};padding:4px 8px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;">Abrir ficha del tramo</button></div>`
              : ''
          }
        </div>
      `;
      marker.bindPopup(popupHtml);
      marker.on('popupopen', (ev) => {
        const popupNode = (ev as L.PopupEvent).popup.getElement();
        if (!popupNode) return;
        const btn = popupNode.querySelector<HTMLButtonElement>('button[data-open-segment]');
        if (btn) {
          btn.onclick = () => {
            const id = btn.getAttribute('data-open-segment');
            if (id && onOpenSegmentRef.current) onOpenSegmentRef.current(id);
          };
        }
      });
      layersRef.current.push(marker);
    });

    if (bounds) {
      const [minLat, minLng, maxLat, maxLng] = bounds;
      map.fitBounds(
        [
          [minLat, minLng],
          [maxLat, maxLng],
        ],
        { padding: [30, 30], maxZoom: 17 },
      );
    }

    setTimeout(() => map.invalidateSize(), 50);
  }, [points, segmentsById, incidents]);

  return (
    <div className={`relative w-full ${className}`}>
      <div ref={containerRef} className="absolute inset-0 rounded-md overflow-hidden" />
    </div>
  );
}
