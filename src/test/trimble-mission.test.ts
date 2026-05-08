/**
 * Tests del invariante "una única captura abierta por run" y de la separación
 * field/qa. Trabajamos con reductores puros sobre AppState, sin React.
 */
import { describe, it, expect } from 'vitest';
import type { AppState } from '@/types/route';
import type { SegmentCapture, TrimbleFieldStatus } from '@/types/trimble';
import { findActiveCapture } from '@/types/trimble';
import { createEmptyCampaignState } from '@/utils/storage';

function trimbleReady(): AppState {
  return {
    ...createEmptyCampaignState(),
    acquisitionMode: 'TRIMBLE_LIDAR',
    activeMissionId: 'm1',
    activeRunId: 'r1',
    trimbleMissions: [{ id: 'm1', workDay: 1, startedAt: '2026-01-01T00:00:00Z', endedAt: null }],
    trimbleRuns: [{ id: 'r1', missionId: 'm1', index: 0, startedAt: '2026-01-01T00:00:00Z', endedAt: null }],
  };
}

function tryOpenCapture(s: AppState, segmentId: string): { ok: boolean; reason?: string; next: AppState; id?: string } {
  if (!s.activeRunId) return { ok: false, reason: 'sin run', next: s };
  const open = findActiveCapture(s.trimbleSegmentCaptures, s.activeRunId);
  if (open) return { ok: false, reason: 'ya hay captura abierta', next: s };
  const id = `c_${s.trimbleSegmentCaptures.length + 1}`;
  const cap: SegmentCapture = {
    id, segmentId, runId: s.activeRunId, missionId: s.activeMissionId!,
    startedAt: '2026-01-01T00:00:00Z', endedAt: null,
    fieldStatus: 'en_captura', qaStatus: null,
  };
  return { ok: true, id, next: { ...s, trimbleSegmentCaptures: [...s.trimbleSegmentCaptures, cap] } };
}

function closeOpen(s: AppState, fieldStatus: TrimbleFieldStatus): AppState {
  const open = s.activeRunId ? findActiveCapture(s.trimbleSegmentCaptures, s.activeRunId) : null;
  if (!open) return s;
  const captures = s.trimbleSegmentCaptures.map((c) =>
    c.id === open.id ? { ...c, endedAt: '2026-01-01T00:01:00Z', fieldStatus } : c,
  );
  return { ...s, trimbleSegmentCaptures: captures };
}

describe('Invariante: una única captura abierta por run', () => {
  it('abrir una segunda captura sin cerrar la anterior falla', () => {
    let s = trimbleReady();
    const a = tryOpenCapture(s, 'seg1');
    expect(a.ok).toBe(true);
    s = a.next;
    const b = tryOpenCapture(s, 'seg2');
    expect(b.ok).toBe(false);
    // Estado no muta
    expect(b.next).toBe(s);
    expect(s.trimbleSegmentCaptures.length).toBe(1);
  });

  it('tras cerrar la captura abierta, se puede abrir otra', () => {
    let s = trimbleReady();
    s = tryOpenCapture(s, 'seg1').next;
    s = closeOpen(s, 'capturado_pendiente_proceso');
    const b = tryOpenCapture(s, 'seg2');
    expect(b.ok).toBe(true);
    expect(b.next.trimbleSegmentCaptures.length).toBe(2);
    // Sólo una sigue abierta
    const open = findActiveCapture(b.next.trimbleSegmentCaptures, 'r1');
    expect(open?.segmentId).toBe('seg2');
  });
});

describe('Separación field/qa', () => {
  it('al cerrar desde campo, qaStatus permanece null', () => {
    let s = trimbleReady();
    s = tryOpenCapture(s, 'seg1').next;
    s = closeOpen(s, 'capturado_pendiente_proceso');
    expect(s.trimbleSegmentCaptures[0].qaStatus).toBeNull();
    expect(s.trimbleSegmentCaptures[0].fieldStatus).toBe('capturado_pendiente_proceso');
  });
});
