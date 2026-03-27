/**
 * Persistence layer types — SQLite-backed.
 * Schema-versioned for future migrations.
 */

export const DB_NAME = 'vialroute_db';
export const SCHEMA_VERSION = 1;

// Legacy constants kept for migration reference only
export const LEGACY_STORAGE_KEY = 'vialroute_state';
export const LEGACY_MIGRATION_FLAG = 'vialroute_migration_sqlite_done';

export type EventType =
  | 'APP_STATE_SAVED'
  | 'CAMPAIGN_IMPORTED'
  | 'CAMPAIGN_EXPORTED'
  | 'TRACK_OPENED'
  | 'TRACK_CLOSED'
  | 'SEGMENT_STATUS_CHANGED'
  | 'INCIDENT_RECORDED'
  | 'HW_CONFIRM_F5'
  | 'HW_CONFIRM_F7'
  | 'HW_CONFIRM_F9'
  | 'NAV_STATE_CHANGED'
  | 'MIGRATION_FROM_LOCALSTORAGE';

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
