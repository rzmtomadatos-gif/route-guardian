import { describe, it, expect } from 'vitest';
import { trimbleQueueFingerprint } from '@/utils/trimble/queue-fingerprint';
import type { TrimbleQueueItem } from '@/utils/trimble/recording-queue';

const mk = (id: string, status: TrimbleQueueItem['status']): TrimbleQueueItem =>
  ({
    segment: { id } as any,
    status,
    start: { lat: 0, lng: 0 },
    end: { lat: 1, lng: 1 },
    positionInOrder: 0,
  });

describe('trimbleQueueFingerprint', () => {
  it('vacía → string vacía', () => {
    expect(trimbleQueueFingerprint([])).toBe('');
  });
  it('cambia cuando un tramo cambia de estado', () => {
    const a = trimbleQueueFingerprint([mk('s1', 'pendiente'), mk('s2', 'pendiente')]);
    const b = trimbleQueueFingerprint([mk('s1', 'en_captura'), mk('s2', 'pendiente')]);
    expect(a).not.toBe(b);
  });
  it('cambia cuando el orden cambia', () => {
    const a = trimbleQueueFingerprint([mk('s1', 'pendiente'), mk('s2', 'pendiente')]);
    const b = trimbleQueueFingerprint([mk('s2', 'pendiente'), mk('s1', 'pendiente')]);
    expect(a).not.toBe(b);
  });
  it('estable para la misma cola', () => {
    const a = trimbleQueueFingerprint([mk('s1', 'pendiente'), mk('s2', 'repetir')]);
    const b = trimbleQueueFingerprint([mk('s1', 'pendiente'), mk('s2', 'repetir')]);
    expect(a).toBe(b);
  });
});
