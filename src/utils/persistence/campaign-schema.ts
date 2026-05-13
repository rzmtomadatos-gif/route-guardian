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
import { EVENT_TYPES, type EventType } from './types';

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
  // Origen OSM (Overpass): identificador OSM, ref y procedencia
  osmId: z.number().optional(),
  ref: z.string().optional(),
  source: z.enum(['osm', 'manual', 'kml']).optional(),
  // Trazabilidad multiparte (KML MultiGeometry / GeoJSON MultiLineString / GeometryCollection)
  multiPartParentName: z.string().max(500).optional(),
  multiPartIndex: z.number().int().min(1).optional(),
  multiPartTotal: z.number().int().min(1).optional(),
  multiPartGeometryType: z.string().max(100).optional(),
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
  client: z.string().max(300).optional(),
  company: z.string().max(300).optional(),
  driver: z.string().max(200).optional(),
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
  workDayAtIncident: z.number().nullable().optional(),
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
  acquisitionMode: z.enum(['RST', 'GARMIN', 'TRIMBLE_LIDAR']).default('RST'),
  lastConsumedTrackByDay: z.record(z.string(), z.number().int().min(0))
    .default({})
    .transform((rec) => {
      // Normalize string keys to numbers (JSON-safe), preserving values.
      const out: Record<number, number> = {};
      for (const [k, v] of Object.entries(rec)) {
        const n = Number(k);
        if (Number.isFinite(n)) out[n] = v;
      }
      return out;
    }),
  segmentCorrections: z.array(z.lazy(() => segmentCorrectionSchema)).max(100_000).default([]),
  trackGpsLogsByDay: z.record(
    z.string(),
    z.record(
      z.string(),
      z.array(z.lazy(() => trackGpsPointSchema)).max(1_000_000),
    ),
  )
    .default({})
    .transform((rec) => {
      // Normaliza claves string→number en ambos niveles (workDay → trackNumber → puntos[]).
      const out: Record<number, Record<number, any[]>> = {};
      for (const [dayKey, byTrack] of Object.entries(rec)) {
        const dayNum = Number(dayKey);
        if (!Number.isFinite(dayNum)) continue;
        const inner: Record<number, any[]> = {};
        for (const [trackKey, points] of Object.entries(byTrack)) {
          const trackNum = Number(trackKey);
          if (!Number.isFinite(trackNum)) continue;
          inner[trackNum] = points;
        }
        out[dayNum] = inner;
      }
      return out;
    }),
  // ── TRIMBLE_LIDAR collections (defaults para campañas RST/Garmin antiguas) ──
  trimbleMissions: z.array(z.lazy(() => trimbleMissionSchema)).max(5_000).default([]),
  trimbleRuns: z.array(z.lazy(() => trimbleRunSchema)).max(50_000).default([]),
  trimbleSegmentCaptures: z.array(z.lazy(() => trimbleCaptureSchema)).max(100_000).default([]),
  trimbleIncidents: z.array(z.lazy(() => trimbleIncidentSchema)).max(10_000).default([]),
  trimbleDeliverables: z.array(z.lazy(() => trimbleDeliverableSchema)).max(50_000).default([]),
  trimbleGpsLogsByRun: z.record(
    z.string(),
    z.array(z.lazy(() => trimbleGpsPointSchema)).max(100_000),
  ).default({}),
  activeMissionId: z.string().nullable().default(null),
  activeRunId: z.string().nullable().default(null),
  trimbleRecordingSessions: z.array(z.lazy(() => trimbleRecordingSessionSchema)).max(50_000).default([]),
  activeTrimbleRecordingId: z.string().nullable().default(null),
  // ── Selección operativa Trimble + overrides (defaults compatibles con campañas antiguas) ──
  trimbleOperationalSelectedSegmentId: z.string().nullable().default(null),
  trimbleSegmentDirectionOverrides: z.record(z.string(), z.enum(['normal', 'reversed'])).default({}),
  trimbleRecordingSegmentOverrides: z.record(
    z.string(),
    z.record(z.string(), z.enum(['force_pending', 'force_captured', 'force_no_capturable'])),
  ).default({}),
}).strict();

