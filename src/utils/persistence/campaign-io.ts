/**
 * Campaign export / import in JSON format.
 */

import type { AppState } from '@/types/route';
import { saveStateToDB } from './db';
import { getAllEvents, appendEvents } from './db';
import { logEvent } from './event-log';
import type { CampaignExport, PersistentEvent } from './types';

const APP_VERSION = '1.1.0';

/**
 * Export the full campaign state + event log as a downloadable JSON file.
 */
export async function exportCampaign(state: AppState): Promise<void> {
  const eventLog = await getAllEvents();

  const data: CampaignExport = {
    version: 1,
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    state,
    eventLog,
  };

  await logEvent('CAMPAIGN_EXPORTED', {
    workDay: state.workDay,
    payload: {
      segmentCount: state.route?.segments?.length ?? 0,
      eventCount: eventLog.length,
    },
  });

  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  const name = state.route?.name?.replace(/[^a-zA-Z0-9_-]/g, '_') || 'campaña';
  a.href = url;
  a.download = `${name}_campaña_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Import a campaign from a JSON file.
 * Returns the imported AppState or throws on validation failure.
 * Does NOT corrupt existing state if validation fails.
 */
export async function importCampaign(file: File): Promise<AppState> {
  const text = await file.text();
  let data: CampaignExport;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un JSON válido.');
  }

  // Validate minimum structure
  if (!data || typeof data !== 'object') {
    throw new Error('Formato de campaña no reconocido.');
  }
  if (data.version !== 1) {
    throw new Error(`Versión de campaña no soportada: ${data.version}`);
  }
  if (!data.state || typeof data.state !== 'object') {
    throw new Error('El archivo no contiene un estado de campaña válido.');
  }

  const state = data.state as AppState;

  // Ensure required fields
  if (!state.route && !state.incidents) {
    throw new Error('El archivo no contiene datos de ruta ni incidencias.');
  }

  // Apply defaults for missing fields
  if (!('trackSession' in state)) (state as any).trackSession = null;
  if (!('blockEndPrompt' in state))
    (state as any).blockEndPrompt = { isOpen: false, trackNumber: null, reason: 'capacity' };
  if (!('workDay' in state)) (state as any).workDay = 1;
  if (!('acquisitionMode' in state)) (state as any).acquisitionMode = 'RST';

  // Persist state
  await saveStateToDB(state);

  // Import event log if present (merge, skip duplicates by eventId)
  if (Array.isArray(data.eventLog) && data.eventLog.length > 0) {
    const existingEvents = await getAllEvents();
    const existingIds = new Set(existingEvents.map((e) => e.eventId));
    const newEvents = (data.eventLog as PersistentEvent[]).filter(
      (e) => e.eventId && !existingIds.has(e.eventId),
    );
    if (newEvents.length > 0) {
      await appendEvents(newEvents);
    }
  }

  // Log import event
  await logEvent('CAMPAIGN_IMPORTED', {
    workDay: state.workDay,
    payload: {
      segmentCount: state.route?.segments?.length ?? 0,
      incidentCount: state.incidents?.length ?? 0,
      importedEvents: data.eventLog?.length ?? 0,
      fromFile: file.name,
    },
  });

  return state;
}
