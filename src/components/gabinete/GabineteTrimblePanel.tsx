/**
 * Panel gabinete Trimble.
 *
 * 3 pestañas:
 *  - Resumen: KPIs agregados.
 *  - Por tramo: vista primaria, una fila por tramo con su estado derivado,
 *    intentos, última misión/pasada, entregables.
 *  - Capturas y entregables: detalle técnico (acciones QA + vincular).
 *
 * Acciones SOLO de gabinete:
 *  - Fijar QA (procesado_ok / con_observaciones / descartado).
 *  - Vincular / desvincular entregables externos (URL/NAS, NUNCA binarios).
 */
import { useMemo, useState } from 'react';
import { useRouteStateContext } from '@/context/RouteStateContext';
import type {
  TrimbleQaStatus, TrimbleDeliverableKind, SegmentCapture, TrimbleSegmentStatus,
} from '@/types/trimble';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { GabineteTrajectorySection } from './GabineteTrajectorySection';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  CheckCircle, AlertCircle, XCircle, Link2, Trash2, ClipboardCheck,
  ListTree, LayoutGrid, FileBox,
} from 'lucide-react';
import { toast } from 'sonner';
import { deriveTrimbleSegmentStatus } from '@/utils/trimble/recording-queue';
import { buildTrimbleSegmentSummary } from '@/utils/trimble/segment-summary';
import { TRIMBLE_STATUS_COLOR } from '@/utils/segment-colors';

const FIELD_LABELS: Record<string, string> = {
  en_captura: 'En captura',
  capturado_pendiente_proceso: 'Capturado · pdte. proceso',
  repetir: 'Repetir',
  no_capturable: 'No capturable',
};

const STATUS_LABELS: Record<TrimbleSegmentStatus, string> = {
  pendiente: 'Pendiente',
  en_captura: 'En captura',
  capturado_pendiente_proceso: 'Capturado · pdte. proceso',
  procesado_ok: 'Procesado OK',
  procesado_con_observaciones: 'Procesado c/ observaciones',
  repetir: 'Repetir',
  no_capturable: 'No capturable',
  descartado_por_calidad: 'Descartado',
};

const QA_LABELS: Record<TrimbleQaStatus, string> = {
  procesado_ok: 'OK',
  procesado_con_observaciones: 'Con observaciones',
  descartado_por_calidad: 'Descartado',
};

const QA_ICON: Record<TrimbleQaStatus, typeof CheckCircle> = {
  procesado_ok: CheckCircle,
  procesado_con_observaciones: AlertCircle,
  descartado_por_calidad: XCircle,
};

const QA_COLOR: Record<TrimbleQaStatus, string> = {
  procesado_ok: 'text-emerald-500',
  procesado_con_observaciones: 'text-amber-500',
  descartado_por_calidad: 'text-destructive',
};

const DELIVERABLE_KINDS: { value: TrimbleDeliverableKind; label: string }[] = [
  { value: 'trayectoria', label: 'Trayectoria' },
  { value: 'nube_puntos', label: 'Nube de puntos' },
  { value: 'imagenes', label: 'Imágenes' },
  { value: 'ortho_lane', label: 'Ortho lane' },
  { value: 'informe_qa', label: 'Informe QA' },
  { value: 'informe_pci_iri', label: 'Informe PCI/IRI' },
  { value: 'csv', label: 'CSV' },
  { value: 'shp', label: 'SHP' },
  { value: 'kmz', label: 'KMZ' },
  { value: 'pdf', label: 'PDF' },
  { value: 'las', label: 'LAS' },
  { value: 'tmx', label: 'TMX' },
  { value: 'otro', label: 'Otro' },
];

interface QaDialogState {
  capture: SegmentCapture;
  qa: TrimbleQaStatus;
  reviewedBy: string;
  notes: string;
}

interface DelivDialogState {
  scope: 'capture' | 'mission' | 'run';
  segmentId?: string | null;
  runId?: string | null;
  missionId?: string | null;
  kind: TrimbleDeliverableKind;
  reference: string;
  fileName: string;
  notes: string;
  uploadedBy: string;
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  try { return new Date(s).toLocaleString('es-ES'); } catch { return s; }
}