const trackGpsPointSchema = z.object({
  timestamp: isoDateString,
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nullable().optional(),
  speed: z.number().nullable().optional(),
  heading: z.number().nullable().optional(),
  workDay: z.number().int().min(0),
  trackNumber: z.number().int().min(0),
  phase: z.enum(['transport', 'recording']),
  segmentId: z.string().nullable().optional(),
  source: z.literal('gps'),
}).strict();

// ── Trimble (dominio paralelo, fase 1) ───────────────────────────────────
const trimbleFieldStatusEnum = z.enum([
  'en_captura', 'capturado_pendiente_proceso', 'repetir', 'no_capturable',
]);
const trimbleQaStatusEnum = z.enum([
  'procesado_ok', 'procesado_con_observaciones', 'descartado_por_calidad',
]);

const trimbleMissionSchema = z.object({
  id: z.string().min(1).max(100),
  workDay: z.number().int().min(0),
  startedAt: isoDateString,
  endedAt: isoDateString.nullable(),
  vehicle: z.string().max(200).optional(),
  sensorRig: z.string().max(200).optional(),
  operator: z.string().max(200).optional(),
  weather: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  closedReason: z.enum(['manual', 'fin_jornada', 'incidencia']).optional(),
}).strict();

const trimbleRunSchema = z.object({
  id: z.string().min(1).max(100),
  missionId: z.string().min(1).max(100),
  index: z.number().int().min(0),
  direction: z.enum(['ida', 'vuelta', 'otro']).optional(),
  startedAt: isoDateString,
  endedAt: isoDateString.nullable(),
  startPosition: latLngSchema.optional(),
  endPosition: latLngSchema.optional(),
  notes: z.string().max(2000).optional(),
  invalidated: z.boolean().optional(),
}).strict();

const trimbleCaptureSchema = z.object({
  id: z.string().min(1).max(100),
  segmentId: z.string().min(1).max(100),
  runId: z.string().min(1).max(100),
  missionId: z.string().min(1).max(100),
  startedAt: isoDateString,
  endedAt: isoDateString.nullable(),
  startPosition: latLngSchema.optional(),
  endPosition: latLngSchema.optional(),
  fieldStatus: trimbleFieldStatusEnum,
  fieldNotes: z.string().max(2000).optional(),
  qaStatus: trimbleQaStatusEnum.nullable(),
  qaNotes: z.string().max(2000).optional(),
  qaReviewedBy: z.string().max(200).optional(),
  qaReviewedAt: isoDateString.optional(),
  captureSource: z.enum(['manual', 'gps_auto']).optional(),
  recordingSessionId: z.string().min(1).max(100).nullable().optional(),
  coverageRatio: z.number().min(0).max(1).nullable().optional(),
  matchedPoints: z.number().int().min(0).nullable().optional(),
}).strict();

const trimbleRecordingSessionSchema = z.object({
  id: z.string().min(1).max(100),
  missionId: z.string().min(1).max(100),
  runId: z.string().min(1).max(100),
  startedAt: isoDateString,
  endedAt: isoDateString.nullable(),
  startPosition: latLngSchema.optional(),
  endPosition: latLngSchema.optional(),
  notes: z.string().max(2000).optional(),
  status: z.enum(['active', 'closed', 'invalidated']).optional(),
  invalidatedAt: isoDateString.nullable().optional(),
  invalidatedReason: z.string().max(2000).nullable().optional(),
}).strict();

/**
 * Normaliza `progressOnMatchedSegment`. Tolerante con builds intermedios:
 *  - 0..1 se mantiene
 *  - 1..100 se interpreta como porcentaje y se divide por 100
 *  - resto se degrada a null (campo auxiliar, no debe bloquear la carga)
 */
const normalizedProgressSchema = z.preprocess((value) => {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value >= 0 && value <= 1) return value;
  if (value > 1 && value <= 100) return value / 100;
  return null;
}, z.number().min(0).max(1).nullable().optional());

/** Normaliza distancias auxiliares no negativas; valores inválidos → null. */
const nonNegativeNullableNumberSchema = z.preprocess((value) => {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0) return null;
  return value;
}, z.number().min(0).nullable().optional());

