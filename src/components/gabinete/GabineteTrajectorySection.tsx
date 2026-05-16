/**
 * Sección "Trayectoria y datum" para el panel de gabinete Trimble.
 *
 * Permite vincular un entregable externo de trayectoria procesada
 * (TBC/POSPac/SBET) por misión, indicar método/datum/geoide y
 * marcarlo como aceptado o rechazado por gabinete.
 *
 * Regla dura:
 *  - La traza GPS de VialRoute es SIEMPRE auxiliar de campo.
 *  - La trayectoria final es SIEMPRE un TrimbleDeliverable externo.
 */
import { useMemo, useState } from 'react';
import { useRouteStateContext } from '@/context/RouteStateContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Route, Check, X, AlertTriangle, Link as LinkIcon, FileWarning } from 'lucide-react';
import { toast } from 'sonner';
import type { TrimbleTrajectoryMethod } from '@/types/trimble';

const METHODS: { value: TrimbleTrajectoryMethod; label: string }[] = [
  { value: 'SingleBase', label: 'SingleBase' },
  { value: 'MSB', label: 'MSB' },
  { value: 'SmartBase', label: 'SmartBase' },
  { value: 'PP-RTX', label: 'PP-RTX' },
  { value: 'SBET', label: 'SBET' },
  { value: 'realtime', label: 'Tiempo real (no procesado)' },
  { value: 'other', label: 'Otro' },
  { value: 'unknown', label: 'Desconocido' },
];

