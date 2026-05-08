/**
 * Tipos del dominio TRIMBLE_LIDAR.
 *
 * VialRoute funciona en este modo como CUADERNO DE BITÁCORA del operador:
 * registra qué se intenta capturar (Misión → Pasada → Captura), incidencias
 * y entregables externos (procesado en TBC/POSPac/TMX). NO procesa nube de
 * puntos.
 *
 * Reglas duras:
 *  - El estado de calidad (`qaStatus`) SOLO lo fija gabinete.
 *  - Como máximo una `SegmentCapture` abierta por `runId` (endedAt === null).
 *  - `activeCaptureId` NO existe en `AppState`; se deriva con findActiveCapture.
 *  - Los entregables son referencias externas (URL/NAS/ID), nunca binarios.
 */
import type { LatLng } from '@/types/route';

export type TrimbleSegmentStatus =
  | 'pendiente'
  | 'en_captura'
  | 'capturado_pendiente_proceso'
  | 'procesado_ok'                  // solo gabinete
  | 'procesado_con_observaciones'   // solo gabinete
  | 'repetir'
  | 'descartado_por_calidad'        // solo gabinete
  | 'no_capturable';

export type TrimbleFieldStatus = Extract<
  TrimbleSegmentStatus,
  'en_captura' | 'capturado_pendiente_proceso' | 'repetir' | 'no_capturable'
>;

export type TrimbleQaStatus = Extract<
  TrimbleSegmentStatus,
  'procesado_ok' | 'procesado_con_observaciones' | 'descartado_por_calidad'
>;

export const TRIMBLE_FIELD_STATUSES: readonly TrimbleFieldStatus[] = [
  'en_captura',
  'capturado_pendiente_proceso',
  'repetir',
  'no_capturable',
] as const;

export const TRIMBLE_QA_STATUSES: readonly TrimbleQaStatus[] = [
  'procesado_ok',
  'procesado_con_observaciones',
  'descartado_por_calidad',
] as const;

export interface CaptureMission {
  id: string;
  workDay: number;
  startedAt: string;
  endedAt: string | null;
  vehicle?: string;
  sensorRig?: string;
  operator?: string;
  weather?: string;
  notes?: string;
  closedReason?: 'manual' | 'fin_jornada' | 'incidencia';
}

export interface CaptureRun {
  id: string;
  missionId: string;
  index: number;
  direction?: 'ida' | 'vuelta' | 'otro';
  startedAt: string;
  endedAt: string | null;
  startPosition?: LatLng;
  endPosition?: LatLng;
  notes?: string;
  /** Si se invalidó la pasada por incidencia bloqueante. */
  invalidated?: boolean;
}

export interface SegmentCapture {
  id: string;
  segmentId: string;
  runId: string;
  missionId: string;
  startedAt: string;
  endedAt: string | null;
  startPosition?: LatLng;
  endPosition?: LatLng;
  fieldStatus: TrimbleFieldStatus;
  fieldNotes?: string;
  qaStatus: TrimbleQaStatus | null;
  qaNotes?: string;
  qaReviewedBy?: string;
  qaReviewedAt?: string;
}

export type TrimbleIncidentCategory =
  | 'gnss_perdida'
  | 'imu_drift'
  | 'oclusion_severa'
  | 'fallo_sensor'
  | 'fallo_almacenamiento'
  | 'trafico_extremo'
  | 'climatologia'
  | 'acceso_imposible'
  | 'otro';

export type TrimbleIncidentSeverity = 'baja' | 'media' | 'alta' | 'bloqueante';

export interface TrimbleIncident {
  id: string;
  missionId: string;
  runId?: string | null;
  segmentId?: string | null;
  category: TrimbleIncidentCategory;
  severity: TrimbleIncidentSeverity;
  note?: string;
  timestamp: string;
  location?: LatLng;
  invalidatesRun?: boolean;
}

export type TrimbleDeliverableKind =
  | 'trayectoria'
  | 'nube_puntos'
  | 'imagenes'
  | 'ortho_lane'
  | 'informe_qa'
  | 'informe_pci_iri'
  | 'csv'
  | 'shp'
  | 'kmz'
  | 'pdf'
  | 'las'
  | 'tmx'
  | 'otro';

export interface TrimbleDeliverable {
  id: string;
  kind: TrimbleDeliverableKind;
  missionId?: string | null;
  runId?: string | null;
  segmentId?: string | null;
  /** URL, ruta NAS o ID externo. NUNCA un binario. */
  reference: string;
  fileName?: string;
  sizeBytes?: number;
  hash?: string;
  uploadedBy?: string;
  uploadedAt: string;
  notes?: string;
}

export interface TrimbleGpsPoint {
  timestamp: string;
  lat: number;
  lng: number;
  accuracy?: number | null;
  speed?: number | null;
  heading?: number | null;
  missionId: string;
  runId: string;
  phase: 'transport' | 'capture';
  segmentId?: string | null;
  source: 'gps';
}

/**
 * Única fuente de verdad para "captura activa".
 * Como máximo una captura abierta por run; si hubiera varias por bug, devuelve
 * la primera (los hooks deben impedir esa situación).
 */
export function findActiveCapture(
  captures: SegmentCapture[],
  activeRunId: string | null,
): SegmentCapture | null {
  if (!activeRunId) return null;
  return captures.find((c) => c.runId === activeRunId && c.endedAt === null) ?? null;
}

/** Helper: ¿el status pertenece al campo (no QA)? */
export function isFieldStatus(s: TrimbleSegmentStatus): s is TrimbleFieldStatus {
  return (TRIMBLE_FIELD_STATUSES as readonly string[]).includes(s);
}

/** Helper: ¿el status pertenece a QA (gabinete)? */
export function isQaStatus(s: TrimbleSegmentStatus): s is TrimbleQaStatus {
  return (TRIMBLE_QA_STATUSES as readonly string[]).includes(s);
}
