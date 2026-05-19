/**
 * Router puro: NO declara hooks ni estado propio.
 * En modo TRIMBLE_LIDAR → renderiza el panel Trimble.
 * En cualquier otro modo (RST, GARMIN) → renderiza el panel RST/Garmin clásico.
 *
 * Esto evita violar las reglas de React Hooks al cambiar de
 * `acquisitionMode`, ya que cada subcomponente tiene su propia lista
 * estable de hooks.
 */
import type { Segment, LatLng, IncidentCategory, IncidentImpact, BaseLocation, TrackSession, AcquisitionMode } from '@/types/route';
import { TrimbleNavigationPanel } from '@/components/map-control/TrimbleNavigationPanel';
import { RstGarminMapControlPanel } from '@/components/map-control/RstGarminMapControlPanel';
import type { CopilotSendResult, CopilotSession, QueueItem } from '@/hooks/useCopilotSession';

interface Props {
  segments: Segment[];
  optimizedOrder: string[];
  activeSegmentId: string | null;
  gpsEnabled: boolean;
  currentPosition: LatLng | null;
  gpsAccuracy: number | null;
  gpsSpeed: number | null;
  gpsError: string | null;
  navigationActive: boolean;
  base: BaseLocation | null;
  rstMode: boolean;
  rstGroupSize: number;
  trackSession: TrackSession | null;
  workDay: number;
  activeRouteBlock?: string[];
  onToggleGps: (enabled: boolean) => void;
  onConfirmStart: (segmentId: string) => void;
  onComplete: (segmentId: string) => void;
  onResetSegment: (segmentId: string) => void;
  onAddIncident: (segmentId: string, category: IncidentCategory, impact: IncidentImpact, note?: string, location?: LatLng, currentSegmentNonRecordable?: boolean) => void;
  onRepeatSegment: (segmentId: string) => void;
  onReoptimize: () => void;
  onStartNavigation: () => void;
  onStopNavigation: () => void;
  onExportToGoogleMaps: () => void;
  onSegmentSelect: (segmentId: string) => void;
  onSetBase: (base: BaseLocation) => void;
  selectedSegmentIds: Set<string>;
  onSelectedSegmentsChange: (ids: Set<string>) => void;
  onMergeSegments: (ids: string[]) => void;
  onSetRstMode: (enabled: boolean) => void;
  onSetRstGroupSize: (size: number) => void;
  onFinalizeTrack: () => void;
  onSkipSegment: (segmentId: string) => void;
  onChangeWorkDay: (targetDay: number) => void;
  videoEndBlocking?: boolean;
  onVideoEndContinue?: () => void;
  onVideoEndCancel?: () => void;
  blockEndReason?: 'capacity' | 'manual' | 'invalidated';
  acquisitionMode: AcquisitionMode;
  onSetAcquisitionMode: (mode: AcquisitionMode) => void;
  copilotSession: CopilotSession | null;
  copilotActive: boolean;
  onCopilotStart: () => Promise<CopilotSession | null>;
  onCopilotEnd: () => Promise<void>;
  onCopilotGeneratePairing: () => Promise<import('@/hooks/useCopilotSession').PairingInfo | null>;
  onForceSendBatch?: () => void;
  canNavigate?: boolean;
  onReorder?: (id: string, dir: 'up' | 'down') => void;
  onReactivateSegment?: (id: string) => void;
  canCancelStart?: boolean;
  onCancelStart?: () => void;
  /** Trimble: IDs elegibles por capas activas (NO viewport/renderizado). */
  trimbleEligibleSegmentIds: Set<string>;
  trimbleOrderIds: string[];
  onCopilotPushQueue?: (items: QueueItem[], cursor: number, batchUrl?: string) => Promise<CopilotSendResult | void>;
  onOpenAdvancedTrimble?: () => void;
}

export function MapControlPanel(props: Props) {
  if (props.acquisitionMode === 'TRIMBLE_LIDAR') {
    return (
      <TrimbleNavigationPanel
        trimbleEligibleSegmentIds={props.trimbleEligibleSegmentIds}
        orderIds={props.trimbleOrderIds}
        copilotSession={props.copilotSession}
        copilotActive={props.copilotActive}
        onCopilotStart={props.onCopilotStart}
        onCopilotEnd={props.onCopilotEnd}
        onCopilotGeneratePairing={props.onCopilotGeneratePairing}
        onCopilotPushQueue={props.onCopilotPushQueue ?? (async () => {})}
        onSetActiveSegment={props.onSegmentSelect}
        onAddIncident={props.onAddIncident}
        currentPosition={props.currentPosition}
        gpsEnabled={props.gpsEnabled}
        gpsAccuracy={props.gpsAccuracy}
        gpsSpeed={props.gpsSpeed}
        gpsError={props.gpsError}
        onToggleGps={props.onToggleGps}
        onReoptimize={props.onReoptimize}
        onOpenAdvanced={props.onOpenAdvancedTrimble ?? (() => {})}
      />
    );
  }
  return <RstGarminMapControlPanel {...props} />;
}
