export type AcquisitionMode = 'RST' | 'GARMIN';
export type SegmentDirection = 'creciente' | 'ambos';
export type SegmentType = 'tramo' | 'rotonda';
export type SegmentStatus = 'pendiente' | 'en_progreso' | 'completado' | 'posible_repetir';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface SegmentKmlMeta {
  carretera?: string;
  identtramo?: string;
  tipo?: string;
  calzada?: string;
  sentido?: string;
  pkInicial?: string;
  pkFinal?: string;
}

export interface Segment {
  id: string;
  routeId: string;
  trackNumber: number | null;
  plannedTrackNumber: number | null;
  plannedBy?: 'rst' | 'manual';
  trackHistory: number[];
  kmlId: string;
  name: string;
  notes: string;
  coordinates: LatLng[];
  direction: SegmentDirection;
  type: SegmentType;
  status: SegmentStatus;
  kmlMeta: SegmentKmlMeta;
  layer?: string;
  color?: string;
  timestampInicio?: string;
  timestampFin?: string;
  startedAt?: string | null;
  endedAt?: string | null;
  failedAt?: string | null;
  /** Physical/operational impossibility to record (road cut, no access, flood) */
  nonRecordable?: boolean;
  /** Segment is recordable but needs repeat (block invalidated, operator decision) */
  needsRepeat?: boolean;
  /** Which track number caused invalidation (audit trail) */
  invalidatedByTrack?: number | null;
  /** @deprecated Use needsRepeat instead */
  repeatRequested?: boolean;
  /** How many times this segment has been recorded (for analysis). Defaults to 0. */
  repeatNumber?: number;
  /** Unique company segment identifier, e.g. BOA_00012 */
  companySegmentId?: string;
  /** Work day number when this segment was recorded */
  workDay?: number;
  /** Order of this segment within its track */
  segmentOrder?: number;
  /** Garmin mode: seconds from track start to segment start */
  segmentStartSeconds?: number | null;
  /** Garmin mode: seconds from track start to segment end */
  segmentEndSeconds?: number | null;
}

/** F5 confirmation event recorded by operator */
export interface F5Event {
  segmentId: string;
  companySegmentId?: string;
  eventType: 'inicio' | 'pk' | 'fin' | 'f7_fin_adquisicion' | 'f9_modo_transporte';
  distanceMarker: number | null; // e.g. 1000, 2000, 3000 for PK events
  confirmedAt: string; // ISO
  confirmedByUser: boolean;
  trackNumber?: number | null;
  workDay?: number;
  attemptNumber?: number;
}

/** Compute required PK markers for a segment length */
export function getRequiredPkMarkers(segmentLengthMeters: number): number[] {
  const markers: number[] = [];
  let pk = 1000;
  while (pk < segmentLengthMeters) {
    markers.push(pk);
    pk += 1000;
  }
  return markers;
}

export interface Route {
  id: string;
  name: string;
  loadedAt: string;
  fileName: string;
  segments: Segment[];
  optimizedOrder: string[];
  availableLayers?: string[];
  /** Short project code used for segment IDs, e.g. "BOA" */
  projectCode?: string;
  /** Full project name for headers/export, e.g. "Boadilla del Monte 2026" */
  projectName?: string;
  /** Operator name for traceability */
  operator?: string;
  /** Vehicle identifier */
  vehicle?: string;
  /** Weather conditions note */
  weather?: string;
}

export type IncidentCategory =
  | 'lluvia'
  | 'niebla'
  | 'bache'
  | 'obra'
  | 'carretera_cortada'
  | 'inundacion'
  | 'accidente'
  | 'obstaculo'
  | 'acceso_imposible'
  | 'trafico_extremo'
  | 'error_sistema_pc360'
  | 'error_sistema_pc2'
  | 'error_sistema_linux'
  | 'otro';

/** Impact level of an incident */
export type IncidentImpact = 'informativa' | 'critica_no_grabable' | 'critica_invalida_bloque';

export interface Incident {
  id: string;
  segmentId: string;
  category: IncidentCategory;
  impact: IncidentImpact;
  note?: string;
  timestamp: string;
  location?: LatLng;
  /** Track number at the time of the incident (for traceability if block invalidated) */
  trackAtIncident?: number | null;
  /** Whether this incident invalidated the entire block */
  invalidatedBlock?: boolean;
}

