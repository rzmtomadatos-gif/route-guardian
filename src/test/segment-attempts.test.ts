import { describe, it, expect } from 'vitest';
import { deriveSegmentAttempts } from '@/utils/gabinete/segment-attempts';
import type { Segment, Incident } from '@/types/route';
import type { PersistentEvent } from '@/utils/persistence/types';

function mkSeg(over: Partial<Segment> = {}): Segment {
  return {
    id: 's1', routeId: 'r1', kmlId: 'K', name: 'T1', notes: '',
    coordinates: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }],
    direction: 'creciente', type: 'tramo', status: 'completado',
    trackNumber: null, plannedTrackNumber: null, trackHistory: [],
    kmlMeta: {}, companySegmentId: 'MAD_001',
    ...over,
  };
}

function evt(eventType: PersistentEvent['eventType'], ts: string, segmentId: string, payload: Record<string, unknown> = {}, extra: Partial<PersistentEvent> = {}): PersistentEvent {
  return {
    id: `${eventType}-${ts}`,
    timestamp: ts,
    eventType,
    segmentId,
    payload,
    ...extra,
  } as PersistentEvent;
}

describe('deriveSegmentAttempts', () => {
  it('Día 1 completado + reactivación Día 18 + STARTED/COMPLETED Día 18 = 2 intentos', () => {
    const seg = mkSeg({ status: 'completado', workDay: 18 });
    const events: PersistentEvent[] = [
      evt('SEGMENT_STARTED', '2026-01-01T10:00:00Z', 's1', { workDay: 1, trackNumber: 1 }),
      evt('SEGMENT_COMPLETED', '2026-01-01T10:05:00Z', 's1', { workDay: 1, trackNumber: 1 }),
      evt('SEGMENT_REACTIVATED_FOR_FIELD', '2026-01-18T08:00:00Z', 's1', { targetWorkDay: 18, reason: 'corte' }),
      evt('SEGMENT_STARTED', '2026-01-18T09:00:00Z', 's1', { workDay: 18, trackNumber: 4 }),
      evt('SEGMENT_COMPLETED', '2026-01-18T09:06:00Z', 's1', { workDay: 18, trackNumber: 4 }),
    ];
    const out = deriveSegmentAttempts(events, [], [seg]);
    expect(out).toHaveLength(2);
    expect(out[0].workDay).toBe(1);
    expect(out[0].status).toBe('completado');
    expect(out[0].source).toBe('field');
    expect(out[1].workDay).toBe(18);
    expect(out[1].status).toBe('completado');
    expect(out[1].source).toBe('gabinete');
    expect(out[1].reason).toBe('corte');
  });

  it('reactivación sin STARTED posterior = fila pendiente source=gabinete', () => {
    const seg = mkSeg({ status: 'completado', workDay: 1 });
    const events: PersistentEvent[] = [
      evt('SEGMENT_STARTED', '2026-01-01T10:00:00Z', 's1', { workDay: 1, trackNumber: 1 }),
      evt('SEGMENT_COMPLETED', '2026-01-01T10:05:00Z', 's1', { workDay: 1, trackNumber: 1 }),
      evt('SEGMENT_REACTIVATED_FOR_FIELD', '2026-01-18T08:00:00Z', 's1', { targetWorkDay: 18, reason: 'pendiente' }),
    ];
    const out = deriveSegmentAttempts(events, [], [seg]);
    expect(out).toHaveLength(2);
    expect(out[1].workDay).toBe(18);
    expect(out[1].status).toBe('pendiente');
    expect(out[1].source).toBe('gabinete');
  });
});
