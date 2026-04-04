/**
 * Campaign export / import in JSON format.
 */

import type { AppState } from '@/types/route';
import { saveStateToDB } from './db';
import { getAllEvents, appendEvents } from './db';
import { logEvent } from './event-log';
import type { PersistentEvent } from './types';
import { campaignExportSchema, MAX_FILE_SIZE_BYTES } from './campaign-schema';

const APP_VERSION = '1.1.0';

/**
 * Export the full campaign state + event log as a downloadable JSON file.
 */
export async function exportCampaign(state: AppState): Promise<void> {
  const eventLog = await getAllEvents();

  const data = {
    version: 1 as const,
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
  // ── File size check ──────────────────────────────────────────
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `El archivo es demasiado grande (${(file.size / 1024 / 1024).toFixed(1)} MB). Máximo permitido: ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB.`
    );
  }
  if (file.size === 0) {
    throw new Error('El archivo está vacío.');
  }

  const text = await file.text();
  let rawData: unknown;

  try {
    rawData = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un JSON válido.');
  }

  // ── Schema validation with Zod ───────────────────────────────
  const parseResult = campaignExportSchema.safeParse(rawData);

  if (!parseResult.success) {
    const issues = parseResult.error.issues.slice(0, 5);
    const details = issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : '(raíz)';
        return `• ${path}: ${issue.message}`;
      })
      .join('\n');
    const extra = parseResult.error.issues.length > 5
      ? `\n... y ${parseResult.error.issues.length - 5} errores más.`
      : '';
    throw new Error(`Campaña inválida. Errores encontrados:\n${details}${extra}`);
  }

  const data = parseResult.data;
  const state = data.state as AppState;

  // ── Consistency checks beyond schema ─────────────────────────
  if (!state.route && (!state.incidents || state.incidents.length === 0)) {
    throw new Error('El archivo no contiene datos de ruta ni incidencias.');
  }

  if (state.route) {
    // Verify optimizedOrder references existing segment IDs
    const segmentIds = new Set(state.route.segments.map((s) => s.id));
    const invalidOrderIds = state.route.optimizedOrder.filter((id) => !segmentIds.has(id));
    if (invalidOrderIds.length > 0) {
      console.warn(`[Campaign Import] ${invalidOrderIds.length} IDs in optimizedOrder don't match any segment — rebuilding order.`);
      state.route.optimizedOrder = state.route.segments.map((s) => s.id);
    }

    // Verify incident segmentIds reference existing segments
    if (state.incidents && state.incidents.length > 0) {
      const orphanIncidents = state.incidents.filter((inc) => !segmentIds.has(inc.segmentId));
      if (orphanIncidents.length > 0) {
        console.warn(`[Campaign Import] ${orphanIncidents.length} incidencias referencian tramos inexistentes — se conservan pero podrían no ser visibles.`);
      }
    }
  }

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
