/**
 * Verifica que MapControlPanel actúa como router puro:
 * - En modo TRIMBLE_LIDAR renderiza el panel Trimble (sin botones RST/Garmin).
 * - En RST/GARMIN renderiza el panel clásico.
 * - Cambiar de un modo a otro y volver no rompe React (no viola hooks rules).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MapControlPanel } from '@/components/MapControlPanel';

vi.mock('@/context/RouteStateContext', () => ({
  useRouteStateContext: () => ({
    state: {
      route: { id: 'r1', segments: [] },
      trimbleMissions: [],
      trimbleRuns: [],
      trimbleSegmentCaptures: [],
      trimbleIncidents: [],
      trimbleDeliverables: [],
      trimbleGpsLogsByRun: {},
      activeMissionId: null,
      activeRunId: null,
    },
    startTrimbleMission: vi.fn(() => ({ ok: true })),
    closeTrimbleMission: vi.fn(() => ({ ok: true })),
    startTrimbleRun: vi.fn(() => ({ ok: true })),
    closeTrimbleRun: vi.fn(() => ({ ok: true })),
    startTrimbleCapture: vi.fn(() => ({ ok: true })),
    closeTrimbleCapture: vi.fn(() => ({ ok: true })),
  }),
}));

const noop: any = () => {};
const asyncNoop: any = async () => {};

const baseProps = {
  segments: [],
  optimizedOrder: [],
  activeSegmentId: null,
  gpsEnabled: false,
  currentPosition: null,
  gpsAccuracy: null,
  gpsSpeed: null,
  gpsError: null,
  navigationActive: false,
  base: null,
  rstMode: false,
  rstGroupSize: 9,
  trackSession: null,
  workDay: 1,
  onToggleGps: noop,
  onConfirmStart: noop,
  onComplete: noop,
  onResetSegment: noop,
  onAddIncident: noop,
  onRepeatSegment: noop,
  onReoptimize: noop,
  onStartNavigation: noop,
  onStopNavigation: noop,
  onExportToGoogleMaps: noop,
  onSegmentSelect: noop,
  onSetBase: noop,
  selectedSegmentIds: new Set<string>(),
  onSelectedSegmentsChange: noop,
  onMergeSegments: noop,
  onSetRstMode: noop,
  onSetRstGroupSize: noop,
  onFinalizeTrack: noop,
  onSkipSegment: noop,
  onChangeWorkDay: noop,
  acquisitionMode: 'RST' as const,
  onSetAcquisitionMode: noop,
  copilotSession: null,
  copilotActive: false,
  onCopilotStart: asyncNoop,
  onCopilotEnd: asyncNoop,
};

describe('MapControlPanel router', () => {
  it('cambiar RST → TRIMBLE_LIDAR → RST no lanza error', () => {
    const { rerender, container } = render(
      <MapControlPanel {...baseProps} acquisitionMode="RST" />,
    );
    expect(container.textContent).not.toContain('Trimble · operativo');

    rerender(<MapControlPanel {...baseProps} acquisitionMode="TRIMBLE_LIDAR" />);
    expect(container.textContent).toContain('Trimble · operativo');

    rerender(<MapControlPanel {...baseProps} acquisitionMode="RST" />);
    expect(container.textContent).not.toContain('Trimble · operativo');
    cleanup();
  });

  it('en RST no muestra controles Trimble (Abrir misión)', () => {
    const { container } = render(
      <MapControlPanel {...baseProps} acquisitionMode="RST" />,
    );
    expect(container.textContent).not.toContain('Abrir misión');
    cleanup();
  });
});
