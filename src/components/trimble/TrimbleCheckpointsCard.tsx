/**
 * Tarjeta de checkpoints operativos de misión Trimble.
 *
 * Muestra el estado de los 7 hitos críticos:
 * Precheck / Sistema listo / Hora GPS válida / Misión / Run / Cola estática / Offload.
 *
 * Sólo registra hitos: no procesa nube, no sustituye TBC/POSPac/TMI.
 * "GPS VialRoute" siempre es traza auxiliar de campo, NUNCA trayectoria final.
 */
import { useState } from 'react';
import { useRouteStateContext } from '@/context/RouteStateContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  CheckCircle2, Circle, AlertTriangle, ShieldAlert, ClipboardCheck,
  Satellite, Clock, Square, HardDriveDownload, Play, Radar,
} from 'lucide-react';
import { toast } from 'sonner';

type CheckpointState = 'pending' | 'done' | 'warning' | 'override';

function StateIcon({ s }: { s: CheckpointState }) {
  if (s === 'done') return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (s === 'warning') return <AlertTriangle className="h-4 w-4 text-warning" />;
  if (s === 'override') return <ShieldAlert className="h-4 w-4 text-orange-500" />;
  return <Circle className="h-4 w-4 text-muted-foreground" />;
}

function Row({
  state, icon, label, sub, action,
}: { state: CheckpointState; icon: React.ReactNode; label: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b last:border-b-0 border-border/50">
      <StateIcon s={state} />
      <span className="text-muted-foreground">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{label}</div>
        {sub && <div className="text-[11px] text-muted-foreground truncate">{sub}</div>}
      </div>
      {action}
    </div>
  );
}

