/**
 * Public API for the persistence layer.
 * All persistence goes through SQLite. No localStorage dependency.
 */

export { initDatabase, saveStateToDB, loadStateFromDB, clearStateDB, getAllEvents, clearEventsDB, getEventCount, destroyDatabase } from './db';
export { logEvent } from './event-log';
export { migrateAndLoad } from './migration';
export { exportCampaign, importCampaign } from './campaign-io';
export type { PersistentEvent, EventType, CampaignExport } from './types';
