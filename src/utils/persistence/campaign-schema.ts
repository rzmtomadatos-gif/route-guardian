/**
 * Zod schema for validating campaign JSON imports.
 * Catches corrupted, partial, or malicious campaign files
 * before they enter the persistence layer.
 *
 * POLICY:
 * - Structures use .strict() where possible (reject unknown keys).
 * - Where external/future fields may appear (kmlMeta, payload) we use .passthrough().
 * - eventType uses the real EventType union from types.ts.
 * - Timestamps are validated as ISO-8601 strings.
 * - Incident categories and impacts use the real enums from route.ts.
 */
import { z } from 'zod';

const MAX_SEGMENTS = 50_000;
const MAX_EVENTS = 500_000;
const MAX_INCIDENTS = 10_000;
const MAX_COORDINATES_PER_SEGMENT = 100_000;
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

/** ISO-8601 datetime string — loose but rejects garbage */
const isoDateString = z.string().regex(
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/,
  'Formato de fecha inválido (se espera ISO-8601)',
);

const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
}).strict();

// ── KML Meta — passthrough allowed (external KML fields vary) ──
const segmentKmlMetaSchema = z.object({
  carretera: z.string().optional(),
  identtramo: z.string().optional(),
  tipo: z.string().optional(),
  calzada: z.string().optional(),
  sentido: z.string().optional(),
  pkInicial: z.string().optional(),
  pkFinal: z.string().optional(),
}).passthrough();

// ── Segment — strict core, optional future fields explicitly declared ──
const segmentSchema = z.object({
  id: z.string().min(1).max(100),
  routeId: z.string().min(1).max(100),
  trackNumber: z.number().nullable(),
  plannedTrackNumber: z.number().nullable(),
  plannedBy: z.enum(['rst', 'manual']).optional(),
  trackHistory: z.array(z.number()).max(1000).default([]),
  kmlId: z.string().max(500).default(''),
  name: z.string().min(1).max(500),
  notes: z.string().max(5000).default(''),
  coordinates: z.array(latLngSchema).min(2).max(MAX_COORDINATES_PER_SEGMENT),
  direction: z.enum(['creciente', 'ambos']),
  type: z.enum(['tramo', 'rotonda']),
  status: z.enum(['pendiente', 'en_progreso', 'completado', 'posible_repetir']),
  kmlMeta: segmentKmlMetaSchema,
  layer: z.string().max(500).optional(),
  color: z.string().max(50).optional(),
  companySegmentId: z.string().max(100).optional(),
  workDay: z.number().int().min(0).optional(),
  segmentOrder: z.number().int().min(0).optional(),
  nonRecordable: z.boolean().optional(),
  needsRepeat: z.boolean().optional(),
  repeatRequested: z.boolean().optional(),
  repeatNumber: z.number().int().min(0).optional(),
  invalidatedByTrack: z.number().nullable().optional(),
  timestampInicio: z.string().optional(),
  timestampFin: z.string().optional(),
  startedAt: z.string().nullable().optional(),
  endedAt: z.string().nullable().optional(),
  failedAt: z.string().nullable().optional(),
  segmentStartSeconds: z.number().nullable().optional(),
  segmentEndSeconds: z.number().nullable().optional(),
}).strict();

// ── Route — strict ──
const routeSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(500),
  loadedAt: isoDateString,
  fileName: z.string().min(1).max(500),
  segments: z.array(segmentSchema).min(1).max(MAX_SEGMENTS),
  optimizedOrder: z.array(z.string()).max(MAX_SEGMENTS),
  availableLayers: z.array(z.string()).optional(),
  projectCode: z.string().max(50).optional(),
  projectName: z.string().max(500).optional(),
  operator: z.string().max(200).optional(),
  vehicle: z.string().max(200).optional(),
  weather: z.string().max(500).optional(),
}).strict();