export function GabineteTrajectorySection({ missionFilter }: { missionFilter: string }) {
  const {
    state,
    linkTrimbleTrajectoryDeliverable,
    acceptTrimbleTrajectory,
    rejectTrimbleTrajectory,
  } = useRouteStateContext();

  const missions = useMemo(() => {
    const all = state.trimbleMissions ?? [];
    return missionFilter === 'all' ? all : all.filter((m) => m.id === missionFilter);
  }, [state.trimbleMissions, missionFilter]);

  const [dialogMissionId, setDialogMissionId] = useState<string | null>(null);
  const [ref, setRef] = useState('');
  const [method, setMethod] = useState<TrimbleTrajectoryMethod>('SBET');
  const [datumCrs, setDatumCrs] = useState('');
  const [geoidModel, setGeoidModel] = useState('');
  const [processedBy, setProcessedBy] = useState('');
  const [notes, setNotes] = useState('');

  const resetForm = () => {
    setRef(''); setMethod('SBET'); setDatumCrs(''); setGeoidModel(''); setProcessedBy(''); setNotes('');
  };

  const submitLink = () => {
    if (!dialogMissionId) return;
    const r = linkTrimbleTrajectoryDeliverable({
      missionId: dialogMissionId,
      reference: ref,
      trajectoryMethod: method,
      datumCrs: datumCrs.trim() || undefined,
      geoidModel: geoidModel.trim() || undefined,
      processedBy: processedBy.trim() || undefined,
      notes: notes.trim() || undefined,
      source: 'gabinete',
    });
    if (r.ok) { toast.success('Trayectoria vinculada'); setDialogMissionId(null); resetForm(); }
    else toast.error(r.reason ?? 'Error');
  };

  if (missions.length === 0) return null;

  return (
    <section className="rounded-lg border bg-card p-3 space-y-3">
      <header className="flex items-center gap-2">
        <Route className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Trayectoria y datum</h3>
        <span className="ml-auto text-[11px] text-muted-foreground">
          La traza GPS de VialRoute es auxiliar; nunca trayectoria final.
        </span>
      </header>

      <div className="space-y-2">
        {missions.map((m) => {
          const deliverable = (state.trimbleDeliverables ?? []).find(
            (d) => d.id === m.trajectoryDeliverableId,
          );
          const accepted = m.trajectoryAccepted;
          return (
            <div key={m.id} className="rounded-md border p-2 space-y-1.5">
              <div className="flex items-center justify-between flex-wrap gap-1">
                <div className="text-sm font-medium">
                  Día {m.workDay} · {new Date(m.startedAt).toLocaleDateString()}
                </div>
                <div className="flex items-center gap-1">
                  {!deliverable && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-warning">
                      <FileWarning className="h-3 w-3" /> Sin trayectoria procesada
                    </span>
                  )}
                  {deliverable && accepted === true && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-success">
                      <Check className="h-3 w-3" /> Aceptada
                    </span>
                  )}
                  {deliverable && accepted === false && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-destructive">
                      <X className="h-3 w-3" /> Rechazada
                    </span>
                  )}
                  {deliverable && accepted == null && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <AlertTriangle className="h-3 w-3" /> Pendiente revisión
                    </span>
                  )}
                </div>
              </div>

              {deliverable && (
                <div className="text-[11px] text-muted-foreground space-y-0.5">
                  <div>Ref: <span className="font-mono break-all">{deliverable.reference}</span></div>
                  <div>
                    Método: {deliverable.trajectoryMethod ?? m.trajectoryMethod ?? '—'}
                    {' · '}Datum: {deliverable.datumCrs ?? m.datumCrs ?? '—'}
                    {' · '}Geoide: {deliverable.geoidModel ?? m.geoidModel ?? '—'}
                  </div>
                </div>
              )}

              <div className="flex gap-1 flex-wrap">
                <Button
                  size="sm" variant="outline"
                  onClick={() => { setDialogMissionId(m.id); resetForm(); }}
                >
                  <LinkIcon className="h-3.5 w-3.5 mr-1" />
                  {deliverable ? 'Vincular nueva' : 'Vincular trayectoria'}
                </Button>
                {deliverable && (
                  <>
                    <Button
                      size="sm" variant="outline"
                      onClick={() => {
                        const r = acceptTrimbleTrajectory(m.id, { processedBy: processedBy.trim() || undefined });
                        r.ok ? toast.success('Trayectoria aceptada') : toast.error(r.reason ?? 'Error');
                      }}
                    >
                      <Check className="h-3.5 w-3.5 mr-1" />Aceptar
                    </Button>
                    <Button
                      size="sm" variant="ghost"
                      onClick={() => {
                        const r = rejectTrimbleTrajectory(m.id, { processedBy: processedBy.trim() || undefined });
                        r.ok ? toast.success('Trayectoria rechazada') : toast.error(r.reason ?? 'Error');
                      }}
                    >
                      <X className="h-3.5 w-3.5 mr-1" />Rechazar
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={dialogMissionId != null} onOpenChange={(o) => { if (!o) setDialogMissionId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Vincular trayectoria procesada</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <p className="text-[11px] text-muted-foreground">
              Solo entregables externos (TBC/POSPac/SBET, URL/NAS/ID). No se almacenan binarios.
              La traza GPS auxiliar de VialRoute no puede usarse como trayectoria final.
            </p>
            <label>Referencia externa (URL, NAS, ID, ruta)</label>
            <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="\\\\nas\\proj\\sbet.out" />
            <label>Método</label>
            <Select value={method} onValueChange={(v) => setMethod(v as TrimbleTrajectoryMethod)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {METHODS.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label>Datum / CRS</label>
                <Input value={datumCrs} onChange={(e) => setDatumCrs(e.target.value)} placeholder="ETRS89 / UTM 30N" />
              </div>
              <div>
                <label>Geoide</label>
                <Input value={geoidModel} onChange={(e) => setGeoidModel(e.target.value)} placeholder="EGM2008" />
              </div>
            </div>
            <label>Procesado por</label>
            <Input value={processedBy} onChange={(e) => setProcessedBy(e.target.value)} placeholder="Operador gabinete" />
            <label>Notas</label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogMissionId(null)}>Cancelar</Button>
            <Button onClick={submitLink}>
              <LinkIcon className="h-4 w-4 mr-2" />Vincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
