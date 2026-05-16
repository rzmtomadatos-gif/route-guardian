/**
 * Panel de campo Trimble.
 *
 * Cuaderno de bitácora del operador en captura LiDAR. NO procesa nube;
 * sólo registra Misión → Pasada → Captura(por tramo) → Incidencia.
 *
 * Reglas duras:
 *  - Sólo operativo si `acquisitionMode === 'TRIMBLE_LIDAR'`.
 *  - QA (procesado_ok / con_observaciones / descartado) NO se fija aquí.
 *  - Una sola misión y una sola pasada abierta a la vez (invariantes en el hook).
 *  - Una sola captura abierta por pasada.
 */
import { useMemo, useState } from 'react';
import { useRouteStateContext } from '@/context/RouteStateContext';
import { findActiveCapture, type TrimbleFieldStatus, type TrimbleIncidentCategory, type TrimbleIncidentSeverity } from '@/types/trimble';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { Radar, Play, StopCircle, AlertTriangle, MapPin, Ban, RotateCcw, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { TrimbleCheckpointsCard } from './TrimbleCheckpointsCard';

const FIELD_STATUS_LABELS: Record<TrimbleFieldStatus, string> = {
  en_captura: 'En captura',
  capturado_pendiente_proceso: 'Capturado, pendiente proceso',
  repetir: 'Repetir',
  no_capturable: 'No capturable',
};

const INCIDENT_CATEGORIES: { value: TrimbleIncidentCategory; label: string }[] = [
  { value: 'gnss_perdida', label: 'Pérdida GNSS' },
  { value: 'imu_drift', label: 'Drift IMU' },
  { value: 'oclusion_severa', label: 'Oclusión severa' },
  { value: 'fallo_sensor', label: 'Fallo de sensor' },
  { value: 'fallo_almacenamiento', label: 'Fallo almacenamiento' },
  { value: 'trafico_extremo', label: 'Tráfico extremo' },
  { value: 'climatologia', label: 'Climatología' },
  { value: 'acceso_imposible', label: 'Acceso imposible' },
  { value: 'otro', label: 'Otro' },
];

const SEVERITIES: { value: TrimbleIncidentSeverity; label: string }[] = [
  { value: 'baja', label: 'Baja' },
  { value: 'media', label: 'Media' },
  { value: 'alta', label: 'Alta' },
  { value: 'bloqueante', label: 'Bloqueante' },
];

export function TrimbleFieldPanel() {
  const {
    state,
    startTrimbleMission, closeTrimbleMission,
    startTrimbleRun, closeTrimbleRun, invalidateTrimbleRun,
    startTrimbleCapture, closeTrimbleCapture,
    recordTrimbleIncident,
  } = useRouteStateContext();

  const inMode = state.acquisitionMode === 'TRIMBLE_LIDAR';
  const activeMission = state.trimbleMissions.find((m) => m.id === state.activeMissionId) || null;
  const activeRun = state.trimbleRuns.find((r) => r.id === state.activeRunId) || null;
  const activeCapture = useMemo(
    () => findActiveCapture(state.trimbleSegmentCaptures, state.activeRunId),
    [state.trimbleSegmentCaptures, state.activeRunId],
  );

  // Mission form
  const [missionVehicle, setMissionVehicle] = useState('');
  const [missionRig, setMissionRig] = useState('');
  const [missionOperator, setMissionOperator] = useState('');
  const [missionWeather, setMissionWeather] = useState('');
  const [missionNotes, setMissionNotes] = useState('');

  // Run form
  const [runDirection, setRunDirection] = useState<'ida' | 'vuelta' | 'otro'>('ida');
  const [runNotes, setRunNotes] = useState('');

  // Capture form
  const [selectedSegmentId, setSelectedSegmentId] = useState<string>('');
  const [captureNotes, setCaptureNotes] = useState('');

  // Close-capture form
  const [closeStatus, setCloseStatus] = useState<TrimbleFieldStatus>('capturado_pendiente_proceso');
  const [closeNotes, setCloseNotes] = useState('');

  // Incident form
  const [incCat, setIncCat] = useState<TrimbleIncidentCategory>('gnss_perdida');
  const [incSev, setIncSev] = useState<TrimbleIncidentSeverity>('media');
  const [incNote, setIncNote] = useState('');
  const [incInvalidates, setIncInvalidates] = useState(false);

  const segmentOptions = state.route?.segments ?? [];

  if (!inMode) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
        <Radar className="w-6 h-6 mx-auto mb-2 opacity-60" />
        Activa el modo <span className="font-medium text-foreground">Trimble LiDAR</span> en Configuración para usar este panel.
      </div>
    );
  }

  const handleStartMission = () => {
    const r = startTrimbleMission({
      vehicle: missionVehicle || undefined,
      sensorRig: missionRig || undefined,
      operator: missionOperator || undefined,
      weather: missionWeather || undefined,
      notes: missionNotes || undefined,
    });
    if (r.ok) toast.success('Misión Trimble abierta.');
    else toast.error(r.reason || 'No se pudo abrir misión.');
  };

  const handleCloseMission = () => {
    const r = closeTrimbleMission('manual');
    if (r.ok) toast.success('Misión cerrada (capturas abiertas → pendientes de proceso).');
    else toast.error(r.reason || 'No se pudo cerrar.');
  };

  const handleStartRun = () => {
    const r = startTrimbleRun({ direction: runDirection, notes: runNotes || undefined });
    if (r.ok) toast.success(`Pasada abierta (${runDirection}).`);
    else toast.error(r.reason || 'No se pudo abrir pasada.');
    setRunNotes('');
  };

  const handleCloseRun = () => {
    const r = closeTrimbleRun({});
    if (r.ok) toast.success('Pasada cerrada.');
    else toast.error(r.reason || 'No se pudo cerrar pasada.');
  };

  const handleInvalidateRun = () => {
    if (!confirm('¿Invalidar la pasada? Las capturas abiertas pasarán a "repetir".')) return;
    const r = invalidateTrimbleRun('Operador');
    if (r.ok) toast.success('Pasada invalidada.');
    else toast.error(r.reason || 'No se pudo invalidar.');
  };

  const handleStartCapture = () => {
    if (!selectedSegmentId) {
      toast.error('Selecciona un tramo.');
      return;
    }
    const r = startTrimbleCapture(selectedSegmentId, { notes: captureNotes || undefined });
    if (r.ok) toast.success('Captura iniciada.');
    else toast.error(r.reason || 'No se pudo iniciar.');
    setCaptureNotes('');
  };

  const handleCloseCapture = () => {
    const r = closeTrimbleCapture(closeStatus, { notes: closeNotes || undefined });
    if (r.ok) toast.success(`Captura cerrada: ${FIELD_STATUS_LABELS[closeStatus]}.`);
    else toast.error(r.reason || 'No se pudo cerrar.');
    setCloseNotes('');
    setCloseStatus('capturado_pendiente_proceso');
  };

  const handleIncident = () => {
    // Si la incidencia invalida la pasada, exigimos confirmación previa
    // y encadenamos invalidateTrimbleRun. Si no hay pasada activa,
    // registramos la incidencia pero avisamos: no hay nada que invalidar.
    if (incInvalidates && activeRun) {
      if (!confirm('Esta incidencia invalidará la pasada actual. Las capturas abiertas pasarán a "repetir". ¿Continuar?')) {
        return;
      }
    }
    const r = recordTrimbleIncident({
      category: incCat,
      severity: incSev,
      note: incNote || undefined,
      runId: activeRun?.id ?? null,
      segmentId: activeCapture?.segmentId ?? null,
      invalidatesRun: incInvalidates,
    });
    if (!r.ok) {
      toast.error(r.reason || 'No se pudo registrar.');
      return;
    }
    if (incInvalidates) {
      if (activeRun) {
        const inv = invalidateTrimbleRun(incNote || incCat);
        if (inv.ok) {
          toast.success('Incidencia registrada y pasada invalidada.');
        } else {
          toast.error(inv.reason || 'Incidencia registrada, pero no se pudo invalidar la pasada.');
        }
      } else {
        toast.warning('Incidencia registrada. No hay pasada activa que invalidar.');
      }
    } else {
      toast.success('Incidencia Trimble registrada.');
    }
    setIncNote('');
    setIncInvalidates(false);
  };

  return (
    <div className="space-y-4">
      <TrimbleCheckpointsCard />
      {/* Mission */}
      <section className="bg-card rounded-xl p-4 border border-border space-y-3">
        <header className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Radar className="w-4 h-4 text-primary" />
            Misión
          </h3>
          <span className={`text-[10px] px-2 py-0.5 rounded-full ${activeMission ? 'bg-emerald-500/15 text-emerald-500' : 'bg-muted text-muted-foreground'}`}>
            {activeMission ? `Abierta · día ${activeMission.workDay}` : 'Cerrada'}
          </span>
        </header>

        {!activeMission ? (
          <div className="space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Input placeholder="Vehículo (matrícula/modelo)" value={missionVehicle} onChange={(e) => setMissionVehicle(e.target.value)} className="h-9 text-sm" />
              <Input placeholder="Equipo sensor (rig)" value={missionRig} onChange={(e) => setMissionRig(e.target.value)} className="h-9 text-sm" />
              <Input placeholder="Operador" value={missionOperator} onChange={(e) => setMissionOperator(e.target.value)} className="h-9 text-sm" />
              <Input placeholder="Climatología" value={missionWeather} onChange={(e) => setMissionWeather(e.target.value)} className="h-9 text-sm" />
            </div>
            <Textarea placeholder="Notas de misión (opcional)" value={missionNotes} onChange={(e) => setMissionNotes(e.target.value)} className="text-sm" rows={2} />
            <Button onClick={handleStartMission} className="w-full" size="sm">
              <Play className="w-4 h-4 mr-2" />
              Iniciar misión
            </Button>
          </div>
        ) : (
          <div className="space-y-2 text-xs text-muted-foreground">
            <div>Inicio: {new Date(activeMission.startedAt).toLocaleString('es-ES')}</div>
            {activeMission.vehicle && <div>Vehículo: <span className="text-foreground">{activeMission.vehicle}</span></div>}
            {activeMission.sensorRig && <div>Equipo: <span className="text-foreground">{activeMission.sensorRig}</span></div>}
            {activeMission.operator && <div>Operador: <span className="text-foreground">{activeMission.operator}</span></div>}
            <Button onClick={handleCloseMission} variant="outline" size="sm" className="w-full border-destructive/40 text-destructive hover:bg-destructive/10">
              <StopCircle className="w-4 h-4 mr-2" />
              Cerrar misión
            </Button>
          </div>
        )}
      </section>

      {/* Run */}
      <section className="bg-card rounded-xl p-4 border border-border space-y-3">
        <header className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" />
            Pasada
          </h3>
          <span className={`text-[10px] px-2 py-0.5 rounded-full ${activeRun ? 'bg-emerald-500/15 text-emerald-500' : 'bg-muted text-muted-foreground'}`}>
            {activeRun ? `Pasada #${activeRun.index} · ${activeRun.direction ?? '—'}` : 'Sin pasada'}
          </span>
        </header>

        {!activeMission ? (
          <p className="text-xs text-muted-foreground">Abre una misión primero.</p>
        ) : !activeRun ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Select value={runDirection} onValueChange={(v) => setRunDirection(v as typeof runDirection)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ida">Ida</SelectItem>
                  <SelectItem value="vuelta">Vuelta</SelectItem>
                  <SelectItem value="otro">Otro</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="Notas pasada" value={runNotes} onChange={(e) => setRunNotes(e.target.value)} className="h-9 text-sm" />
            </div>
            <Button onClick={handleStartRun} className="w-full" size="sm">
              <Play className="w-4 h-4 mr-2" />
              Iniciar pasada
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button onClick={handleCloseRun} variant="outline" size="sm" className="flex-1">
              <StopCircle className="w-4 h-4 mr-2" />
              Cerrar pasada
            </Button>
            <Button onClick={handleInvalidateRun} variant="outline" size="sm" className="border-destructive/40 text-destructive hover:bg-destructive/10">
              <Ban className="w-4 h-4 mr-2" />
              Invalidar
            </Button>
          </div>
        )}
      </section>

      {/* Capture */}
      <section className="bg-card rounded-xl p-4 border border-border space-y-3">
        <header className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-primary" />
            Captura por tramo
          </h3>
          <span className={`text-[10px] px-2 py-0.5 rounded-full ${activeCapture ? 'bg-amber-500/15 text-amber-500' : 'bg-muted text-muted-foreground'}`}>
            {activeCapture ? 'En captura' : 'Sin captura abierta'}
          </span>
        </header>

        {!activeRun ? (
          <p className="text-xs text-muted-foreground">Abre una pasada primero.</p>
        ) : !activeCapture ? (
          <div className="space-y-2">
            <Select value={selectedSegmentId} onValueChange={setSelectedSegmentId}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Selecciona tramo" />
              </SelectTrigger>
              <SelectContent>
                {segmentOptions.length === 0 && (
                  <div className="p-3 text-xs text-muted-foreground">No hay tramos cargados</div>
                )}
                {segmentOptions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.companySegmentId ? `${s.companySegmentId} · ` : ''}{s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input placeholder="Notas captura (opcional)" value={captureNotes} onChange={(e) => setCaptureNotes(e.target.value)} className="h-9 text-sm" />
            <Button onClick={handleStartCapture} className="w-full" size="sm" disabled={!selectedSegmentId}>
              <Play className="w-4 h-4 mr-2" />
              Iniciar captura
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              Tramo: <span className="text-foreground font-medium">{
                segmentOptions.find((s) => s.id === activeCapture.segmentId)?.name ?? activeCapture.segmentId
              }</span>
            </div>
            <Select value={closeStatus} onValueChange={(v) => setCloseStatus(v as TrimbleFieldStatus)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="capturado_pendiente_proceso">Capturado · pendiente proceso</SelectItem>
                <SelectItem value="repetir">Repetir</SelectItem>
                <SelectItem value="no_capturable">No capturable</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder="Notas cierre (opcional)" value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} className="h-9 text-sm" />
            <Button onClick={handleCloseCapture} className="w-full" size="sm">
              <StopCircle className="w-4 h-4 mr-2" />
              Cerrar captura
            </Button>
          </div>
        )}
      </section>

      {/* Incident */}
      <section className="bg-card rounded-xl p-4 border border-border space-y-3">
        <header className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive" />
            Registrar incidencia
          </h3>
        </header>
        {!activeMission ? (
          <p className="text-xs text-muted-foreground">Abre una misión para poder registrar.</p>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Select value={incCat} onValueChange={(v) => setIncCat(v as TrimbleIncidentCategory)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INCIDENT_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={incSev} onValueChange={(v) => setIncSev(v as TrimbleIncidentSeverity)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Textarea placeholder="Descripción / nota" value={incNote} onChange={(e) => setIncNote(e.target.value)} className="text-sm" rows={2} />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={incInvalidates} onChange={(e) => setIncInvalidates(e.target.checked)} />
              Invalida la pasada actual
            </label>
            <Button onClick={handleIncident} variant="outline" size="sm" className="w-full">
              <AlertTriangle className="w-4 h-4 mr-2" />
              Registrar
            </Button>
          </div>
        )}
      </section>

      {/* Mini contadores */}
      <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 px-1">
        <span>Misiones: {state.trimbleMissions.length}</span>
        <span>Pasadas: {state.trimbleRuns.length}</span>
        <span>Capturas: {state.trimbleSegmentCaptures.length}</span>
        <span>Incidencias: {state.trimbleIncidents.length}</span>
        <span>Entregables: {state.trimbleDeliverables.length}</span>
      </div>
    </div>
  );
}
