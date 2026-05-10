/**
 * Tests para la regla de fase del registro GPS Trimble:
 *  - phase='capture' SOLO si activeTrimbleRecordingId está presente.
 *  - Si solo hay captura manual abierta (sin recordingId) → phase='transport'.
 *  - El punto enriquece matchedSegmentId cuando está cerca de un tramo.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { AppState, LatLng, Route, Segment } from '@/types/route';
import type { TrimbleGpsPoint, SegmentCapture } from '@/types/trimble';
import { createEmptyCampaignState } from '@/utils/storage';
import { RouteStateProvider } from '@/context/RouteStateContext';
import { useTrimbleGpsLog } from '@/hooks/useTrimbleGpsLog';
import type { ReactNode } from 'react';

type Append = (p: TrimbleGpsPoint) => { ok: boolean; reason?: string };

function buildSeg(id: string, coords: LatLng[]): Segment {
  return {
    id, routeId: 'r', trackNumber: null, plannedTrackNumber: null, trackHistory: [],
    kmlId: id, name: id, notes: '', coordinates: coords,
    direction: 'creciente', type: 'tramo', status: 'pendiente', kmlMeta: {},
  };
}

function makeRoute(): Route {
  return {
    id: 'r', name: 'r', loadedAt: '', fileName: '',
    segments: [
      buildSeg('seg-A', [{ lat: 40.0000, lng: -3.0000 }, { lat: 40.0010, lng: -3.0000 }]),
    ],
    optimizedOrder: ['seg-A'],
  };
}

function makeWrapper(state: Partial<AppState>, append: Append) {
  const base = createEmptyCampaignState();
  const value = {
    state: { ...base, ...state },
    appendTrimbleGpsPoint: append,
  } as unknown as Parameters<typeof RouteStateProvider>[0]['value'];
  return ({ children }: { children: ReactNode }) => (
    <RouteStateProvider value={value}>{children}</RouteStateProvider>
  );
}

const POS_NEAR_A: LatLng = { lat: 40.0005, lng: -3.0000 };

describe('useTrimbleGpsLog — fase y enriquecimiento', () => {
  it('captura manual abierta SIN activeTrimbleRecordingId → phase=transport', () => {
    const cap: SegmentCapture = {
      id: 'c1', segmentId: 'seg-A', runId: 'r1', missionId: 'm1',
      startedAt: '2026-01-01T00:00:00Z', endedAt: null,
      fieldStatus: 'en_captura', qaStatus: null,
    };
    const append = vi.fn<Append>(() => ({ ok: true }));
    const wrapper = makeWrapper({
      acquisitionMode: 'TRIMBLE_LIDAR',
      activeMissionId: 'm1', activeRunId: 'r1',
      activeTrimbleRecordingId: null,
      trimbleSegmentCaptures: [cap],
      route: makeRoute(),
    }, append);

    const { rerender } = renderHook(
      ({ pos }: { pos: LatLng | null }) => useTrimbleGpsLog({ position: pos, accuracy: 5, speed: 0, heading: 0 }),
      { wrapper, initialProps: { pos: null as LatLng | null } },
    );
    act(() => { rerender({ pos: POS_NEAR_A }); });
    expect(append).toHaveBeenCalledTimes(1);
    const sent = append.mock.calls[0][0];
    expect(sent.phase).toBe('transport');
    expect(sent.recordingSessionId).toBeNull();
  });

  it('activeTrimbleRecordingId activo → phase=capture y recordingSessionId', () => {
    const append = vi.fn<Append>(() => ({ ok: true }));
    const wrapper = makeWrapper({
      acquisitionMode: 'TRIMBLE_LIDAR',
      activeMissionId: 'm1', activeRunId: 'r1',
      activeTrimbleRecordingId: 'rec-1',
      route: makeRoute(),
    }, append);

    const { rerender } = renderHook(
      ({ pos }: { pos: LatLng | null }) => useTrimbleGpsLog({ position: pos, accuracy: 5, speed: 0, heading: 0 }),
      { wrapper, initialProps: { pos: null as LatLng | null } },
    );
    act(() => { rerender({ pos: POS_NEAR_A }); });
    const sent = append.mock.calls[0][0];
    expect(sent.phase).toBe('capture');
    expect(sent.recordingSessionId).toBe('rec-1');
  });

  it('punto cerca de un tramo → enriquece matchedSegmentId/distance/progress', () => {
    const append = vi.fn<Append>(() => ({ ok: true }));
    const wrapper = makeWrapper({
      acquisitionMode: 'TRIMBLE_LIDAR',
      activeMissionId: 'm1', activeRunId: 'r1',
      activeTrimbleRecordingId: 'rec-1',
      route: makeRoute(),
    }, append);

    const { rerender } = renderHook(
      ({ pos }: { pos: LatLng | null }) => useTrimbleGpsLog({ position: pos, accuracy: 5, speed: 0, heading: 0 }),
      { wrapper, initialProps: { pos: null as LatLng | null } },
    );
    act(() => { rerender({ pos: POS_NEAR_A }); });
    const sent = append.mock.calls[0][0];
    expect(sent.matchedSegmentId).toBe('seg-A');
    expect(sent.progressOnMatchedSegment).toBeGreaterThan(0);
    expect(sent.progressOnMatchedSegment).toBeLessThan(1);
    expect(sent.distanceToMatchedSegmentMeters).not.toBeNull();
    expect(sent.distanceToMatchedSegmentMeters as number).toBeLessThan(25);
  });
});