const trimbleIncidentCategoryEnum = z.enum([
  'gnss_perdida', 'imu_drift', 'oclusion_severa', 'fallo_sensor',
  'fallo_almacenamiento', 'trafico_extremo', 'climatologia',
  'acceso_imposible', 'otro',
]);

const trimbleIncidentSchema = z.object({
  id: z.string().min(1).max(100),
  missionId: z.string().min(1).max(100),
  runId: z.string().min(1).max(100).nullable().optional(),
  segmentId: z.string().min(1).max(100).nullable().optional(),
  category: trimbleIncidentCategoryEnum,
  severity: z.enum(['baja', 'media', 'alta', 'bloqueante']),
  note: z.string().max(2000).optional(),
  timestamp: isoDateString,
  location: latLngSchema.optional(),
  invalidatesRun: z.boolean().optional(),
}).strict();

const trimbleDeliverableSchema = z.object({
  id: z.string().min(1).max(100),
  kind: z.enum([
    'trayectoria', 'nube_puntos', 'imagenes', 'ortho_lane',
    'informe_qa', 'informe_pci_iri', 'csv', 'shp', 'kmz', 'pdf',
    'las', 'tmx', 'otro',
  ]),
  missionId: z.string().min(1).max(100).nullable().optional(),
  runId: z.string().min(1).max(100).nullable().optional(),
  segmentId: z.string().min(1).max(100).nullable().optional(),
  reference: z.string().min(1).max(2000),
  fileName: z.string().max(500).optional(),
  sizeBytes: z.number().int().min(0).optional(),
  hash: z.string().max(200).optional(),
  uploadedBy: z.string().max(200).optional(),
  uploadedAt: isoDateString,
  notes: z.string().max(2000).optional(),
}).strict();

const trimbleGpsPointSchema = z.object({
  timestamp: isoDateString,
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nullable().optional(),
  speed: z.number().nullable().optional(),
  heading: z.number().nullable().optional(),
  missionId: z.string().min(1).max(100),
  runId: z.string().min(1).max(100),
  phase: z.enum(['transport', 'capture']),
  segmentId: z.string().nullable().optional(),
  source: z.literal('gps'),
  recordingSessionId: z.string().min(1).max(100).nullable().optional(),
  matchedSegmentId: z.string().min(1).max(100).nullable().optional(),
  distanceToMatchedSegmentMeters: nonNegativeNullableNumberSchema,
  progressOnMatchedSegment: normalizedProgressSchema,
}).strict();

// ── Event Log — derivado en runtime de EVENT_TYPES (fuente única). ──
// El test src/test/trimble-event-type-alignment.test.ts valida la paridad
// estricta sin listas manuales paralelas.
const eventTypeEnum = z.enum(EVENT_TYPES as unknown as [EventType, ...EventType[]]);

const correctableFieldEnum = z.enum([
  'name', 'notes', 'kmlId', 'companySegmentId', 'direction', 'type',
  'kmlMeta.carretera', 'kmlMeta.identtramo', 'kmlMeta.tipo',
  'kmlMeta.calzada', 'kmlMeta.sentido', 'kmlMeta.pkInicial', 'kmlMeta.pkFinal',
  'workDay', 'trackNumber', 'segmentOrder', 'status',
  'needsRepeat', 'nonRecordable', 'invalidatedByTrack', 'repeatNumber',
]);

const segmentCorrectionSchema = z.object({
  id: z.string().min(1).max(200),
  segmentId: z.string().min(1).max(100),
  field: correctableFieldEnum,
  previousValue: z.unknown(),
  newValue: z.unknown(),
  reason: z.string().max(2000).default(''),
  correctedBy: z.string().max(200).default(''),
  correctedByRole: z.enum(['gabinete', 'admin']),
  correctedAt: isoDateString,
  active: z.boolean(),
  revertedBy: z.string().max(200).optional(),
  revertedAt: isoDateString.optional(),
  revertReason: z.string().max(2000).optional(),
  supersededBy: z.string().max(200).optional(),
}).strict();

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
