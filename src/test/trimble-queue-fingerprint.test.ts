import { describe, it, expect } from 'vitest';
import { trimbleQueueFingerprint, trimbleFingerprintStorageKey } from '@/utils/trimble/queue-fingerprint';
import type { TrimbleQueueItem } from '@/utils/trimble/recording-queue';

const mk = (
  id: string,
  status: TrimbleQueueItem['status'],
  start = { lat: 0, lng: 0 },
  end = { lat: 1, lng: 1 },
): TrimbleQueueItem =>
  ({
    segment: { id } as any,
    status,
    start,
    end,
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
  it('cambia cuando el orden cambia (incluye índice)', () => {
    const a = trimbleQueueFingerprint([mk('s1', 'pendiente'), mk('s2', 'pendiente')]);
    const b = trimbleQueueFingerprint([mk('s2', 'pendiente'), mk('s1', 'pendiente')]);
    expect(a).not.toBe(b);
  });
  it('cambia cuando cambia start o end (geometría operativa)', () => {
    const base = mk('s1', 'pendiente', { lat: 40, lng: -3 }, { lat: 40.1, lng: -3 });
    const startMoved = mk('s1', 'pendiente', { lat: 40.0001, lng: -3 }, { lat: 40.1, lng: -3 });
    const endMoved = mk('s1', 'pendiente', { lat: 40, lng: -3 }, { lat: 40.1001, lng: -3 });
    const a = trimbleQueueFingerprint([base]);
    expect(a).not.toBe(trimbleQueueFingerprint([startMoved]));
    expect(a).not.toBe(trimbleQueueFingerprint([endMoved]));
  });
  it('estable para la misma cola', () => {
    const a = trimbleQueueFingerprint([mk('s1', 'pendiente'), mk('s2', 'repetir')]);
    const b = trimbleQueueFingerprint([mk('s1', 'pendiente'), mk('s2', 'repetir')]);
    expect(a).toBe(b);
  });
});

describe('trimbleFingerprintStorageKey', () => {
  it('cambia con misión, pasada o ruta', () => {
    const k1 = trimbleFingerprintStorageKey('r1', 'm1', 'p1');
    const k2 = trimbleFingerprintStorageKey('r1', 'm2', 'p1');
    const k3 = trimbleFingerprintStorageKey('r1', 'm1', 'p2');
    const k4 = trimbleFingerprintStorageKey('r2', 'm1', 'p1');
    expect(new Set([k1, k2, k3, k4]).size).toBe(4);
  });
  it('mantiene fingerprints aislados entre misiones/pasadas', () => {
    // Mismo fingerprint, distinta clave → no se mezclan en sessionStorage
    const fp = trimbleQueueFingerprint([mk('s1', 'pendiente')]);
    const kA = trimbleFingerprintStorageKey('r1', 'm1', 'p1');
    const kB = trimbleFingerprintStorageKey('r1', 'm1', 'p2');
    expect(kA).not.toBe(kB);
    expect(fp).not.toBe('');
  });
});
