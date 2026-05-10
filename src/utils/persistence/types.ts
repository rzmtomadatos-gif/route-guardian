/**
 * Persistence layer types — SQLite-backed.
 * Schema-versioned for future migrations.
 */

export const DB_NAME = 'vialroute_db';
export const SCHEMA_VERSION = 1;

// Legacy constants kept for migration reference only
export const LEGACY_STORAGE_KEY = 'vialroute_state';
export const LEGACY_MIGRATION_FLAG = 'vialroute_migration_sqlite_done';

/**
 * Fuente runtime ÚNICA de los tipos de evento. Tanto el union TypeScript
 * `EventType` como el `eventTypeEnum` Zod en `campaign-schema.ts` se
 * derivan de esta misma constante: cualquier alta/baja se hace aquí y
 * propaga automáticamente a tipado y validación.
 */
export const EVENT_TYPES = [
  'CAMPAIGN_CREATED',
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
  'SEGMENT_CORRECTION_APPLIED',
  'SEGMENT_CORRECTION_REVERTED',
  'SEGMENT_REACTIVATED_FOR_FIELD',
  'SEGMENT_DUPLICATED',
  'MIGRATION_FROM_LOCALSTORAGE',
  // Trimble (fase 1)
  'TRIMBLE_MISSION_STARTED',
  'TRIMBLE_MISSION_CLOSED',
  'TRIMBLE_RUN_STARTED',
  'TRIMBLE_RUN_CLOSED',
  'TRIMBLE_RUN_INVALIDATED',
  'TRIMBLE_CAPTURE_STARTED',
  'TRIMBLE_CAPTURE_CLOSED',
  'TRIMBLE_CAPTURE_MARKED_PENDING_PROCESS',
  'TRIMBLE_CAPTURE_MARKED_REPEAT',
  'TRIMBLE_CAPTURE_MARKED_NON_CAPTURABLE',
  'TRIMBLE_INCIDENT_RECORDED',
  'TRIMBLE_DELIVERABLE_LINKED',
  'TRIMBLE_DELIVERABLE_UNLINKED',
  'TRIMBLE_QA_STATUS_SET',
  'TRIMBLE_MODE_ACTIVATED',
  'TRIMBLE_COPILOT_QUEUE_SENT',
  'TRIMBLE_COPILOT_QUEUE_UPDATED',
  'TRIMBLE_COPILOT_QUEUE_SEND_FAILED',
  'TRIMBLE_COPILOT_QUEUE_AUTO_SENT',
  'TRIMBLE_RECORDING_STARTED',
  'TRIMBLE_RECORDING_CLOSED',
  'TRIMBLE_SEGMENT_AUTO_CAPTURED',
  'TRIMBLE_SEGMENT_PARTIAL_COVERAGE',
  'TRIMBLE_CURRENT_SEGMENT_DETECTED',
] as const;

export type EventType = typeof EVENT_TYPES[number];

export interface PersistentEvent {
  eventId: string;
  timestamp: string; // ISO 8601
  eventType: EventType;
  workDay?: number;
  trackNumber?: number;
  segmentId?: string;
  payload?: Record<string, unknown>;
}

export interface CampaignExport {
  version: 1;
  exportedAt: string;
  appVersion: string;
  state: import('@/types/route').AppState;
  eventLog: PersistentEvent[];
}
