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
}

export interface Route {
  id: string;
  name: string;
  loadedAt: string;
  fileName: string;
  segments: Segment[];
  optimizedOrder: string[];
  availableLayers?: string[];
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
  | 'otro';

export interface Incident {
  id: string;
  segmentId: string;
  category: IncidentCategory;
  note?: string;
  timestamp: string;
  location?: LatLng;
}

export interface BaseLocation {
  position: LatLng;
  label: string;
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
}
