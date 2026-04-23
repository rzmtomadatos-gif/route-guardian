/**
 * Utilidades puras para derivar geometrías dibujables (polilíneas) a partir
 * de los puntos GPS de un track.
 *
 * No incluye cálculos de métricas (ver `track-gps-derived.ts`).
 */

import type { LatLng, TrackGpsPoint } from '@/types/route';

/**
 * Polilíneas separadas por fase. Cada array externo es una polilínea continua;
 * se corta cuando cambia la fase para evitar líneas que mezclen colores.
 */
export interface TrackGpsPolylines {
  transport: LatLng[][];
  recording: LatLng[][];
  /** Bounding box en formato [minLat, minLng, maxLat, maxLng] o null si vacío. */
  bounds: [number, number, number, number] | null;
}

const EMPTY: TrackGpsPolylines = {
  transport: [],
  recording: [],
  bounds: null,
};

/**
 * Construye polilíneas separadas para `transport` y `recording`.
 *
 * Estrategia: recorre los puntos secuencialmente y va abriendo segmentos por
 * fase. Cuando la fase cambia, cierra el segmento actual e inicia otro. Para
 * que la línea no quede "rota" visualmente entre fases, el primer punto de la
 * nueva fase también se conecta al último punto de la anterior — esto se
 * implementa duplicando el último punto de la polilínea anterior como inicio
 * de la siguiente.
 */
export function buildTrackGpsPolylines(
  points: TrackGpsPoint[] | undefined | null,
): TrackGpsPolylines {
  if (!Array.isArray(points) || points.length === 0) return { ...EMPTY };

  const transport: LatLng[][] = [];
  const recording: LatLng[][] = [];

  let currentPhase: 'transport' | 'recording' | null = null;
  let currentLine: LatLng[] = [];

  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;

  const flush = () => {
    if (currentPhase && currentLine.length >= 2) {
      if (currentPhase === 'transport') transport.push(currentLine);
      else recording.push(currentLine);
    }
  };

  for (const p of points) {
    const ll: LatLng = { lat: p.lat, lng: p.lng };
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;

    if (currentPhase === null) {
      currentPhase = p.phase;
      currentLine = [ll];
      continue;
    }

    if (p.phase === currentPhase) {
      currentLine.push(ll);
    } else {
      // Cerrar la línea actual añadiendo este punto como puente, luego abrir
      // una nueva en la nueva fase comenzando también desde el punto puente.
      // Esto da continuidad visual entre fases sin mezclar colores.
      currentLine.push(ll);
      flush();
      currentPhase = p.phase;
      currentLine = [ll];
    }
  }

  flush();

  if (!Number.isFinite(minLat)) {
    return { transport, recording, bounds: null };
  }

  return {
    transport,
    recording,
    bounds: [minLat, minLng, maxLat, maxLng],
  };
}
