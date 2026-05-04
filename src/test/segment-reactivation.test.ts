import { describe, it, expect } from 'vitest';
import { applyReactivation } from '@/utils/segment-reactivation';
import type { AppState, Segment } from '@/types/route';

function mkSeg(over: Partial<Segment> = {}): Segment {
  return {
    id: 's1', routeId: 'r1', kmlId: 'K', name: 'T1', notes: '',
    coordinates: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }],
    direction: 'creciente', type: 'tramo', status: 'pendiente',
    trackNumber: null, plannedTrackNumber: null, trackHistory: [],
    kmlMeta: {}, ...over,
  };
}

function mkState(segs: Segment[]): AppState {
  return {
    route: { id: 'r1', name: 'R', segments: segs, optimizedOrder: segs.map((s) => s.id), availableLayers: [] },
    incidents: [], navigationActive: false, activeSegmentId: null, base: null,
    rstMode: false, rstGroupSize: 9, trackSession: null, workDay: 1,
    blockEndPrompt: { open: false, reason: 'capacity' }, acquisitionMode: 'rst',
    segmentCorrections: [], trackGpsLogsByDay: {},
  } as unknown as AppState;
}

describe('applyReactivation', () => {
  it('reactivates a nonRecordable segment to pendiente without losing history', () => {
    const seg = mkSeg({
      status: 'completado', nonRecordable: true, needsRepeat: false,
      trackNumber: 3, segmentOrder: 2, workDay: 1,
      trackHistory: [3], companySegmentId: 'MAD_001',
      startedAt: '2026-01-01T10:00:00Z', endedAt: '2026-01-01T10:05:00Z',
    });
    const state = mkState([seg]);
    const { state: next, changed, previousSnapshot } = applyReactivation(state, 's1', {
      targetWorkDay: 18, reason: 'corte despejado',
    });
    expect(changed).toBe(true);
    expect(previousSnapshot?.previousNonRecordable).toBe(true);
    const out = next.route!.segments[0];
    expect(out.status).toBe('pendiente');
    expect(out.nonRecordable).toBe(false);
    expect(out.needsRepeat).toBe(true);
    expect(out.workDay).toBe(18);
    expect(out.trackNumber).toBeNull();
    expect(out.segmentOrder).toBeUndefined();
    expect(out.startedAt).toBeNull();
    expect(out.endedAt).toBeNull();
    expect(out.trackHistory).toEqual([3]);
    expect(out.companySegmentId).toBe('MAD_001');
  });

  it('preserves trackHistory and companySegmentId when reactivating completed', () => {
    const seg = mkSeg({ status: 'completado', trackHistory: [1, 2], companySegmentId: 'X' });
    const { state: next } = applyReactivation(mkState([seg]), 's1', { targetWorkDay: 5, reason: 'rep' });
    expect(next.route!.segments[0].trackHistory).toEqual([1, 2]);
    expect(next.route!.segments[0].companySegmentId).toBe('X');
  });

  it('returns changed=false if segment not found', () => {
    const r = applyReactivation(mkState([mkSeg()]), 'nope', { targetWorkDay: 2, reason: 'x' });
    expect(r.changed).toBe(false);
  });
});
