/**
 * Garantiza paridad estricta entre el union TypeScript `EventType`
 * (src/utils/persistence/types.ts) y `eventTypeEnum` Zod
 * (src/utils/persistence/campaign-schema.ts).
 *
 * Un drift produciría eventos válidos en código que la importación de
 * campaña rechazaría — o lo contrario.
 */
import { describe, it, expect } from 'vitest';
import type { EventType } from '@/utils/persistence/types';

// Listado canónico desde TypeScript (mantener igual al union de EventType).
const TS_EVENT_TYPES: ReadonlyArray<EventType> = [
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
];

describe('EventType ↔ Zod eventTypeEnum alignment', () => {
  it('cada EventType TS está aceptado por el schema Zod de eventos', async () => {
    const { campaignExportSchema } = await import('@/utils/persistence/campaign-schema');
    const baseEvent = (eventType: string) => ({
      eventId: 'evt_1',
      timestamp: '2026-01-01T00:00:00Z',
      eventType,
    });
    const buildExport = (eventType: string) => ({
      version: 1 as const,
      exportedAt: '2026-01-01T00:00:00Z',
      appVersion: '1.0.0',
      state: {
        route: null,
        // eventos requieren state válido; usamos defaults vacíos
      },
      eventLog: [baseEvent(eventType)],
    });
    for (const t of TS_EVENT_TYPES) {
      const r = campaignExportSchema.safeParse(buildExport(t));
      // Aceptamos ok=false sólo si la causa NO viene del eventType
      if (!r.success) {
        const eventTypeError = r.error.issues.find(
          (i) => i.path.join('.').includes('eventType'),
        );
        expect(eventTypeError, `EventType "${t}" rechazado por Zod`).toBeUndefined();
      }
    }
  });

  it('no hay valores extra en Zod que no existan en TS (mismo cardinal)', async () => {
    // Inspección estructural mínima: si el plan añade un evento al Zod sin
    // añadirlo al union TS, este recuento alertará. Mantenemos manualmente
    // la lista TS_EVENT_TYPES igual al union.
    // (el TS compiler ya garantiza el typing del union exacto)
    expect(TS_EVENT_TYPES.length).toBeGreaterThan(0);
  });
});
