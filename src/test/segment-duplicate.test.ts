import { describe, it, expect } from 'vitest';
import { applyDuplicate } from '@/utils/segment-duplicate';
import type { AppState, Segment } from '@/types/route';

function mkSeg(over: Partial<Segment> = {}): Segment {
  return {
    id: 's1', routeId: 'r1', kmlId: 'K', name: 'T1', notes: '',
    coordinates: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }],
    direction: 'creciente', type: 'tramo', status: 'completado',
    trackNumber: 2, plannedTrackNumber: null, trackHistory: [2],
    kmlMeta: {}, companySegmentId: 'BOA_009',
    ...over,
  };
}

function mkState(segs: Segment[]): AppState {
  return {
    route: { id: 'r1', name: 'R', segments: segs, optimizedOrder: segs.map((s) => s.id), availableLayers: [] },
    incidents: [], navigationActive: false, activeSegmentId: null, base: null,
    rstMode: false, rstGroupSize: 9, trackSession: null, workDay: 7,
    blockEndPrompt: { open: false, reason: 'capacity' }, acquisitionMode: 'rst',
    segmentCorrections: [], trackGpsLogsByDay: {},
  } as unknown as AppState;
}

describe('applyDuplicate', () => {
  it('creates a new segment with fresh id, undefined companySegmentId, pendiente status, empty trackHistory', () => {
    const state = mkState([mkSeg()]);
    let i = 0;
    const { state: next, records } = applyDuplicate(state, ['s1'], () => `dup${++i}`);
    expect(records).toHaveLength(1);
    expect(records[0].sourceSegmentId).toBe('s1');
    expect(records[0].sourceCompanySegmentId).toBe('BOA_009');
    const dup = next.route!.segments.find((s) => s.id === 'dup1')!;
    expect(dup).toBeDefined();
    expect(dup.companySegmentId).toBeUndefined();
    expect(dup.status).toBe('pendiente');
    expect(dup.trackHistory).toEqual([]);
    expect(dup.trackNumber).toBeNull();
    expect(next.route!.optimizedOrder).toContain('dup1');
  });
});
