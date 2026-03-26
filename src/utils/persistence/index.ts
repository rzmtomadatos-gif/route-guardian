/**
 * Public API for the persistence layer.
 */

export { saveStateToDB, loadStateFromDB, clearStateDB, getAllEvents, clearEventsDB, getEventCount } from './db';
export { logEvent } from './event-log';
export { migrateAndLoad } from './migration';
export { exportCampaign, importCampaign } from './campaign-io';
export type { PersistentEvent, EventType, CampaignExport } from './types';