// ── Incident — strict with real enums ──
const incidentCategoryEnum = z.enum([
  'lluvia', 'niebla', 'bache', 'obra', 'carretera_cortada',
  'inundacion', 'accidente', 'obstaculo', 'acceso_imposible',
  'trafico_extremo', 'error_sistema_pc360', 'error_sistema_pc2',
  'error_sistema_linux', 'otro',
]);

const incidentImpactEnum = z.enum([
  'informativa', 'critica_no_grabable', 'critica_invalida_bloque',
]);

const incidentSchema = z.object({
  id: z.string().min(1).max(100),
  segmentId: z.string().min(1).max(100),
  category: incidentCategoryEnum,
  impact: incidentImpactEnum,
  note: z.string().max(2000).optional(),
  timestamp: isoDateString,
  location: latLngSchema.optional(),
  trackAtIncident: z.number().nullable().optional(),
  invalidatedBlock: z.boolean().optional(),
}).strict();

// ── Track Session — strict ──
const trackSessionSchema = z.object({
  active: z.boolean(),
  trackNumber: z.number().int().min(0),
  capacity: z.number().int().min(1).max(100),
  segmentIds: z.array(z.string()).max(100),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  closedManually: z.boolean(),
  trackStartTime: z.number().nullable().optional(),
}).strict().nullable();

const blockEndPromptSchema = z.object({
  isOpen: z.boolean(),
  trackNumber: z.number().nullable(),
  reason: z.enum(['capacity', 'manual', 'invalidated']),
}).strict();

// ── App State — strict ──
const appStateSchema = z.object({
  route: routeSchema.nullable(),
  incidents: z.array(incidentSchema).max(MAX_INCIDENTS).default([]),
  activeSegmentId: z.string().nullable().default(null),
  navigationActive: z.boolean().default(false),
  currentPosition: latLngSchema.nullable().default(null),
  base: z.object({
    position: latLngSchema,
    label: z.string().max(200),
  }).strict().nullable().default(null),
  rstMode: z.boolean().default(true),
  rstGroupSize: z.number().int().min(1).max(100).default(9),
  trackSession: trackSessionSchema.default(null),
  blockEndPrompt: blockEndPromptSchema.default({ isOpen: false, trackNumber: null, reason: 'capacity' }),
  workDay: z.number().int().min(0).default(1),
  acquisitionMode: z.enum(['RST', 'GARMIN']).default('RST'),
}).strict();

// ── Event Log — real EventType enum ──
const eventTypeEnum = z.enum([
  'CAMPAIGN_IMPORTED',
  'CAMPAIGN_EXPORTED',
  'ROUTE_LOADED',
  'TRACK_OPENED',
  'TRACK_CLOSED',
  'SEGMENT_STARTED',
  'SEGMENT_COMPLETED',
  'SEGMENT_SKIPPED',
  'SEGMENT_RESET',
  'SEGMENT_REPEATED',
  'SEGMENT_CANCELLED',
  'SEGMENT_STATUS_CHANGED',
  'INCIDENT_RECORDED',
  'NAV_STARTED',
  'NAV_STOPPED',
  'WORK_DAY_CHANGED',
  'HW_CONFIRM_F5',
  'HW_CONFIRM_F7',
  'HW_CONFIRM_F9',
  'NAV_STATE_CHANGED',
  'MIGRATION_FROM_LOCALSTORAGE',
]);

const eventSchema = z.object({
  eventId: z.string().min(1).max(200),
  timestamp: isoDateString,
  eventType: eventTypeEnum,
  workDay: z.number().nullable().optional(),
  trackNumber: z.number().nullable().optional(),
  segmentId: z.string().nullable().optional(),
  payload: z.record(z.unknown()).optional(), // payload varies — passthrough-like
}).strict();

export const campaignExportSchema = z.object({
  version: z.literal(1),
  exportedAt: isoDateString,
  appVersion: z.string().max(50),
  state: appStateSchema,
  eventLog: z.array(eventSchema).max(MAX_EVENTS).default([]),
}).strict();

export type ValidatedCampaignExport = z.infer<typeof campaignExportSchema>;

export { MAX_FILE_SIZE_BYTES };
