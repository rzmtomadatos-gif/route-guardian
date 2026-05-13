/**
 * Guard del overlay operativo Trimble:
 *  - No renderiza si acquisitionMode !== 'TRIMBLE_LIDAR'
 *  - No renderiza si trimbleOperationalSelectedSegmentId es null
 *  - No renderiza si el id apunta a un tramo inexistente
 *
 * El guard de modo edición/multiselección vive en MapPage (Fase F): allí el
 * overlay solo se monta cuando creationMode === false, selectionMode === false,
 * areaMode === 'none' y zoneSelectMode === 'none'. Aquí cubrimos las defensas
 * internas del propio componente.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { TrimbleSelectedSegmentOverlay } from '@/components/trimble/TrimbleSelectedSegmentOverlay';

const ctx = vi.hoisted(() => ({ value: null as any }));
vi.mock('@/context/RouteStateContext', () => ({
  useRouteStateContext: () => ctx.value,
}));
vi.mock('@/utils/persistence/event-log', () => ({ logEvent: vi.fn(async () => ({})) }));

const seg = (id: string) => ({
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

function makeCtx(state: any) {
  return {
    state,
    setTrimbleOperationalSelected: vi.fn(),
    setTrimbleSegmentDirectionOverride: vi.fn(),
    setTrimbleRecordingSegmentOverride: vi.fn(() => ({ ok: true })),
    voidTrimbleCapturesForSegment: vi.fn(() => 0),
    markTrimbleSegmentManuallyCaptured: vi.fn(() => ({ ok: true })),
  };
}

const baseState = {
  acquisitionMode: 'TRIMBLE_LIDAR',
  trimbleOperationalSelectedSegmentId: 'A',
  route: { id: 'r1', name: 'r', segments: [seg('A')] },
  trimbleSegmentCaptures: [],
  trimbleSegmentDirectionOverrides: {},
  trimbleRecordingSegmentOverrides: {},
  activeRunId: null,
  activeTrimbleRecordingId: null,
};

const props = {
  copilotActive: false,
  copilotSession: null,
  onCopilotPushQueue: vi.fn(async () => {}),
};

beforeEach(() => { ctx.value = null; });
afterEach(() => cleanup());

describe('TrimbleSelectedSegmentOverlay guards', () => {
  it('no renderiza fuera de modo TRIMBLE_LIDAR', () => {
    ctx.value = makeCtx({ ...baseState, acquisitionMode: 'RST' });
    const { queryByTestId } = render(<TrimbleSelectedSegmentOverlay {...props} />);
    expect(queryByTestId('trimble-selected-segment-overlay')).toBeNull();
  });

  it('no renderiza si no hay selección operativa', () => {
    ctx.value = makeCtx({ ...baseState, trimbleOperationalSelectedSegmentId: null });
    const { queryByTestId } = render(<TrimbleSelectedSegmentOverlay {...props} />);
    expect(queryByTestId('trimble-selected-segment-overlay')).toBeNull();
  });

  it('no renderiza si el id seleccionado no existe en route.segments', () => {
    ctx.value = makeCtx({ ...baseState, trimbleOperationalSelectedSegmentId: 'GHOST' });
    const { queryByTestId } = render(<TrimbleSelectedSegmentOverlay {...props} />);
    expect(queryByTestId('trimble-selected-segment-overlay')).toBeNull();
  });
});
