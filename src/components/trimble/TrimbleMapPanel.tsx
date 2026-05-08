/**
 * Panel operativo Trimble dentro de MapPage.
 *
 * Solo se monta cuando `acquisitionMode === 'TRIMBLE_LIDAR'`. Sustituye al
 * flujo manual: el tramo a capturar se preselecciona desde la cola operativa
 * (orden real del mapa). El operador puede iniciar/cerrar capturas, marcar
 * repetir / no_capturable y enviar al conductor sin salir del mapa.
 *
 * `/trimble` se mantiene como vista avanzada / emergencia.
 */
import { useMemo, useState } from 'react';
import { useRouteStateContext } from '@/context/RouteStateContext';
import { Button } from '@/components/ui/button';
import { Radar, Play, StopCircle, RotateCcw, Ban, Send, AlertTriangle, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import {
  buildTrimbleRecordingQueue,
  trimbleQueueToStops,
  type TrimbleQueueItem,
} from '@/utils/trimble/recording-queue';
import { buildGoogleMapsBatchUrl, SEGMENTS_PER_BATCH } from '@/utils/google-maps-batch';
import { findActiveCapture, type TrimbleSegmentStatus } from '@/types/trimble';
import type { useCopilotOperator, QueueItem } from '@/hooks/useCopilotSession';

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
  visibleSegmentIds: Set<string>;
  orderIds: string[];
  copilot: ReturnType<typeof useCopilotOperator>;
  onSetActiveSegment: (segmentId: string) => void;
}

