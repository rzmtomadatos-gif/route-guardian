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
}
