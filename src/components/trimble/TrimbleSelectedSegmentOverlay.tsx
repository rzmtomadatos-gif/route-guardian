/**
 * Overlay arriba‑izquierda del mapa para el tramo operativamente seleccionado
 * en modo TRIMBLE_LIDAR. Ofrece acciones manuales sin tocar la geometría:
 *  - Enviar al copiloto este tramo
 *  - Marcar como NO grabable
 *  - Volver a pendiente (anula gps_auto si hay grabación activa)
 *  - Marcar como capturado manualmente
 *  - Invertir sentido operativo (override no destructivo)
 *  - Deseleccionar
 *
 * Visible para cualquier tramo cargado y visible en TRIMBLE_LIDAR; queda
 * oculto en otros modos o cuando el usuario está editando / multi‑seleccionando.
 */
import { useMemo } from 'react';
import { Send, Ban, RotateCcw, Check, ArrowLeftRight, X, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useRouteStateContext } from '@/context/RouteStateContext';
import { buildSingleSegmentSendPayload } from '@/utils/trimble/single-segment-send';
import { deriveTrimbleSegmentStatus } from '@/utils/trimble/recording-queue';
import { hasNearbyParallelCoverage } from '@/utils/trimble/parallel-coverage';
import { logEvent } from '@/utils/persistence/event-log';
import type { CopilotSendResult, CopilotSession, QueueItem } from '@/hooks/useCopilotSession';

interface Props {
  copilotActive: boolean;
  copilotSession: CopilotSession | null;
  onCopilotPushQueue: (items: QueueItem[], cursor: number, batchUrl?: string) => Promise<CopilotSendResult>;
  onActivateCopilotCta?: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  pendiente: 'Pendiente',
  en_captura: 'En captura',
  capturado_pendiente_proceso: 'Capturado',
  procesado_ok: 'OK',
  procesado_con_observaciones: 'OK c/notas',
  repetir: 'Repetir',
  no_capturable: 'No grabable',
  descartado_por_calidad: 'Descartado',
};

