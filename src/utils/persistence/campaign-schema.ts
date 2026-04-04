/**
 * Zod schema for validating campaign JSON imports.
 * Catches corrupted, partial, or malicious campaign files
 * before they enter the persistence layer.
 */
import { z } from 'zod';

const MAX_SEGMENTS = 50_000;
const MAX_EVENTS = 500_000;
const MAX_INCIDENTS = 10_000;
const MAX_COORDINATES_PER_SEGMENT = 100_000;
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const segmentKmlMetaSchema = z.object({
  carretera: z.string().optional(),
  identtramo: z.string().optional(),
  tipo: z.string().optional(),
  calzada: z.string().optional(),
  sentido: z.string().optional(),
  pkInicial: z.string().optional(),
  pkFinal: z.string().optional(),
}).passthrough();

const segmentSchema = z.object({
  id: z.string().min(1).max(100),
  routeId: z.string().min(1).max(100),
  trackNumber: z.number().nullable(),
  plannedTrackNumber: z.number().nullable(),
  trackHistory: z.array(z.number()).max(1000).default([]),
  kmlId: z.string().max(500).default(''),
  name: z.string().min(1).max(500),
  notes: z.string().max(5000).default(''),
  coordinates: z.array(latLngSchema).min(2).max(MAX_COORDINATES_PER_SEGMENT),
  direction: z.enum(['creciente', 'ambos']),
  type: z.enum(['tramo', 'rotonda']),
  status: z.enum(['pendiente', 'en_progreso', 'completado', 'posible_repetir']),
  kmlMeta: segmentKmlMetaSchema,
  layer: z.string().optional(),
  color: z.string().optional(),
  companySegmentId: z.string().max(100).optional(),
  workDay: z.number().int().min(0).optional(),
  segmentOrder: z.number().int().min(0).optional(),
  nonRecordable: z.boolean().optional(),
  needsRepeat: z.boolean().optional(),
  repeatNumber: z.number().int().min(0).optional(),
}).passthrough();

const routeSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(500),
  loadedAt: z.string(),
  fileName: z.string().min(1).max(500),
  segments: z.array(segmentSchema).min(1).max(MAX_SEGMENTS),
  optimizedOrder: z.array(z.string()).max(MAX_SEGMENTS),
  projectCode: z.string().max(50).optional(),
  projectName: z.string().max(500).optional(),
  operator: z.string().max(200).optional(),
  vehicle: z.string().max(200).optional(),
  weather: z.string().max(500).optional(),
}).passthrough();

const incidentSchema = z.object({
  id: z.string().min(1).max(100),
  segmentId: z.string().min(1).max(100),
  category: z.string().min(1).max(100),
  impact: z.enum(['informativa', 'critica_no_grabable', 'critica_invalida_bloque']),
  note: z.string().max(2000).optional(),
  timestamp: z.string(),
  location: latLngSchema.optional(),
}).passthrough();

const trackSessionSchema = z.object({
  active: z.boolean(),
  trackNumber: z.number().int().min(0),
  capacity: z.number().int().min(1).max(100),
  segmentIds: z.array(z.string()).max(100),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  closedManually: z.boolean(),
}).passthrough().nullable();

const blockEndPromptSchema = z.object({
  isOpen: z.boolean(),
  trackNumber: z.number().nullable(),
  reason: z.enum(['capacity', 'manual']),
});

const appStateSchema = z.object({
  route: routeSchema.nullable(),
  incidents: z.array(incidentSchema).max(MAX_INCIDENTS).default([]),
  activeSegmentId: z.string().nullable().default(null),
  navigationActive: z.boolean().default(false),
  currentPosition: latLngSchema.nullable().default(null),
  base: z.object({
    position: latLngSchema,
    label: z.string().max(200),
  }).nullable().default(null),
  rstMode: z.boolean().default(true),
  rstGroupSize: z.number().int().min(1).max(100).default(9),
  trackSession: trackSessionSchema.default(null),
  blockEndPrompt: blockEndPromptSchema.default({ isOpen: false, trackNumber: null, reason: 'capacity' }),
  workDay: z.number().int().min(0).default(1),
  acquisitionMode: z.enum(['RST', 'GARMIN']).default('RST'),
}).passthrough();

const eventSchema = z.object({
  eventId: z.string().min(1).max(200),
  timestamp: z.string(),
  eventType: z.string().min(1).max(100),
  workDay: z.number().optional(),
  trackNumber: z.number().optional(),
  segmentId: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
}).passthrough();

export const campaignExportSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  appVersion: z.string().max(50),
  state: appStateSchema,
  eventLog: z.array(eventSchema).max(MAX_EVENTS).default([]),
});

export type ValidatedCampaignExport = z.infer<typeof campaignExportSchema>;

export { MAX_FILE_SIZE_BYTES };