export function GabineteTrimblePanel() {
  const {
    state,
    setTrimbleQaStatus, linkTrimbleDeliverable, unlinkTrimbleDeliverable,
  } = useRouteStateContext();

  const segments = state.route?.segments ?? [];
  const segById = useMemo(() => {
    const m = new Map<string, string>();
    segments.forEach((s) => {
      m.set(s.id, s.companySegmentId ? `${s.companySegmentId} · ${s.name}` : s.name);
    });
    return m;
  }, [segments]);

  const [qaDialog, setQaDialog] = useState<QaDialogState | null>(null);
  const [delivDialog, setDelivDialog] = useState<DelivDialogState | null>(null);
  const [missionFilter, setMissionFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<TrimbleSegmentStatus | 'all'>('all');

  const trimbleMissions = state.trimbleMissions ?? [];
  const trimbleRuns = state.trimbleRuns ?? [];
  const trimbleSegmentCaptures = state.trimbleSegmentCaptures ?? [];
  const trimbleDeliverables = state.trimbleDeliverables ?? [];
  const activeRunId = state.activeRunId ?? null;

  const captures = useMemo(() => {
    let list = trimbleSegmentCaptures;
    if (missionFilter !== 'all') list = list.filter((c) => c.missionId === missionFilter);
    return [...list].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }, [trimbleSegmentCaptures, missionFilter]);

  // Resumen por tramo (con filtro de misión aplicado a las capturas)
  const perSegment = useMemo(() => {
    const filteredCaps = missionFilter === 'all'
      ? trimbleSegmentCaptures
      : trimbleSegmentCaptures.filter((c) => c.missionId === missionFilter);
    return segments.map((seg) => {
      const summary = buildTrimbleSegmentSummary(
        seg.id, filteredCaps, trimbleMissions, trimbleRuns, trimbleDeliverables,
      );
      const status = deriveTrimbleSegmentStatus(seg.id, filteredCaps, activeRunId);
      return { seg, summary, status };
    });
  }, [segments, trimbleSegmentCaptures, trimbleMissions, trimbleRuns, trimbleDeliverables, missionFilter, activeRunId]);

  const filteredPerSegment = useMemo(() => {
    if (statusFilter === 'all') return perSegment;
    return perSegment.filter((r) => r.status === statusFilter);
  }, [perSegment, statusFilter]);

  // KPIs resumen
  const kpis = useMemo(() => {
    const counts: Record<TrimbleSegmentStatus, number> = {
      pendiente: 0, en_captura: 0, capturado_pendiente_proceso: 0,
      procesado_ok: 0, procesado_con_observaciones: 0,
      repetir: 0, no_capturable: 0, descartado_por_calidad: 0,
    };
    perSegment.forEach((r) => { counts[r.status]++; });
    const captured = perSegment.filter((r) => r.summary.attempts > 0).length;
    return {
      counts,
      totalSegments: perSegment.length,
      captured,
      missions: trimbleMissions.length,
      runs: trimbleRuns.length,
      deliverables: trimbleDeliverables.length,
    };
  }, [perSegment, trimbleMissions.length, trimbleRuns.length, trimbleDeliverables.length]);

  const handleSaveQa = () => {
    if (!qaDialog) return;
    if (!qaDialog.reviewedBy.trim()) {
      toast.error('Indica quién revisa.');
      return;
    }
    const r = setTrimbleQaStatus(qaDialog.capture.id, qaDialog.qa, {
      reviewedBy: qaDialog.reviewedBy.trim(),
      notes: qaDialog.notes || undefined,
    });
    if (r.ok) toast.success(`QA fijado: ${QA_LABELS[qaDialog.qa]}`);
    else toast.error(r.reason || 'No se pudo guardar.');
    setQaDialog(null);
  };

  const handleSaveDeliv = () => {
    if (!delivDialog) return;
    if (!delivDialog.reference.trim()) {
      toast.error('Referencia obligatoria (URL o ruta NAS).');
      return;
    }
    const r = linkTrimbleDeliverable({
      kind: delivDialog.kind,
      missionId: delivDialog.missionId ?? null,
      runId: delivDialog.runId ?? null,
      segmentId: delivDialog.segmentId ?? null,
      reference: delivDialog.reference.trim(),
      fileName: delivDialog.fileName.trim() || undefined,
      notes: delivDialog.notes.trim() || undefined,
      uploadedBy: delivDialog.uploadedBy.trim() || undefined,
    });
    if (r.ok) toast.success('Entregable vinculado.');
    else toast.error(r.reason || 'No se pudo vincular.');
    setDelivDialog(null);
  };

  if (trimbleMissions.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border/60 py-12 text-center text-xs text-muted-foreground">
        No hay datos Trimble en esta campaña.
      </div>
    );
  }

  const missions = [...trimbleMissions].sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  return (
    <div className="space-y-4">
      {/* Filtro de misión global a las 3 vistas */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={missionFilter} onValueChange={setMissionFilter}>
          <SelectTrigger className="h-9 text-sm w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las misiones</SelectItem>
            {missions.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                Día {m.workDay} · {fmtDate(m.startedAt)}
                {m.endedAt ? '' : ' · abierta'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-[11px] text-muted-foreground ml-auto">
          {kpis.totalSegments} tramo{kpis.totalSegments === 1 ? '' : 's'} · {captures.length} captura{captures.length === 1 ? '' : 's'} · {trimbleDeliverables.length} entregable{trimbleDeliverables.length === 1 ? '' : 's'}
        </span>
      </div>

      <Tabs defaultValue="por-tramo">
        <TabsList>
          <TabsTrigger value="resumen"><LayoutGrid className="w-4 h-4 mr-1" />Resumen</TabsTrigger>
          <TabsTrigger value="por-tramo"><ListTree className="w-4 h-4 mr-1" />Por tramo</TabsTrigger>
          <TabsTrigger value="detalle"><FileBox className="w-4 h-4 mr-1" />Capturas y entregables</TabsTrigger>
        </TabsList>

        {/* RESUMEN */}
        <TabsContent value="resumen" className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <KpiCard label="Tramos totales" value={kpis.totalSegments} />
            <KpiCard label="Tramos con captura" value={kpis.captured} />
            <KpiCard label="Misiones" value={kpis.missions} />
            <KpiCard label="Pasadas" value={kpis.runs} />
          </div>
          <div className="rounded-md border border-border p-3">
            <h4 className="text-sm font-semibold mb-2">Distribución por estado</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              {(Object.keys(kpis.counts) as TrimbleSegmentStatus[]).map((k) => (
                <div key={k} className="flex items-center justify-between rounded border border-border/60 px-2 py-1.5">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: TRIMBLE_STATUS_COLOR[k] }} />
                    {STATUS_LABELS[k]}
                  </span>
                  <span className="font-medium">{kpis.counts[k]}</span>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* POR TRAMO */}
        <TabsContent value="por-tramo" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as TrimbleSegmentStatus | 'all')}>
              <SelectTrigger className="h-9 text-sm w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                {(Object.keys(STATUS_LABELS) as TrimbleSegmentStatus[]).map((k) => (
                  <SelectItem key={k} value={k}>{STATUS_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[11px] text-muted-foreground">
              {filteredPerSegment.length} de {perSegment.length}
            </span>
          </div>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className="px-2 py-2 font-medium">ID empresa</th>
                  <th className="px-2 py-2 font-medium">Tramo</th>
                  <th className="px-2 py-2 font-medium">Capa</th>
                  <th className="px-2 py-2 font-medium">Estado</th>
                  <th className="px-2 py-2 font-medium text-right">Intentos</th>
                  <th className="px-2 py-2 font-medium">Última misión</th>
                  <th className="px-2 py-2 font-medium">Última pasada</th>
                  <th className="px-2 py-2 font-medium">Última captura</th>
                  <th className="px-2 py-2 font-medium text-right">Entregables</th>
                </tr>
              </thead>
              <tbody>
                {filteredPerSegment.length === 0 && (
                  <tr><td colSpan={9} className="px-2 py-6 text-center text-muted-foreground">Sin tramos para el filtro.</td></tr>
                )}
                {filteredPerSegment.map(({ seg, summary, status }) => (
                  <tr key={seg.id} className="border-t border-border">
                    <td className="px-2 py-2 whitespace-nowrap font-mono">{seg.companySegmentId ?? '—'}</td>
                    <td className="px-2 py-2">{seg.name}</td>
                    <td className="px-2 py-2 whitespace-nowrap text-muted-foreground">{seg.layer ?? '—'}</td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium border"
                        style={{
                          background: `${TRIMBLE_STATUS_COLOR[status]}20`,
                          borderColor: `${TRIMBLE_STATUS_COLOR[status]}80`,
                          color: TRIMBLE_STATUS_COLOR[status],
                        }}
                      >
                        <span className="inline-block w-2 h-2 rounded-full" style={{ background: TRIMBLE_STATUS_COLOR[status] }} />
                        {STATUS_LABELS[status]}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right">{summary.attempts}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{summary.lastMissionWorkDay !== null ? `Día ${summary.lastMissionWorkDay}` : '—'}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{summary.lastRunIndex !== null ? `#${summary.lastRunIndex}` : '—'}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{fmtDate(summary.lastCaptureAt)}</td>
                    <td className="px-2 py-2 text-right">{summary.deliverableCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* DETALLE: Capturas + Entregables */}
        <TabsContent value="detalle" className="space-y-4">
          {/* Tabla capturas */}
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className="px-2 py-2 font-medium">Inicio</th>
                  <th className="px-2 py-2 font-medium">Tramo</th>
                  <th className="px-2 py-2 font-medium">Pasada</th>
                  <th className="px-2 py-2 font-medium">Estado campo</th>
                  <th className="px-2 py-2 font-medium">QA</th>
                  <th className="px-2 py-2 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {captures.length === 0 && (
                  <tr><td colSpan={6} className="px-2 py-6 text-center text-muted-foreground">Sin capturas para el filtro.</td></tr>
                )}
                {captures.map((c) => {
                  const run = trimbleRuns.find((r) => r.id === c.runId);
                  const QaIcon = c.qaStatus ? QA_ICON[c.qaStatus] : null;
                  return (
                    <tr key={c.id} className="border-t border-border">
                      <td className="px-2 py-2 whitespace-nowrap">{fmtDate(c.startedAt)}</td>
                      <td className="px-2 py-2">{segById.get(c.segmentId) ?? c.segmentId}</td>
                      <td className="px-2 py-2 whitespace-nowrap">#{run?.index ?? '?'} {run?.direction ?? ''}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{FIELD_LABELS[c.fieldStatus] ?? c.fieldStatus}</td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        {c.qaStatus && QaIcon ? (
                          <span className={`inline-flex items-center gap-1 ${QA_COLOR[c.qaStatus]}`}>
                            <QaIcon className="w-3.5 h-3.5" />
                            {QA_LABELS[c.qaStatus]}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 mr-1"
                          onClick={() => setQaDialog({
                            capture: c,
                            qa: c.qaStatus ?? 'procesado_ok',
                            reviewedBy: c.qaReviewedBy ?? '',
                            notes: c.qaNotes ?? '',
                          })}
                        >
                          <ClipboardCheck className="w-3.5 h-3.5 mr-1" />
                          QA
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2"
                          onClick={() => setDelivDialog({
                            scope: 'capture',
                            segmentId: c.segmentId,
                            runId: c.runId,
                            missionId: c.missionId,
                            kind: 'nube_puntos',
                            reference: '',
                            fileName: '',
                            notes: '',
                            uploadedBy: '',
                          })}
                        >
                          <Link2 className="w-3.5 h-3.5 mr-1" />
                          Entregable
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Entregables */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Entregables vinculados</h3>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => setDelivDialog({
                  scope: 'mission',
                  missionId: missionFilter !== 'all' ? missionFilter : (missions[missions.length - 1]?.id ?? null),
                  kind: 'informe_qa',
                  reference: '',
                  fileName: '',
                  notes: '',
                  uploadedBy: '',
                })}
              >
                <Link2 className="w-3.5 h-3.5 mr-1" />
                Vincular a misión
              </Button>
            </div>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <th className="px-2 py-2 font-medium">Subido</th>
                    <th className="px-2 py-2 font-medium">Tipo</th>
                    <th className="px-2 py-2 font-medium">Referencia</th>
                    <th className="px-2 py-2 font-medium">Tramo</th>
                    <th className="px-2 py-2 font-medium">Por</th>
                    <th className="px-2 py-2 font-medium text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {trimbleDeliverables.length === 0 && (
                    <tr><td colSpan={6} className="px-2 py-6 text-center text-muted-foreground">Sin entregables.</td></tr>
                  )}
                  {trimbleDeliverables.map((d) => (
                    <tr key={d.id} className="border-t border-border">
                      <td className="px-2 py-2 whitespace-nowrap">{fmtDate(d.uploadedAt)}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{d.kind}</td>
                      <td className="px-2 py-2 break-all max-w-[20rem]">{d.reference}</td>
                      <td className="px-2 py-2">{d.segmentId ? (segById.get(d.segmentId) ?? d.segmentId) : '—'}</td>
                      <td className="px-2 py-2">{d.uploadedBy ?? '—'}</td>
                      <td className="px-2 py-2 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 border-destructive/40 text-destructive hover:bg-destructive/10"
                          onClick={() => {
                            if (!confirm('¿Desvincular entregable?')) return;
                            const r = unlinkTrimbleDeliverable(d.id);
                            if (r.ok) toast.success('Desvinculado.');
                            else toast.error(r.reason || 'No se pudo.');
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Diálogo QA */}
      <Dialog open={qaDialog !== null} onOpenChange={(o) => { if (!o) setQaDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fijar QA</DialogTitle>
          </DialogHeader>
          {qaDialog && (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">
                Tramo: <span className="text-foreground font-medium">{segById.get(qaDialog.capture.segmentId) ?? qaDialog.capture.segmentId}</span>
              </div>
              <Select value={qaDialog.qa} onValueChange={(v) => setQaDialog({ ...qaDialog, qa: v as TrimbleQaStatus })}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="procesado_ok">Procesado OK</SelectItem>
                  <SelectItem value="procesado_con_observaciones">Procesado con observaciones</SelectItem>
                  <SelectItem value="descartado_por_calidad">Descartado por calidad</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="Revisado por (nombre)"
                value={qaDialog.reviewedBy}
                onChange={(e) => setQaDialog({ ...qaDialog, reviewedBy: e.target.value })}
                className="h-9 text-sm"
              />
              <Textarea
                placeholder="Notas de QA"
                value={qaDialog.notes}
                onChange={(e) => setQaDialog({ ...qaDialog, notes: e.target.value })}
                rows={3}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setQaDialog(null)}>Cancelar</Button>
            <Button onClick={handleSaveQa}>Guardar QA</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo Entregable */}
      <Dialog open={delivDialog !== null} onOpenChange={(o) => { if (!o) setDelivDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vincular entregable</DialogTitle>
          </DialogHeader>
          {delivDialog && (
            <div className="space-y-3">
              <Select value={delivDialog.kind} onValueChange={(v) => setDelivDialog({ ...delivDialog, kind: v as TrimbleDeliverableKind })}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DELIVERABLE_KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input
                placeholder="Referencia (URL, ruta NAS, ID externo) — NUNCA un binario"
                value={delivDialog.reference}
                onChange={(e) => setDelivDialog({ ...delivDialog, reference: e.target.value })}
                className="h-9 text-sm"
              />
              <Input
                placeholder="Nombre archivo (opcional)"
                value={delivDialog.fileName}
                onChange={(e) => setDelivDialog({ ...delivDialog, fileName: e.target.value })}
                className="h-9 text-sm"
              />
              <Input
                placeholder="Subido por"
                value={delivDialog.uploadedBy}
                onChange={(e) => setDelivDialog({ ...delivDialog, uploadedBy: e.target.value })}
                className="h-9 text-sm"
              />
              <Textarea
                placeholder="Notas"
                value={delivDialog.notes}
                onChange={(e) => setDelivDialog({ ...delivDialog, notes: e.target.value })}
                rows={2}
              />
              <p className="text-[10px] text-muted-foreground">
                Los entregables son referencias externas: la nube de puntos no se almacena en VialRoute.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelivDialog(null)}>Cancelar</Button>
            <Button onClick={handleSaveDeliv}>Vincular</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