export function TrimbleCheckpointsCard() {
  const {
    state,
    completeTrimblePrecheck,
    confirmTrimbleSystemReady,
    confirmTrimbleGpsTimeValid,
    confirmTrimbleStaticTail,
    overrideTrimbleStaticTail,
    markTrimbleDataOffloaded,
  } = useRouteStateContext();

  const inMode = state.acquisitionMode === 'TRIMBLE_LIDAR';
  const mission = state.trimbleMissions.find((m) => m.id === state.activeMissionId) || null;
  const run = state.trimbleRuns.find((r) => r.id === state.activeRunId) || null;

  const [tailDialogOpen, setTailDialogOpen] = useState(false);
  const [tailSeconds, setTailSeconds] = useState('120');
  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [offloadDialogOpen, setOffloadDialogOpen] = useState(false);
  const [offloadRef, setOffloadRef] = useState('');
  const [offloadNotes, setOffloadNotes] = useState('');

  if (!inMode) return null;

  const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString() : undefined);

  const precheckState: CheckpointState = mission?.precheckCompletedAt ? 'done' : (mission ? 'warning' : 'pending');
  const sysReadyState: CheckpointState = mission?.systemReadyAt ? 'done' : (mission ? 'warning' : 'pending');
  const gpsTimeState: CheckpointState = mission?.gpsTimeValidAt ? 'done' : (mission ? 'warning' : 'pending');
  const missionState: CheckpointState = mission ? 'done' : 'pending';
  const runState: CheckpointState = run ? 'done' : (mission ? 'pending' : 'pending');
  const tailState: CheckpointState = mission?.staticTailCompletedAt
    ? (mission.staticTailOverrideReason ? 'override' : 'done')
    : (mission?.endedAt ? 'warning' : 'pending');
  const offloadState: CheckpointState = mission?.dataOffloadedAt ? 'done' : (mission?.endedAt ? 'warning' : 'pending');

  const handle = (res: { ok: boolean; reason?: string }, okMsg: string) => {
    if (res.ok) toast.success(okMsg);
    else toast.error(res.reason ?? 'Error');
  };

  return (
    <>
      <div className="rounded-lg border bg-card p-3 space-y-1">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Checkpoints de misión</h3>
          </div>
          <span className="text-[10px] text-muted-foreground">Bitácora operativa</span>
        </div>

        <Row
          state={precheckState}
          icon={<ClipboardCheck className="h-3.5 w-3.5" />}
          label="Precheck"
          sub={fmt(mission?.precheckCompletedAt)}
          action={mission && !mission.precheckCompletedAt && (
            <Button size="sm" variant="outline" onClick={() => handle(completeTrimblePrecheck({ source: 'field' }), 'Precheck completado')}>
              Completar
            </Button>
          )}
        />
        <Row
          state={sysReadyState}
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          label="Sistema listo"
          sub={fmt(mission?.systemReadyAt)}
          action={mission && !mission.systemReadyAt && (
            <Button size="sm" variant="outline" onClick={() => handle(confirmTrimbleSystemReady({ source: 'field' }), 'Sistema listo confirmado')}>
              Confirmar
            </Button>
          )}
        />
        <Row
          state={gpsTimeState}
          icon={<Satellite className="h-3.5 w-3.5" />}
          label="Hora GPS válida"
          sub={fmt(mission?.gpsTimeValidAt) ?? 'Necesario antes de iniciar pasada'}
          action={mission && !mission.gpsTimeValidAt && (
            <Button size="sm" variant="outline" onClick={() => handle(confirmTrimbleGpsTimeValid({ source: 'field' }), 'Hora GPS válida confirmada')}>
              Confirmar
            </Button>
          )}
        />
        <Row
          state={missionState}
          icon={<Radar className="h-3.5 w-3.5" />}
          label="Misión iniciada"
          sub={fmt(mission?.startedAt)}
        />
        <Row
          state={runState}
          icon={<Play className="h-3.5 w-3.5" />}
          label={run ? `Run #${run.index} activo` : 'Run no iniciado'}
          sub={fmt(run?.startedAt)}
        />
        <Row
          state={tailState}
          icon={<Square className="h-3.5 w-3.5" />}
          label="Cola estática"
          sub={
            mission?.staticTailOverrideReason
              ? `Override: ${mission.staticTailOverrideReason}`
              : (mission?.staticTailSeconds != null ? `${mission.staticTailSeconds}s · ${fmt(mission.staticTailCompletedAt)}` : undefined)
          }
          action={mission && !mission.staticTailCompletedAt && (
            <div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={() => setTailDialogOpen(true)}>Confirmar</Button>
              <Button size="sm" variant="ghost" onClick={() => setOverrideDialogOpen(true)}>No se pudo</Button>
            </div>
          )}
        />
        <Row
          state={offloadState}
          icon={<HardDriveDownload className="h-3.5 w-3.5" />}
          label="Offload de datos"
          sub={mission?.dataOffloadedAt ? `${fmt(mission.dataOffloadedAt)}${mission.offloadRef ? ` · ${mission.offloadRef}` : ''}` : undefined}
          action={mission && !mission.dataOffloadedAt && (
            <Button size="sm" variant="outline" onClick={() => setOffloadDialogOpen(true)}>
              Registrar
            </Button>
          )}
        />

        <div className="mt-2 rounded-md bg-muted/50 p-2 text-[11px] leading-snug text-muted-foreground">
          GPS VialRoute: traza auxiliar de campo, no trayectoria final de gabinete.
          La trayectoria final debe vincularse como entregable procesado externo (TBC/POSPac/SBET).
        </div>
        {mission && !mission.gpsTimeValidAt && !run && (
          <div className="rounded-md bg-warning/10 p-2 text-[11px] text-warning border border-warning/30">
            Aviso: aún no se ha confirmado hora GPS válida.
          </div>
        )}
        {mission?.endedAt && !mission.staticTailCompletedAt && (
          <div className="rounded-md bg-warning/10 p-2 text-[11px] text-warning border border-warning/30">
            Misión cerrada sin cola estática registrada.
          </div>
        )}
      </div>

      {/* Diálogo cola estática */}
      <Dialog open={tailDialogOpen} onOpenChange={setTailDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Confirmar cola estática</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <label className="text-sm">Segundos en estático tras la última grabación</label>
            <Input
              type="number" min={0} value={tailSeconds}
              onChange={(e) => setTailSeconds(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Recomendado mínimo 120s para post-proceso SBET. Si fue inferior, anótalo igualmente.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTailDialogOpen(false)}>Cancelar</Button>
            <Button onClick={() => {
              const n = Number(tailSeconds);
              const r = confirmTrimbleStaticTail({ seconds: n, source: 'field' });
              if (r.ok) { toast.success('Cola estática registrada'); setTailDialogOpen(false); }
              else toast.error(r.reason ?? 'Error');
            }}>
              <Clock className="h-4 w-4 mr-2" />Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo override cola estática */}
      <Dialog open={overrideDialogOpen} onOpenChange={setOverrideDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>No se pudo completar cola estática</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <label className="text-sm">Motivo (obligatorio)</label>
            <Textarea value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOverrideDialogOpen(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => {
              const r = overrideTrimbleStaticTail(overrideReason, { source: 'field' });
              if (r.ok) { toast.success('Override registrado'); setOverrideDialogOpen(false); setOverrideReason(''); }
              else toast.error(r.reason ?? 'Error');
            }}>
              Registrar override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo offload */}
      <Dialog open={offloadDialogOpen} onOpenChange={setOffloadDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Registrar offload de datos</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <label className="text-sm">Referencia externa (NAS, ruta, ID)</label>
            <Input value={offloadRef} onChange={(e) => setOffloadRef(e.target.value)} placeholder="\\\\nas\\trimble\\..." />
            <label className="text-sm">Notas (opcional)</label>
            <Textarea value={offloadNotes} onChange={(e) => setOffloadNotes(e.target.value)} rows={2} />
            <p className="text-[11px] text-muted-foreground">
              No se almacenan binarios. Sólo se guarda la referencia para trazabilidad.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOffloadDialogOpen(false)}>Cancelar</Button>
            <Button onClick={() => {
              const r = markTrimbleDataOffloaded({
                offloadRef: offloadRef.trim() || undefined,
                notes: offloadNotes.trim() || undefined,
                source: 'field',
              });
              if (r.ok) { toast.success('Offload registrado'); setOffloadDialogOpen(false); setOffloadRef(''); setOffloadNotes(''); }
              else toast.error(r.reason ?? 'Error');
            }}>
              <HardDriveDownload className="h-4 w-4 mr-2" />Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
