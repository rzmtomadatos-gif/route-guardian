/**
 * Overlay operativo se abre para CUALQUIER tramo cargado en route.segments,
 * aunque el tramo no esté en la cola pendiente / fullQueue. Verifica que la
 * selección depende solo de route.segments y de operationalSelectedSegmentId,
 * no del subset elegible para grabación.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { TrimbleSelectedSegmentOverlay } from '@/components/trimble/TrimbleSelectedSegmentOverlay';

const ctx = vi.hoisted(() => ({ value: null as any }));
vi.mock('@/context/RouteStateContext', () => ({
  useRouteStateContext: () => ctx.value,
}));
vi.mock('@/utils/persistence/event-log', () => ({ logEvent: vi.fn(async () => ({})) }));

const seg = (id: string, name = id) => ({
  id,
  routeId: 'r1',
  trackNumber: null,
  plannedTrackNumber: null,
  trackHistory: [],
  kmlId: '',
  name,
  notes: '',
  coordinates: [{ lat: 40, lng: -3 }, { lat: 40.001, lng: -3.001 }],
  direction: 'creciente',
  type: 'tramo',
  status: 'pendiente',
  kmlMeta: {},
});

beforeEach(() => { ctx.value = null; });
afterEach(() => cleanup());

describe('TrimbleSelectedSegmentOverlay — abre para cualquier tramo cargado', () => {
  it('renderiza para un tramo que NO está en la cola operativa pero sí en route.segments', () => {
    ctx.value = {
      state: {
        acquisitionMode: 'TRIMBLE_LIDAR',
        // El seleccionado "OFF_QUEUE" no estaría jamás en una fullQueue activa,
        // pero sigue siendo un tramo cargado del proyecto.
        trimbleOperationalSelectedSegmentId: 'OFF_QUEUE',
        route: { id: 'r1', name: 'r', segments: [seg('Q1'), seg('Q2'), seg('OFF_QUEUE', 'Tramo fuera de cola')] },
        trimbleSegmentCaptures: [],
        trimbleSegmentDirectionOverrides: {},
        trimbleRecordingSegmentOverrides: {},
        activeRunId: null,
        activeTrimbleRecordingId: null,
      },
      setTrimbleOperationalSelected: vi.fn(),
      setTrimbleSegmentDirectionOverride: vi.fn(),
      setTrimbleRecordingSegmentOverride: vi.fn(() => ({ ok: true })),
      voidTrimbleCapturesForSegment: vi.fn(() => 0),
      markTrimbleSegmentManuallyCaptured: vi.fn(() => ({ ok: true })),
    };
    const { getByTestId, getByText } = render(
      <TrimbleSelectedSegmentOverlay
        copilotActive={false}
        copilotSession={null}
        onCopilotPushQueue={vi.fn(async () => {})}
      />,
    );
    expect(getByTestId('trimble-selected-segment-overlay')).toBeTruthy();
    expect(getByText('Tramo fuera de cola')).toBeTruthy();
  });
});