export interface BaseLocation {
  position: LatLng;
  label: string;
}

export interface TrackSession {
  active: boolean;
  trackNumber: number;
  capacity: number;
  segmentIds: string[];
  startedAt: string | null;
  endedAt: string | null;
  closedManually: boolean;
  /** Epoch ms when this track started (for Garmin time-based mode) */
  trackStartTime?: number | null;
}

export interface BlockEndPrompt {
  isOpen: boolean;
  trackNumber: number | null;
  reason: 'capacity' | 'manual' | 'invalidated';
}

export interface AppState {
  route: Route | null;
  incidents: Incident[];
  activeSegmentId: string | null;
  navigationActive: boolean;
  currentPosition: LatLng | null;
  base: BaseLocation | null;
  rstMode: boolean;
  rstGroupSize: number;
  trackSession: TrackSession | null;
  blockEndPrompt: BlockEndPrompt;
  /** Current work day number (1-based). Tracks reset each day. */
  workDay: number;
  /** Acquisition mode: RST (F5-based) or GARMIN (time-based) */
  acquisitionMode: AcquisitionMode;
  /**
   * Tracks consumidos por día. Se incrementa al ABRIR un track,
   * de modo que tracks abiertos y cerrados sin tramos siguen contando
   * para la numeración del siguiente inicio.
   * Ej: { 1: 3, 2: 1 } → día 1 ha consumido hasta Track 3, día 2 hasta Track 1.
   */
  lastConsumedTrackByDay: Record<number, number>;
  /**
   * Correcciones auditadas y reversibles aplicadas por gabinete.
   * Append-only. El consolidado se deriva en lectura combinando el dato de
   * campo con las correcciones activas (active=true), ordenadas por fecha.
   */
  segmentCorrections: SegmentCorrection[];
}

/** Campos editables por gabinete mediante el modelo de correcciones. */
export type CorrectableField =
  // Identificación / metadatos KML — no exigen motivo
  | 'name'
  | 'notes'
  | 'kmlId'
  | 'companySegmentId'
  | 'direction'
  | 'type'
  | 'kmlMeta.carretera'
  | 'kmlMeta.identtramo'
  | 'kmlMeta.tipo'
  | 'kmlMeta.calzada'
  | 'kmlMeta.sentido'
  | 'kmlMeta.pkInicial'
  | 'kmlMeta.pkFinal'
  // Trazabilidad consolidada — exigen motivo obligatorio
  | 'workDay'
  | 'trackNumber'
  | 'segmentOrder'
  | 'status'
  | 'needsRepeat'
  | 'nonRecordable'
  | 'invalidatedByTrack'
  | 'repeatNumber';

/** Campos cuya corrección exige un motivo obligatorio. */
export const FIELDS_REQUIRING_REASON: ReadonlySet<CorrectableField> = new Set<CorrectableField>([
  'workDay',
  'trackNumber',
  'segmentOrder',
  'status',
  'needsRepeat',
  'nonRecordable',
  'invalidatedByTrack',
  'repeatNumber',
]);

/**
 * Corrección auditada y reversible aplicada por gabinete sobre un tramo.
 * Append-only: nunca se borra ni se muta el array. Las reversiones marcan
 * `active: false` y conservan el rastro completo (quién, cuándo, por qué).
 */
export interface SegmentCorrection {
  /** UUID estable de la corrección. */
  id: string;
  segmentId: string;
  field: CorrectableField;
  /** Valor anterior tal y como estaba en el consolidado en el momento de aplicar. */
  previousValue: unknown;
  /** Valor nuevo aplicado al consolidado. */
  newValue: unknown;
  /** Motivo de la corrección. Vacío permitido solo para campos descriptivos. */
  reason: string;
  /** Identificador del autor (email o user id). */
  correctedBy: string;
  correctedByRole: 'gabinete' | 'admin';
  /** ISO 8601. */
  correctedAt: string;
  /** false si la corrección fue revertida o superseded por una posterior sobre el mismo campo. */
  active: boolean;
  revertedBy?: string;
  revertedAt?: string;
  revertReason?: string;
  /** id de la corrección posterior que la dejó obsoleta sobre el mismo campo. */
  supersededBy?: string;
}
