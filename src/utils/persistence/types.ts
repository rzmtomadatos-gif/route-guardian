/**
 * Persistence layer types — Phase 1
 * Schema-versioned for future migrations.
 */

export const DB_NAME = 'vialroute_db';
export const DB_VERSION = 1;
export const STORE_STATE = 'app_state';
export const STORE_EVENTS = 'event_log';
export const STATE_KEY = 'current'; // single-row key for AppState

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
