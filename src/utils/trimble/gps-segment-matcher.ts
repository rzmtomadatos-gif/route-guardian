/**
 * gps-segment-matcher — proyección de un punto GPS sobre las polilíneas de
 * los tramos disponibles para detectar el tramo actual.
 *
 * Pure module — sin dependencias React/AppState. Reutiliza haversineMeters
 * para distancias geodésicas.
 */
import type { LatLng, Segment } from '@/types/route';
import { haversineMeters } from '@/utils/geo-distance';

export interface SegmentMatchResult {
  segmentId: string | null;
  distanceMeters: number | null;
  /** Progreso 0..1 sobre la polilínea del tramo. null si no hay match. */
  progress: number | null;
}

export interface FindCurrentSegmentOptions {
  maxDistanceMeters?: number;
  /** IDs de tramos en cola operativa actual. Se usan como desempate. */
  preferredSegmentIds?: ReadonlySet<string>;
}

interface PolylineProjection {
  distanceMeters: number;
  progress: number;
  polylineLengthMeters: number;
}

/**
 * Proyecta un punto sobre cada subsegmento [A,B] de la polilínea y
 * devuelve la mejor (mínima distancia) junto con el progreso 0..1 sobre
 * la longitud total de la polilínea.
 *
 * Usa una aproximación local plano-equirrectangular para el producto
 * escalar (rápida y muy precisa a la escala de un tramo viario).
 */
export function projectPointToPolyline(
  point: LatLng,
  polyline: ReadonlyArray<LatLng>,
): PolylineProjection | null {
  if (!polyline || polyline.length < 2) return null;

  // Longitudes acumuladas y total.
  const cumLengths: number[] = new Array(polyline.length).fill(0);
  for (let i = 1; i < polyline.length; i++) {
    cumLengths[i] = cumLengths[i - 1] + haversineMeters(polyline[i - 1], polyline[i]);
  }
  const total = cumLengths[polyline.length - 1];
  if (total <= 0) return null;

  let bestDist = Infinity;
  let bestProgressMeters = 0;

  // Conversor local: lat/lng → metros relativos al primer punto.
  const refLat = polyline[0].lat;
  const cosRef = Math.cos((refLat * Math.PI) / 180);
  const M_PER_DEG_LAT = 111_320;
  const M_PER_DEG_LNG = 111_320 * cosRef;
  const toXY = (p: LatLng) => ({
    x: (p.lng - polyline[0].lng) * M_PER_DEG_LNG,
    y: (p.lat - polyline[0].lat) * M_PER_DEG_LAT,
  });

  const P = toXY(point);

  for (let i = 1; i < polyline.length; i++) {
    const A = toXY(polyline[i - 1]);
    const B = toXY(polyline[i]);
    const ABx = B.x - A.x;
    const ABy = B.y - A.y;
    const segLen2 = ABx * ABx + ABy * ABy;
    let t = 0;
    if (segLen2 > 0) {
      t = ((P.x - A.x) * ABx + (P.y - A.y) * ABy) / segLen2;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
    }
    const Qx = A.x + t * ABx;
    const Qy = A.y + t * ABy;
    const dx = P.x - Qx;
    const dy = P.y - Qy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < bestDist) {
      bestDist = d;
      const subLen = Math.sqrt(segLen2);
      bestProgressMeters = cumLengths[i - 1] + t * subLen;
    }
  }

  return {
    distanceMeters: bestDist,
    progress: total > 0 ? bestProgressMeters / total : 0,
    polylineLengthMeters: total,
  };
}

/**
 * Devuelve el tramo más cercano al punto GPS dentro de `maxDistanceMeters`.
 * Si dos tramos están dentro de tolerancia, prioriza el que esté en
 * `preferredSegmentIds` (cola operativa actual).
 */
export function findCurrentSegmentFromGps(
  position: LatLng,
  segments: ReadonlyArray<Segment>,
  options: FindCurrentSegmentOptions = {},
): SegmentMatchResult {
  const maxDist = options.maxDistanceMeters ?? 25;
  const preferred = options.preferredSegmentIds ?? null;

  let best: { segId: string; dist: number; progress: number; preferred: boolean } | null = null;

  for (const seg of segments) {
    if (!seg.coordinates || seg.coordinates.length < 2) continue;
    const proj = projectPointToPolyline(position, seg.coordinates);
    if (!proj) continue;
    if (proj.distanceMeters > maxDist) continue;
    const isPref = preferred ? preferred.has(seg.id) : false;
    if (
      !best ||
      // Si el actual es preferred y el best no, gana el preferred.
      (isPref && !best.preferred) ||
      // Si ambos comparten "preferred", gana el más cercano.
      (isPref === best.preferred && proj.distanceMeters < best.dist)
    ) {
      best = { segId: seg.id, dist: proj.distanceMeters, progress: proj.progress, preferred: isPref };
    }
  }

  if (!best) return { segmentId: null, distanceMeters: null, progress: null };
  return { segmentId: best.segId, distanceMeters: best.dist, progress: best.progress };
}
