/**
 * live-coverage — análisis de cobertura GPS Trimble EN VIVO durante una
 * `TrimbleRecordingSession` activa.
 *
 * IMPORTANTE: este módulo es PURO y NO modifica estado persistente. Devuelve
 * una vista provisional por tramo que la UI/mapa usa solo para colorear.
 * Solo `closeTrimbleRecording` puede consolidar `SegmentCapture gps_auto`.
 *
 * Reutiliza la proyección y agregación de `gps-coverage.ts` aplicando
 * tolerancias más relajadas para feedback en vivo: el operador necesita
 * ver el avance mientras conduce, sin esperar al cierre.
 */
import type { Segment } from '@/types/route';
import type { TrimbleGpsPoint } from '@/types/trimble';
import { projectPointToPolyline } from '@/utils/trimble/gps-segment-matcher';

export type TrimbleLiveCoverageStatus =
  | 'live_current'
  | 'live_covered'
  | 'live_partial'
  | 'live_not_started';

export interface TrimbleLiveCoverageItem {
  segmentId: string;
  coverageRatio: number;
  matchedPoints: number;
  startProgress: number | null;
  endProgress: number | null;
  distanceMeters?: number | null;
  status: TrimbleLiveCoverageStatus;
}

export interface BuildLiveCoverageOptions {
  maxDistanceMeters?: number;
  minCoverageRatio?: number;
  maxGapRatio?: number;
  startToleranceRatio?: number;
  endToleranceRatio?: number;
  pointBufferMeters?: number;
  /** Tramos preferidos (cola operativa). Solo afectan al desempate de "tramo actual". */
  preferredSegmentIds?: ReadonlySet<string>;
  /** Punto GPS más reciente: usado para marcar `live_current`. */
  currentSegmentId?: string | null;
  /** Distancia máxima al eje del tramo "actual" para marcarlo current. */
  currentMaxDistanceMeters?: number;
}

const DEFAULTS: Required<Omit<BuildLiveCoverageOptions, 'preferredSegmentIds' | 'currentSegmentId'>> = {
  maxDistanceMeters: 25,
  minCoverageRatio: 0.7,
  maxGapRatio: 0.3,
  startToleranceRatio: 0.15,
  endToleranceRatio: 0.15,
  pointBufferMeters: 12,
  currentMaxDistanceMeters: 25,
};

interface Match {
  progress: number;
  distance: number;
}

function computeCoverage(progresses: number[], bufferRatio: number) {
  if (progresses.length === 0) return { coverageRatio: 0, maxInteriorGap: 0, minProgress: 0, maxProgress: 0 };
  const sorted = [...progresses].sort((a, b) => a - b);
  const intervals: Array<[number, number]> = sorted.map((p) => [
    Math.max(0, p - bufferRatio),
    Math.min(1, p + bufferRatio),
  ]);
  const merged: Array<[number, number]> = [];
  for (const it of intervals) {
    const last = merged[merged.length - 1];
    if (last && it[0] <= last[1]) last[1] = Math.max(last[1], it[1]);
    else merged.push([it[0], it[1]]);
  }
  let covered = 0;
  for (const [a, b] of merged) covered += b - a;
  let maxGap = 0;
  for (let i = 1; i < merged.length; i++) {
    const gap = merged[i][0] - merged[i - 1][1];
    if (gap > maxGap) maxGap = gap;
  }
  return {
    coverageRatio: Math.max(0, Math.min(1, covered)),
    maxInteriorGap: maxGap,
    minProgress: sorted[0],
    maxProgress: sorted[sorted.length - 1],
  };
}

/**
 * Construye el mapa de cobertura provisional por tramo.
 *
 * El llamador decide si invocar (solo si `activeTrimbleRecordingId` !== null)
 * y ya filtra los puntos GPS pertenecientes a la sesión activa
 * (`recordingSessionId === activeId && phase === 'capture'`).
 *
 * Reglas:
 *  - `live_current`: tramo actualmente bajo el GPS (override visual).
 *  - `live_covered`: cumple coverageRatio >= min y inicio/fin alcanzados,
 *    sin hueco interior > maxGapRatio.
 *  - `live_partial`: tiene >=1 punto válido pero no llega a `live_covered`.
 *  - `live_not_started`: el tramo no aparece en el mapa devuelto.
 */
