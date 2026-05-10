/**
 * Panel inferior de navegación cuando `acquisitionMode === 'TRIMBLE_LIDAR'`.
 *
 * Sustituye al panel RST/Garmin: NO se muestran controles RST (F5/F7/F9,
 * bloque, RST mode toggle) ni controles Garmin. Es el único panel operativo
 * en modo Trimble.
 *
 * Sincronización con conductor por fingerprint:
 *   - Calcula `trimbleQueueFingerprint(queue)` cada render.
 *   - Lo compara con `lastSentRef` (persistido en sessionStorage).
 *   - Si difiere y hay copiloto activo → estado "Ruta desactualizada"
 *     (botón en ámbar). Al pulsar enviar, actualiza el fingerprint.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Radar, Play, StopCircle, RotateCcw, Ban, Send, AlertTriangle,
  ChevronRight, ChevronLeft, ChevronUp, ChevronDown, ExternalLink, Radio,
  LocateFixed, LocateOff, Minimize2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useRouteStateContext } from '@/context/RouteStateContext';
import { CopilotPanel } from '@/components/CopilotPanel';
import { IncidentDialog } from '@/components/IncidentDialog';
import {
  buildTrimbleRecordingQueue,
  trimbleQueueToStops,
  type TrimbleQueueItem,
} from '@/utils/trimble/recording-queue';
import { trimbleQueueFingerprint, trimbleFingerprintStorageKey } from '@/utils/trimble/queue-fingerprint';
import { buildGoogleMapsBatchUrl, SEGMENTS_PER_BATCH } from '@/utils/google-maps-batch';
import { findActiveCapture, type TrimbleSegmentStatus } from '@/types/trimble';
import { logEvent } from '@/utils/persistence/event-log';
import type { LatLng, IncidentCategory, IncidentImpact } from '@/types/route';
import type { CopilotSession, QueueItem } from '@/hooks/useCopilotSession';


const STATUS_LABELS: Record<TrimbleSegmentStatus, string> = {
  pendiente: 'Pendiente',
  en_captura: 'En captura',
  capturado_pendiente_proceso: 'Capturado',
  procesado_ok: 'OK',
  procesado_con_observaciones: 'OK c/notas',
  repetir: 'Repetir',
  no_capturable: 'No capturable',
  descartado_por_calidad: 'Descartado',
};

const STATUS_BADGE_CLASS: Record<TrimbleSegmentStatus, string> = {
  pendiente: 'bg-muted text-muted-foreground',
  en_captura: 'bg-amber-500/20 text-amber-500',
  capturado_pendiente_proceso: 'bg-cyan-500/20 text-cyan-500',
  procesado_ok: 'bg-emerald-500/20 text-emerald-500',
  procesado_con_observaciones: 'bg-lime-500/20 text-lime-600',
  repetir: 'bg-orange-500/20 text-orange-500',
  no_capturable: 'bg-zinc-700/40 text-zinc-300',
  descartado_por_calidad: 'bg-destructive/20 text-destructive',
};

interface Props {
  trimbleEligibleSegmentIds: Set<string>;
  orderIds: string[];
  copilotSession: CopilotSession | null;
  copilotActive: boolean;
  onCopilotStart: () => Promise<CopilotSession | null>;
  onCopilotEnd: () => Promise<void>;
  onCopilotPushQueue: (items: QueueItem[], cursor: number, batchUrl?: string) => Promise<void>;
  onSetActiveSegment: (segmentId: string) => void;
  onAddIncident: (segmentId: string, category: IncidentCategory, impact: IncidentImpact, note?: string, location?: LatLng, currentSegmentNonRecordable?: boolean) => void;
  currentPosition: LatLng | null;
  gpsEnabled: boolean;
  gpsAccuracy: number | null;
  gpsSpeed: number | null;
  gpsError: string | null;
  onToggleGps: (enabled: boolean) => void;
  onOpenAdvanced: () => void;
}

export function TrimbleNavigationPanel({
  trimbleEligibleSegmentIds,
  orderIds,
  copilotSession,
  copilotActive,
  onCopilotStart,
  onCopilotEnd,
  onCopilotPushQueue,
  onSetActiveSegment,
  onAddIncident,
  currentPosition,
  gpsEnabled,
  gpsAccuracy,
  gpsSpeed,
  gpsError,
  onToggleGps,
  onOpenAdvanced,
}: Props) {
  const {
    state,
    startTrimbleMission, closeTrimbleMission,
    startTrimbleRun, closeTrimbleRun,
    startTrimbleCapture, closeTrimbleCapture,
  } = useRouteStateContext();

  const [expanded, setExpanded] = useState(true);
  const [collapsedWidth, setCollapsedWidth] = useState<'normal' | 'medio' | 'extremo'>('normal');
  const cycleWidth = () =>
    setCollapsedWidth((w) => (w === 'normal' ? 'medio' : w === 'medio' ? 'extremo' : 'normal'));
  const [runDirection, setRunDirection] = useState<'ida' | 'vuelta' | 'otro'>('ida');

  const activeMission = state.trimbleMissions.find((m) => m.id === state.activeMissionId) || null;
  const activeRun = state.trimbleRuns.find((r) => r.id === state.activeRunId) || null;
  const activeCapture = useMemo(
    () => findActiveCapture(state.trimbleSegmentCaptures ?? [], state.activeRunId),
    [state.trimbleSegmentCaptures, state.activeRunId],
  );

  // Cola operativa COMPLETA Trimble (sin límite). El límite SEGMENTS_PER_BATCH
  // se aplica solo al lote del conductor y a la ventana visible del panel.
  const { items: fullQueue, skippedNoGeometry } = useMemo(
    () => buildTrimbleRecordingQueue(state, trimbleEligibleSegmentIds, orderIds),
    [state, trimbleEligibleSegmentIds, orderIds],
  );

  // Lote del conductor + ventana del panel: primeros SEGMENTS_PER_BATCH (4).
  const driverBatch = useMemo(() => fullQueue.slice(0, SEGMENTS_PER_BATCH), [fullQueue]);
  const remainingAfterBatch = Math.max(0, fullQueue.length - SEGMENTS_PER_BATCH);

  useEffect(() => {
    console.info('[TRIMBLE QUEUE DEBUG]', {
      routeSegments: state.route?.segments.length,
      eligibleIds: trimbleEligibleSegmentIds.size,
      orderIds: orderIds.length,
      fullQueue: fullQueue.length,
      driverBatch: driverBatch.length,
      remainingAfterBatch,
    });
  }, [state.route?.segments.length, trimbleEligibleSegmentIds.size, orderIds.length, fullQueue.length, driverBatch.length, remainingAfterBatch]);

  const current: TrimbleQueueItem | null = driverBatch[0] ?? null;
  const next = driverBatch.slice(1);

  // ── Driver sync fingerprint (scoped por route/mission/run) ──────
  const routeId = state.route?.id ?? null;
  const storageKey = useMemo(
    () => trimbleFingerprintStorageKey(routeId, state.activeMissionId, state.activeRunId),
    [routeId, state.activeMissionId, state.activeRunId],
  );
  const [lastSentFp, setLastSentFp] = useState<string | null>(null);
  // Cargar/resetear fingerprint cuando cambia el scope (campaña/misión/pasada).
  useEffect(() => {
    let v: string | null = null;
    try { v = sessionStorage.getItem(storageKey); } catch {}
    setLastSentFp(v);
  }, [storageKey]);
  // El fingerprint del conductor se calcula sobre el LOTE enviado (4 tramos),
  // no sobre la cola completa: así cuando avanza la cola y el lote cambia,
  // detectamos "Ruta desactualizada" correctamente.
  const currentFp = useMemo(() => trimbleQueueFingerprint(driverBatch), [driverBatch]);
  const driverInSync = copilotActive && lastSentFp === currentFp && currentFp !== '';
  const driverStale = copilotActive && !driverInSync && driverBatch.length > 0;

  const persistFp = (fp: string) => {
    setLastSentFp(fp);
    try { sessionStorage.setItem(storageKey, fp); } catch {}
  };

  // ── Avance tras cerrar captura: efecto basado en cola recalculada ──
  const pendingAdvanceRef = useRef<{ prevSegmentId: string; closeStatus: 'capturado_pendiente_proceso' | 'repetir' | 'no_capturable' } | null>(null);
  useEffect(() => {
    const intent = pendingAdvanceRef.current;
    if (!intent) return;
    pendingAdvanceRef.current = null;
    if (intent.closeStatus === 'repetir') {
      // Mantener activo el mismo tramo (volverá a aparecer como 'repetir' en cola).
      onSetActiveSegment(intent.prevSegmentId);
      return;
    }
    // capturado / no_capturable → siguiente de la cola completa recalculada.
    const next = fullQueue.find((q) => q.segment.id !== intent.prevSegmentId);
    if (next) onSetActiveSegment(next.segment.id);
    else toast.message('Sin tramos pendientes en la cola.');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullQueue]);

  // ── Acciones ──────────────────────────────────────────────────────
  const handleOpenMission = () => {
    const r = startTrimbleMission({});
    if (r.ok) toast.success('Misión Trimble abierta.');
    else toast.error(r.reason || 'No se pudo abrir misión.');
  };
  const handleCloseMission = () => {
    const r = closeTrimbleMission('manual');
    if (r.ok) toast.success('Misión cerrada.');
    else toast.error(r.reason || 'No se pudo cerrar misión.');
  };
  const handleOpenRun = () => {
    const r = startTrimbleRun({ direction: runDirection, startPosition: currentPosition ?? undefined });
    if (r.ok) toast.success(`Pasada (${runDirection}) abierta.`);
    else toast.error(r.reason || 'No se pudo abrir pasada.');
  };
  const handleCloseRun = () => {
    const r = closeTrimbleRun({ endPosition: currentPosition ?? undefined });
    if (r.ok) toast.success('Pasada cerrada.');
    else toast.error(r.reason || 'No se pudo cerrar pasada.');
  };
  const handleStartCurrent = () => {
    if (!current) return;
    const r = startTrimbleCapture(current.segment.id, { startPosition: currentPosition ?? undefined });
    if (r.ok) {
      onSetActiveSegment(current.segment.id);
      toast.success(`Captura iniciada: ${current.segment.name}`);
    } else toast.error(r.reason || 'No se pudo iniciar.');
  };
  const handleClose = (status: 'capturado_pendiente_proceso' | 'repetir' | 'no_capturable') => {
    const prevSegmentId = current?.segment.id ?? activeCapture?.segmentId ?? null;
    const r = closeTrimbleCapture(status, { endPosition: currentPosition ?? undefined });
    if (!r.ok) { toast.error(r.reason || 'No se pudo cerrar.'); return; }
    toast.success('Captura cerrada.');
    if (prevSegmentId) {
      pendingAdvanceRef.current = { prevSegmentId, closeStatus: status };
    }
  };

  const sendToDriver = async () => {
    if (driverBatch.length === 0) { toast.error('No hay tramos en cola.'); return; }
    if (!copilotActive || !copilotSession) {
      toast.error('Activa el modo Copiloto para enviar al conductor.');
      return;
    }
    const stops = trimbleQueueToStops(driverBatch);
    const url = buildGoogleMapsBatchUrl(stops);
    const items: QueueItem[] = driverBatch.flatMap((q) => [
      { segmentId: q.segment.id, name: `INICIO · ${q.segment.name}`, lat: q.start.lat, lng: q.start.lng },
      { segmentId: q.segment.id, name: `FIN · ${q.segment.name}`,    lat: q.end.lat,   lng: q.end.lng   },
    ]);
    const isUpdate = lastSentFp !== null && lastSentFp !== '';
    const baseEventPayload = {
      missionId: state.activeMissionId,
      runId: state.activeRunId,
      fingerprint: currentFp,
      segmentIds: driverBatch.map((q) => q.segment.id),
      stopsCount: items.length,
      autoSend: false,
    };
    try {
      await onCopilotPushQueue(items, 0, url);
      persistFp(currentFp);
      toast.success(`Enviado al conductor: ${driverBatch.length} tramos / ${items.length} paradas.`);
      void logEvent(
        isUpdate ? 'TRIMBLE_COPILOT_QUEUE_UPDATED' : 'TRIMBLE_COPILOT_QUEUE_SENT',
        { workDay: activeMission?.workDay, payload: baseEventPayload },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Error enviando al conductor: ${msg}`);
      void logEvent('TRIMBLE_COPILOT_QUEUE_SEND_FAILED', {
        workDay: activeMission?.workDay,
        payload: { ...baseEventPayload, error: msg },
      });
    }
  };

  // ── Render ────────────────────────────────────────────────────────
  const driverBadge = !copilotActive
    ? { label: 'Copiloto inactivo', cls: 'bg-muted text-muted-foreground' }
    : driverStale
      ? { label: 'Ruta desactualizada', cls: 'bg-amber-500/20 text-amber-500 border border-amber-500/40' }
      : { label: 'Conductor actualizado', cls: 'bg-emerald-500/15 text-emerald-500' };

  const collapsedMaxW =
    collapsedWidth === 'extremo' ? 'max-w-[260px]' :
    collapsedWidth === 'medio' ? 'max-w-[360px]' : '';

  return (
    <div className={`absolute bottom-0 z-20 flex flex-col safe-area-bottom ${expanded ? 'left-0 right-0' : collapsedWidth === 'normal' ? 'left-0 right-0' : 'left-0'}`}>
      {gpsEnabled && currentPosition && (
        <div className="mx-3 mb-1 bg-card/90 backdrop-blur-sm border border-border rounded-lg px-2 py-1 text-[10px] flex items-center gap-2 self-start">
          <LocateFixed className="w-3 h-3 text-accent" />
          {gpsSpeed !== null && <span>{Math.round(gpsSpeed * 3.6)} km/h</span>}
          {gpsAccuracy !== null && <span className="text-muted-foreground">±{Math.round(gpsAccuracy)}m</span>}
        </div>
      )}
      {gpsError && (
        <div className="mx-3 mb-1 bg-destructive/20 border border-destructive/40 rounded-lg px-2 py-1.5 text-[10px] text-destructive self-start max-w-64">
          {gpsError}
        </div>
      )}

      <div className={`bg-card border-t border-border rounded-t-xl ${!expanded ? collapsedMaxW : ''}`}>
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-center py-1 text-muted-foreground"
          aria-label="Expandir/colapsar panel"
        >
          <div className="w-8 h-1 rounded-full bg-muted-foreground/30" />
        </button>

        {/* Header */}
        <div className="px-3 pt-1 pb-2 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Radar className="w-4 h-4 text-primary" />
              Trimble · operativo
            </h3>
            <div className="flex items-center gap-1 text-[10px] flex-wrap justify-end">
              <span className={`px-2 py-0.5 rounded-full ${activeMission ? 'bg-emerald-500/15 text-emerald-500' : 'bg-muted text-muted-foreground'}`}>
                {activeMission ? `Misión D${activeMission.workDay}` : 'Sin misión'}
              </span>
              <span className={`px-2 py-0.5 rounded-full ${activeRun ? 'bg-emerald-500/15 text-emerald-500' : 'bg-muted text-muted-foreground'}`}>
                {activeRun ? `Pasada #${activeRun.index} · ${activeRun.direction ?? 'ida'}` : 'Sin pasada'}
              </span>
              <span className={`px-2 py-0.5 rounded-full ${gpsEnabled ? 'bg-accent/20 text-accent' : 'bg-muted text-muted-foreground'}`}>
                {gpsEnabled ? <LocateFixed className="w-3 h-3 inline" /> : <LocateOff className="w-3 h-3 inline" />}
              </span>
              <span className={`px-2 py-0.5 rounded-full ${driverBadge.cls}`}>{driverBadge.label}</span>
            </div>
          </div>

          {/* Quick actions row */}
          <div className="flex items-center gap-1 flex-wrap">
            <Button
              variant={gpsEnabled ? 'outline' : 'default'}
              size="sm"
              className={`h-9 ${gpsEnabled ? 'border-accent/60 text-accent' : 'bg-primary text-primary-foreground'}`}
              onClick={() => onToggleGps(!gpsEnabled)}
              title={gpsEnabled ? 'GPS activo — desactivar' : 'Activar GPS'}
              data-testid="trimble-gps-toggle-btn"
            >
              {gpsEnabled ? <LocateFixed className="w-4 h-4 mr-1" /> : <LocateOff className="w-4 h-4 mr-1" />}
              {gpsEnabled ? 'GPS activo' : 'Activar GPS'}
            </Button>
            <CopilotPanel session={copilotSession} active={copilotActive} onStart={onCopilotStart} onEnd={onCopilotEnd}>
              <Button variant="outline" size="sm" className={`h-9 ${copilotActive ? 'border-emerald-500/60 text-emerald-500' : ''}`} title="Copiloto">
                <Radio className="w-4 h-4" />
              </Button>
            </CopilotPanel>
            <Button variant="ghost" size="sm" className="h-9" onClick={onOpenAdvanced} title="Vista avanzada Trimble">
              <ExternalLink className="w-4 h-4 mr-1" /> Avanzado
            </Button>
            <Button variant="ghost" size="sm" className="h-9 ml-auto" onClick={cycleWidth} title={`Ancho: ${collapsedWidth}`}>
              <Minimize2 className="w-4 h-4" />
            </Button>
          </div>

          {expanded && (
            <>
              {/* --- Sin misión --- */}
              {!activeMission && (
                <Button onClick={handleOpenMission} className="w-full" size="sm">
                  <Play className="w-4 h-4 mr-2" /> Abrir misión
                </Button>
              )}

              {/* --- Misión sin pasada --- */}
              {activeMission && !activeRun && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1">
                    {(['ida', 'vuelta', 'otro'] as const).map((d) => (
                      <button
                        key={d}
                        onClick={() => setRunDirection(d)}
                        className={`flex-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                          runDirection === d ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    <Button onClick={handleOpenRun} className="flex-1" size="sm">
                      <Play className="w-4 h-4 mr-1" /> Abrir pasada
                    </Button>
                    <Button onClick={handleCloseMission} variant="outline" size="sm" className="border-destructive/40 text-destructive">
                      <StopCircle className="w-4 h-4 mr-1" /> Cerrar misión
                    </Button>
                  </div>
                </div>
              )}

              {/* --- Misión + pasada --- */}
              {activeMission && activeRun && (
                <div className="space-y-2 max-h-[40vh] overflow-y-auto">
                  {!current ? (
                    <p className="text-xs text-muted-foreground py-2 text-center">
                      No hay tramos pendientes/repetir en las capas activas.
                    </p>
                  ) : (
                    <div className="rounded-lg border border-border p-2 bg-background/60 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[10px] text-muted-foreground">Tramo actual</div>
                          <div className="text-sm font-medium truncate">{current.segment.name}</div>
                          {current.segment.companySegmentId && (
                            <div className="text-[10px] text-muted-foreground">{current.segment.companySegmentId}</div>
                          )}
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS_BADGE_CLASS[current.status]}`}>
                          {STATUS_LABELS[current.status]}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {!activeCapture || activeCapture.segmentId !== current.segment.id ? (
                          <Button onClick={handleStartCurrent} size="sm" className="flex-1 bg-primary text-primary-foreground">
                            <Play className="w-4 h-4 mr-1" /> Iniciar captura
                          </Button>
                        ) : (
                          <>
                            <Button onClick={() => handleClose('capturado_pendiente_proceso')} size="sm" className="flex-1 bg-success text-success-foreground">
                              <StopCircle className="w-4 h-4 mr-1" /> Cerrar
                            </Button>
                            <Button onClick={() => handleClose('repetir')} size="sm" variant="outline" className="border-orange-500/40 text-orange-500">
                              <RotateCcw className="w-3.5 h-3.5 mr-1" /> Repetir
                            </Button>
                            <Button onClick={() => handleClose('no_capturable')} size="sm" variant="outline" className="border-zinc-500/40 text-zinc-300">
                              <Ban className="w-3.5 h-3.5 mr-1" /> No cap.
                            </Button>
                          </>
                        )}
                        <IncidentDialog onSubmit={(cat, impact, note, nonRec) => onAddIncident(current.segment.id, cat, impact, note, currentPosition ?? undefined, nonRec)}>
                          <Button size="sm" variant="outline" className="border-destructive/40 text-destructive">
                            <AlertTriangle className="w-4 h-4" />
                          </Button>
                        </IncidentDialog>
                      </div>
                    </div>
                  )}

                  {next.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] text-muted-foreground px-1 flex items-center justify-between">
                        <span>Próximos {next.length}</span>
                        {remainingAfterBatch > 0 && (
                          <span>Pendientes después: {remainingAfterBatch}</span>
                        )}
                      </div>
                      {next.map((q) => (
                        <button
                          key={q.segment.id}
                          onClick={() => onSetActiveSegment(q.segment.id)}
                          className="w-full flex items-center justify-between text-xs px-2 py-1 rounded border border-border/60 bg-background/40 hover:bg-background/80 transition-colors"
                        >
                          <div className="flex items-center gap-1 min-w-0">
                            <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                            <span className="truncate">{q.segment.name}</span>
                          </div>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${STATUS_BADGE_CLASS[q.status]}`}>
                            {STATUS_LABELS[q.status]}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {next.length === 0 && remainingAfterBatch > 0 && (
                    <div className="text-[10px] text-muted-foreground px-1">
                      Pendientes después: {remainingAfterBatch}
                    </div>
                  )}

                  {/* Driver sync block */}
                  <div className={`rounded-lg p-2 border ${driverStale ? 'border-amber-500/40 bg-amber-500/5' : 'border-border bg-background/40'}`}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-[10px] font-medium text-muted-foreground">Conductor</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${driverBadge.cls}`}>{driverBadge.label}</span>
                    </div>
                    <Button
                      onClick={sendToDriver}
                      size="sm"
                      disabled={driverBatch.length === 0 || !copilotActive}
                      data-testid="trimble-send-driver-btn"
                      className={`w-full ${driverStale ? 'bg-amber-500 hover:bg-amber-600 text-white' : ''}`}
                      variant={driverStale ? 'default' : 'outline'}
                    >
                      <Send className="w-4 h-4 mr-2" />
                      {driverStale ? 'Actualizar conductor' : 'Enviar al conductor'}
                      {driverBatch.length > 0 && (
                        <span className="ml-2 text-[10px] opacity-80">
                          {driverBatch.length * 2} paradas / {driverBatch.length} tramos
                        </span>
                      )}
                    </Button>
                  </div>

                  <div className="flex gap-1">
                    <Button onClick={handleCloseRun} variant="outline" size="sm" className="flex-1 border-amber-500/40 text-amber-500">
                      <StopCircle className="w-3.5 h-3.5 mr-1" /> Cerrar pasada
                    </Button>
                    <Button onClick={handleCloseMission} variant="outline" size="sm" className="flex-1 border-destructive/40 text-destructive">
                      <StopCircle className="w-3.5 h-3.5 mr-1" /> Cerrar misión
                    </Button>
                  </div>

                  {skippedNoGeometry.length > 0 && (
                    <div className="text-[10px] text-amber-500 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {skippedNoGeometry.length} tramo(s) sin geometría suficiente
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