export function TrimbleSelectedSegmentOverlay({
  copilotActive,
  copilotSession,
  onCopilotPushQueue,
  onActivateCopilotCta,
}: Props) {
  const ctx = useRouteStateContext();
  const { state } = ctx;

  if (state.acquisitionMode !== 'TRIMBLE_LIDAR') return null;
  const segId = state.trimbleOperationalSelectedSegmentId;
  if (!segId) return null;

  const segment = useMemo(
    () => state.route?.segments.find((s) => s.id === segId) ?? null,
    [state.route, segId],
  );
  if (!segment) return null;

  const directionOverride = state.trimbleSegmentDirectionOverrides?.[segId];
  const reversed = directionOverride === 'reversed';
  const status = deriveTrimbleSegmentStatus(segId, state.trimbleSegmentCaptures ?? [], state.activeRunId);
  const recordingActive = !!state.activeTrimbleRecordingId;
  const recOverride = recordingActive
    ? state.trimbleRecordingSegmentOverrides?.[state.activeTrimbleRecordingId!]?.[segId]
    : undefined;

  const liveItems = useMemo(() => {
    const captures = state.trimbleSegmentCaptures ?? [];
    const runId = state.activeRunId;
    if (!runId) return [] as Array<{ segmentId: string; state: string }>;
    return captures
      .filter((c) => c.runId === runId && c.voidedAt == null)
      .map((c) => ({ segmentId: c.segmentId, state: 'live_covered' as const }));
  }, [state.trimbleSegmentCaptures, state.activeRunId]);
  const hasParallel = useMemo(
    () => recordingActive && state.route ? hasNearbyParallelCoverage(segId, state.route.segments, liveItems) : false,
    [recordingActive, state.route, segId, liveItems],
  );

  const handleSend = async () => {
    if (!copilotActive || !copilotSession) {
      if (onActivateCopilotCta) onActivateCopilotCta();
      else toast.error('Activa el modo Copiloto para enviar al conductor.');
      return;
    }
    const payload = buildSingleSegmentSendPayload(segment, directionOverride);
    if (!payload) {
      toast.error('Geometría insuficiente para enviar.');
      return;
    }
    try {
      await onCopilotPushQueue(payload.items, 0, payload.batchUrl);
      toast.success(reversed ? 'Enviado (sentido invertido)' : 'Enviado al conductor');
      void logEvent('TRIMBLE_COPILOT_SINGLE_SEGMENT_SENT', {
        segmentId: segment.id,
        payload: { reversed, fromLat: payload.effectiveStart.lat, fromLng: payload.effectiveStart.lng },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Error enviando: ${msg}`);
      void logEvent('TRIMBLE_COPILOT_SINGLE_SEGMENT_SEND_FAILED', {
        segmentId: segment.id,
        payload: { error: msg, reversed },
      });
    }
  };

  const handleResetPending = () => {
    if (recordingActive) {
      const r = ctx.setTrimbleRecordingSegmentOverride(segment.id, 'force_pending');
      if (!r.ok) toast.error(r.reason || 'No se pudo aplicar.');
      else toast.message('Marcado pendiente para esta grabación.');
    } else {
      const n = ctx.voidTrimbleCapturesForSegment(segment.id, 'manual_reset_pending', 'operator');
      toast.message(n > 0 ? `Volver a pendiente: ${n} captura(s) anuladas.` : 'Sin capturas activas que anular.');
    }
  };

  const handleNoCapturable = () => {
    if (recordingActive) {
      const r = ctx.setTrimbleRecordingSegmentOverride(segment.id, 'force_no_capturable');
      if (!r.ok) toast.error(r.reason ?? 'No se pudo marcar no grabable.');
      else toast.message('Marcado no grabable (esta grabación).');
    } else {
      // BUG-043: usar función dedicada (no reutilizar markTrimbleSegmentManuallyCaptured,
      // que crearía una falsa captura 'capturado_pendiente_proceso').
      const r = ctx.markTrimbleSegmentNoCapturable(segment.id);
      if (!r.ok) toast.error(r.reason ?? 'No se pudo marcar no grabable.');
      else toast.success('Marcado como no grabable.');
    }
  };

  const handleManualCaptured = () => {
    const r = ctx.markTrimbleSegmentManuallyCaptured(segment.id);
    // BUG-042: mostrar el diagnóstico exacto del estado, sin fallback genérico engañoso.
    if (!r.ok) toast.error(r.reason ?? 'No se pudo marcar capturado manualmente.');
    else toast.success('Marcado capturado manualmente.');
  };

  const handleInvertDirection = () => {
    ctx.setTrimbleSegmentDirectionOverride(segment.id, reversed ? null : 'reversed');
    toast.message(reversed ? 'Sentido restaurado.' : 'Sentido operativo invertido.');
  };

  const handleDeselect = () => {
    ctx.setTrimbleOperationalSelected(null);
  };

  return (
    <div
      data-testid="trimble-selected-segment-overlay"
      className="absolute top-3 left-3 z-30 max-w-[320px] rounded-md border border-border bg-background/95 shadow-md backdrop-blur p-3 text-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Tramo seleccionado</div>
          <div className="font-medium truncate">{segment.name}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Estado: <span className="font-medium">{STATUS_LABEL[status] ?? status}</span>
            {reversed && <span className="ml-2 text-amber-600">↺ invertido</span>}
            {recOverride && <span className="ml-2 text-amber-600">override: {recOverride}</span>}
          </div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Cerrar selección"
          onClick={handleDeselect}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {!copilotActive && (
        <div className="mt-2 flex items-center gap-1 text-xs text-amber-600">
          <AlertTriangle className="h-3 w-3" /> Copiloto inactivo
        </div>
      )}
      {hasParallel && (
        <div className="mt-2 flex items-center gap-1 text-xs text-amber-600" data-testid="trimble-parallel-warning">
          <AlertTriangle className="h-3 w-3" /> Paralelo cercano detectado
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button size="sm" onClick={handleSend} className="col-span-2">
          <Send className="h-4 w-4 mr-1" /> Enviar al copiloto
        </Button>
        <Button size="sm" variant="outline" onClick={handleResetPending}>
          <RotateCcw className="h-4 w-4 mr-1" /> Volver a pendiente
        </Button>
        <Button size="sm" variant="outline" onClick={handleNoCapturable}>
          <Ban className="h-4 w-4 mr-1" /> No grabable
        </Button>
        <Button size="sm" variant="outline" onClick={handleManualCaptured}>
          <Check className="h-4 w-4 mr-1" /> Capturado manual
        </Button>
        <Button size="sm" variant="outline" onClick={handleInvertDirection}>
          <ArrowLeftRight className="h-4 w-4 mr-1" /> Invertir sentido
        </Button>
      </div>
    </div>
  );
}