export function buildTrimbleLiveCoverage(
  recordingPoints: ReadonlyArray<TrimbleGpsPoint>,
  segments: ReadonlyArray<Segment>,
  options: BuildLiveCoverageOptions = {},
): Map<string, TrimbleLiveCoverageItem> {
  const opts = { ...DEFAULTS, ...options };
  const result = new Map<string, TrimbleLiveCoverageItem>();
  if (recordingPoints.length === 0 && !opts.currentSegmentId) return result;

  for (const seg of segments) {
    if (!seg.coordinates || seg.coordinates.length < 2) continue;

    const matches: Match[] = [];
    let lastDistance: number | null = null;
    for (const p of recordingPoints) {
      const proj = projectPointToPolyline({ lat: p.lat, lng: p.lng }, seg.coordinates);
      if (!proj) continue;
      if (proj.distanceMeters > opts.maxDistanceMeters) continue;
      matches.push({ progress: proj.progress, distance: proj.distanceMeters });
      lastDistance = proj.distanceMeters;
    }

    const isCurrent = opts.currentSegmentId === seg.id;

    if (matches.length === 0) {
      if (isCurrent) {
        result.set(seg.id, {
          segmentId: seg.id,
          coverageRatio: 0,
          matchedPoints: 0,
          startProgress: null,
          endProgress: null,
          distanceMeters: null,
          status: 'live_current',
        });
      }
      continue;
    }

    // Aproximación de longitud: usa proyección para buffer ratio.
    // Reutilizamos la longitud almacenada en projectPointToPolyline
    // recalculándola con un único punto adicional barato:
    const probe = projectPointToPolyline(
      { lat: seg.coordinates[0].lat, lng: seg.coordinates[0].lng },
      seg.coordinates,
    );
    const segLen = probe?.polylineLengthMeters ?? 0;
    const bufferRatio = segLen > 0 ? opts.pointBufferMeters / segLen : 0.05;

    const { coverageRatio, maxInteriorGap, minProgress, maxProgress } =
      computeCoverage(matches.map((m) => m.progress), bufferRatio);

    let status: TrimbleLiveCoverageStatus = 'live_partial';
    const startOk = minProgress <= opts.startToleranceRatio;
    const endOk = maxProgress >= 1 - opts.endToleranceRatio;
    const gapOk = maxInteriorGap <= opts.maxGapRatio;
    if (startOk && endOk && gapOk && coverageRatio >= opts.minCoverageRatio) {
      status = 'live_covered';
    }
    if (isCurrent) status = 'live_current';

    result.set(seg.id, {
      segmentId: seg.id,
      coverageRatio,
      matchedPoints: matches.length,
      startProgress: minProgress,
      endProgress: maxProgress,
      distanceMeters: lastDistance,
      status,
    });
  }

  // Si current existe y no se añadió aún (sin puntos válidos), añadirlo.
  if (opts.currentSegmentId && !result.has(opts.currentSegmentId)) {
    result.set(opts.currentSegmentId, {
      segmentId: opts.currentSegmentId,
      coverageRatio: 0,
      matchedPoints: 0,
      startProgress: null,
      endProgress: null,
      distanceMeters: null,
      status: 'live_current',
    });
  }

  return result;
}

/**
 * Color provisional por estado live. NO se mezcla con
 * `TRIMBLE_STATUS_COLOR` para que sea evidente que es una capa transitoria
 * derivada de la sesión activa, no un estado consolidado.
 */
export const TRIMBLE_LIVE_STATUS_COLOR: Record<TrimbleLiveCoverageStatus, string> = {
  live_current: '#facc15',  // amarillo fuerte
  live_covered: '#10b981',  // verde vivo (provisional, distinto de procesado_ok #22c55e)
  live_partial: '#fb923c',  // naranja/ámbar
  live_not_started: '#6b7280',
};
