/**
 * Voided captures (voidedAt != null) deben quedar fuera de toda lógica
 * derivada (status, summary, queue) pero conservarse en el array para
 * trazabilidad/export técnico.
 */
import { describe, it, expect } from 'vitest';
import { deriveTrimbleSegmentStatus, buildTrimbleRecordingQueue } from '@/utils/trimble/recording-queue';
import { buildTrimbleSegmentSummary } from '@/utils/trimble/segment-summary';
import { findActiveCapture, isCaptureActive } from '@/types/trimble';
import type { SegmentCapture } from '@/types/trimble';
import type { AppState, Segment } from '@/types/route';

const baseSeg = (id: string): Segment => ({
  id,
  routeId: 'r1',
  trackNumber: null,
  plannedTrackNumber: null,
  trackHistory: [],
  kmlId: '',
  name: id,
  notes: '',
  coordinates: [{ lat: 40, lng: -3 }, { lat: 40.001, lng: -3.001 }],
  direction: 'creciente',
  type: 'tramo',
  status: 'pendiente',
  kmlMeta: {},
});

const cap = (over: Partial<SegmentCapture> = {}): SegmentCapture => ({
  id: 'c1',
  segmentId: 's1',
  runId: 'run1',
  missionId: 'm1',
  startedAt: '2025-01-01T10:00:00Z',
  endedAt: '2025-01-01T10:10:00Z',
  fieldStatus: 'capturado_pendiente_proceso',
  qaStatus: null,
  ...over,
});

describe('voided captures filter', () => {
  it('isCaptureActive(): voidedAt != null → false', () => {
    expect(isCaptureActive(cap())).toBe(true);
    expect(isCaptureActive(cap({ voidedAt: '2025-01-01T11:00:00Z' }))).toBe(false);
  });

  it('deriveTrimbleSegmentStatus ignora capturas voided', () => {
    const captures: SegmentCapture[] = [
      cap({ id: 'c-void', voidedAt: '2025-01-01T11:00:00Z', voidedBy: 'operator', voidedReason: 'corrección' }),
    ];
    expect(deriveTrimbleSegmentStatus('s1', captures, null)).toBe('pendiente');
  });

  it('findActiveCapture ignora capturas open pero voided', () => {
    const captures: SegmentCapture[] = [
      cap({ id: 'open-voided', endedAt: null, voidedAt: '2025-01-01T11:00:00Z', voidedBy: 'operator' }),
    ];
    expect(findActiveCapture(captures, 'run1')).toBeNull();
  });

  it('buildTrimbleSegmentSummary no cuenta voided como intento', () => {
    const captures: SegmentCapture[] = [
      cap({ id: 'c-good' }),
      cap({ id: 'c-void', voidedAt: '2025-01-01T11:00:00Z', voidedBy: 'operator' }),
    ];
    const sum = buildTrimbleSegmentSummary('s1', captures, [], [], []);
    expect(sum.attempts).toBe(1);
  });

  it('buildTrimbleRecordingQueue: tramo con captura voided vuelve a pendiente y aparece en cola', () => {
    const seg = baseSeg('s1');
    const captures: SegmentCapture[] = [
      cap({ id: 'c-void', voidedAt: '2025-01-01T11:00:00Z', voidedBy: 'operator' }),
    ];
    const state = {
      route: { id: 'r1', name: 'r', loadedAt: '2025-01-01T00:00:00Z', fileName: 'r.kml', segments: [seg], optimizedOrder: [seg.id] },
      trimbleSegmentCaptures: captures,
      activeRunId: null,
    } as unknown as AppState;
    const result = buildTrimbleRecordingQueue(state, new Set([seg.id]), [seg.id]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].status).toBe('pendiente');
  });
});
