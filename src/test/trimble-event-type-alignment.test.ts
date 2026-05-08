/**
 * Garantiza paridad estricta entre el union TypeScript `EventType` y el
 * `eventTypeEnum` Zod del esquema de campañas.
 *
 * Ambos derivan en runtime de `EVENT_TYPES` (única fuente de verdad en
 * `src/utils/persistence/types.ts`). Este test compara la lista REAL,
 * no una copia manual paralela: si alguien añade un evento al union
 * pero no al enum (o viceversa) la comparación falla.
 */
import { describe, it, expect } from 'vitest';
import { EVENT_TYPES } from '@/utils/persistence/types';
import { campaignExportSchema } from '@/utils/persistence/campaign-schema';

// Recupera el `eventTypeEnum` recorriendo el shape del schema.
function getZodEventTypes(): readonly string[] {
  // eventLog: array<event>; event.shape.eventType es el ZodEnum.
  const eventLogSchema = (campaignExportSchema as any).shape.eventLog;
  const eventSchema = eventLogSchema._def.innerType.element;
  const eventTypeSchema = eventSchema.shape.eventType;
  return eventTypeSchema._def.values as readonly string[];
}

describe('EventType ↔ Zod eventTypeEnum alignment', () => {
  it('Zod enum y EVENT_TYPES tienen exactamente los mismos valores', () => {
    const zodValues = [...getZodEventTypes()].sort();
    const tsValues = [...EVENT_TYPES].sort();
    expect(zodValues).toEqual(tsValues);
  });

  it('cada EventType de EVENT_TYPES es aceptado por el schema completo', () => {
    for (const t of EVENT_TYPES) {
      const r = campaignExportSchema.safeParse({
        version: 1,
        exportedAt: '2026-01-01T00:00:00Z',
        appVersion: '1.0.0',
        state: { route: null },
        eventLog: [{
          eventId: 'evt_1',
          timestamp: '2026-01-01T00:00:00Z',
          eventType: t,
        }],
      });
      if (!r.success) {
        const eventTypeError = r.error.issues.find(
          (i) => i.path.join('.').includes('eventType'),
        );
        expect(eventTypeError, `EventType "${t}" rechazado por Zod`).toBeUndefined();
      }
    }
  });

  it('un eventType desconocido sí es rechazado (defensa contra drift)', () => {
    const r = campaignExportSchema.safeParse({
      version: 1,
      exportedAt: '2026-01-01T00:00:00Z',
      appVersion: '1.0.0',
      state: { route: null },
      eventLog: [{
        eventId: 'evt_x',
        timestamp: '2026-01-01T00:00:00Z',
        eventType: 'EVENTO_QUE_NO_EXISTE',
      }],
    });
    expect(r.success).toBe(false);
  });
});