export function TrimbleMapPanel({ visibleSegmentIds, orderIds, copilot, onSetActiveSegment }: Props) {
  const {
    state,
    startTrimbleMission, startTrimbleRun,
    startTrimbleCapture, closeTrimbleCapture,
  } = useRouteStateContext();

  const activeMission = state.trimbleMissions.find((m) => m.id === state.activeMissionId) || null;
  const activeRun = state.trimbleRuns.find((r) => r.id === state.activeRunId) || null;
  const activeCapture = useMemo(
    () => findActiveCapture(state.trimbleSegmentCaptures, state.activeRunId),
    [state.trimbleSegmentCaptures, state.activeRunId],
  );

  const { items: queue, skippedNoGeometry } = useMemo(
    () => buildTrimbleRecordingQueue(state, visibleSegmentIds, orderIds, SEGMENTS_PER_BATCH),
    [state, visibleSegmentIds, orderIds],
  );

  const current: TrimbleQueueItem | null = queue[0] ?? null;
  const next = queue.slice(1);

  // ── Acciones rápidas ──────────────────────────────────────────────
  const handleQuickStartMission = () => {
    const r = startTrimbleMission({});
    if (r.ok) toast.success('Misión Trimble abierta.');
    else toast.error(r.reason || 'No se pudo abrir misión.');
  };
  const handleQuickStartRun = () => {
    const r = startTrimbleRun({ direction: 'ida' });
    if (r.ok) toast.success('Pasada abierta.');
    else toast.error(r.reason || 'No se pudo abrir pasada.');
  };
  const handleStartCurrent = () => {
    if (!current) return;
    const r = startTrimbleCapture(current.segment.id);
    if (r.ok) {
      onSetActiveSegment(current.segment.id);
      toast.success(`Captura iniciada: ${current.segment.name}`);
    } else toast.error(r.reason || 'No se pudo iniciar.');
  };
  const handleClose = (status: 'capturado_pendiente_proceso' | 'repetir' | 'no_capturable') => {
    const r = closeTrimbleCapture(status);
    if (!r.ok) { toast.error(r.reason || 'No se pudo cerrar.'); return; }
    toast.success('Captura cerrada.');
    // Avance automático: centra en el siguiente recomendado
    const nextItem = queue.find((q) => q.segment.id !== current?.segment.id);
    if (nextItem) onSetActiveSegment(nextItem.segment.id);
  };

  const handleSendToDriver = async () => {
    if (queue.length === 0) { toast.error('No hay tramos en la cola.'); return; }
    if (!copilot.active || !copilot.session) {
      toast.error('Activa el modo Copiloto para enviar al conductor.');
      return;
    }
    const stops = trimbleQueueToStops(queue);
    const url = buildGoogleMapsBatchUrl(stops);
    const items: QueueItem[] = queue.flatMap((q) => [
      { segmentId: q.segment.id, name: `INICIO · ${q.segment.name}`, lat: q.start.lat, lng: q.start.lng },
      { segmentId: q.segment.id, name: `FIN · ${q.segment.name}`,    lat: q.end.lat,   lng: q.end.lng   },
    ]);
    await copilot.pushQueue(items, 0, url);
    toast.success(`Enviado al conductor: ${queue.length} tramos (${items.length} paradas).`);
  };

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="bg-card/95 backdrop-blur rounded-xl border border-border shadow-lg p-3 space-y-3 max-w-sm pointer-events-auto">
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Radar className="w-4 h-4 text-primary" />
          Trimble · operativo
        </h3>
        <div className="flex items-center gap-1 text-[10px]">
          <span className={`px-2 py-0.5 rounded-full ${activeMission ? 'bg-emerald-500/15 text-emerald-500' : 'bg-muted text-muted-foreground'}`}>
            {activeMission ? `Misión ${activeMission.workDay}` : 'Sin misión'}
          </span>
          <span className={`px-2 py-0.5 rounded-full ${activeRun ? 'bg-emerald-500/15 text-emerald-500' : 'bg-muted text-muted-foreground'}`}>
            {activeRun ? `Pasada #${activeRun.index}` : 'Sin pasada'}
          </span>
        </div>
      </header>

      {!activeMission && (
        <Button onClick={handleQuickStartMission} className="w-full" size="sm">
          <Play className="w-3.5 h-3.5 mr-2" />
          Abrir misión rápida
        </Button>
      )}
      {activeMission && !activeRun && (
        <Button onClick={handleQuickStartRun} className="w-full" size="sm">
          <Play className="w-3.5 h-3.5 mr-2" />
          Abrir pasada (ida)
        </Button>
      )}

      {activeMission && activeRun && (
        <>
          {!current ? (
            <p className="text-xs text-muted-foreground py-2 text-center">
              No hay tramos pendientes en este orden / vista.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="rounded-lg border border-border p-2.5 bg-background/60">
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
                <div className="flex flex-wrap gap-1 mt-2">
                  {!activeCapture || activeCapture.segmentId !== current.segment.id ? (
                    <Button onClick={handleStartCurrent} size="sm" className="flex-1">
                      <Play className="w-3.5 h-3.5 mr-1" />
                      Iniciar captura
                    </Button>
                  ) : (
                    <>
                      <Button onClick={() => handleClose('capturado_pendiente_proceso')} size="sm" className="flex-1">
                        <StopCircle className="w-3.5 h-3.5 mr-1" />
                        Cerrar
                      </Button>
                      <Button onClick={() => handleClose('repetir')} size="sm" variant="outline" className="border-orange-500/40 text-orange-500">
                        <RotateCcw className="w-3.5 h-3.5 mr-1" />
                        Repetir
                      </Button>
                      <Button onClick={() => handleClose('no_capturable')} size="sm" variant="outline" className="border-destructive/40 text-destructive">
                        <Ban className="w-3.5 h-3.5 mr-1" />
                        No cap.
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {next.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] text-muted-foreground px-1">Próximos {next.length}</div>
                  {next.map((q) => (
                    <div key={q.segment.id} className="flex items-center justify-between text-xs px-2 py-1 rounded border border-border/60 bg-background/40">
                      <div className="flex items-center gap-1 min-w-0">
                        <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                        <span className="truncate">{q.segment.name}</span>
                      </div>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${STATUS_BADGE_CLASS[q.status]}`}>
                        {STATUS_LABELS[q.status]}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <Button onClick={handleSendToDriver} variant="outline" size="sm" className="w-full" disabled={queue.length === 0}>
                <Send className="w-3.5 h-3.5 mr-2" />
                Enviar al conductor ({queue.length * 2} paradas)
              </Button>
            </div>
          )}

          {skippedNoGeometry.length > 0 && (
            <div className="text-[10px] text-amber-500 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {skippedNoGeometry.length} tramo(s) sin geometría suficiente
            </div>
          )}
        </>
      )}
    </div>
  );
}
