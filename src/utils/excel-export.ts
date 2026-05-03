/**
 * Exportador clásico de hoja de ruta.
 *
 * Migrado de `xlsx` (vulnerable: Prototype Pollution + ReDoS sin parche en npm)
 * a `exceljs` con dynamic import para no inflar el bundle inicial.
 *
 * Modo de exportación:
 *  - 'strict'   → no aplica autofix. Si faltan datos, los campos quedan vacíos
 *                 y se anotan en la hoja "Validación Export".
 *  - 'audited'  → aplica reconstrucciones SOLO de exportación, las marca en
 *                 columnas de auditoría (AUTOFIX_APPLIED, AUTOFIX_FIELDS,
 *                 TIMESTAMP_SOURCE_START/END, EXPORT_WARNING) y las registra en
 *                 la hoja "Validación Export". Nunca usa new Date() como hora
 *                 real de inicio/fin: si no hay timestamp real ni alternativo,
 *                 el campo queda vacío.
 *
 * El estado real de la campaña NUNCA se muta durante la exportación.
 */
import type { Route, Segment, Incident, F5Event } from '@/types/route';
import type { PersistentEvent } from '@/utils/persistence';
import { segmentDistanceKm } from '@/utils/geo-distance';

const STATUS_LABELS: Record<string, string> = {
  pendiente: 'Pendiente',
  en_progreso: 'En progreso',
  completado: 'Completado',
  posible_repetir: 'Posible repetir',
};

const DIRECTION_LABELS: Record<string, string> = {
  creciente: 'Creciente',
  ambos: 'Ambos',
};

const TYPE_LABELS: Record<string, string> = {
  tramo: 'Tramo',
  rotonda: 'Rotonda',
};

const IMPACT_LABELS: Record<string, string> = {
  informativa: 'Informativa',
  critica_no_grabable: 'Crítica (no grabable)',
  critica_invalida_bloque: 'Crítica (invalida bloque)',
};

export type ExportMode = 'strict' | 'audited';

export interface ExportValidationError {
  segmentId: string;
  segmentName: string;
  issue: string;
  severity?: 'error' | 'warning';
  field?: string;
}

export interface ExportAuditRow {
  segmentId: string;
  segmentName: string;
  field: string;
  problem: string;
  action: string;
  severity: 'error' | 'warning' | 'info';
}

interface AuditedSegment {
  seg: Segment;
  autofixApplied: boolean;
  autofixFields: string[];
  timestampSourceStart: 'real' | 'timestampInicio' | 'vacío';
  timestampSourceEnd: 'real' | 'timestampFin' | 'vacío';
  exportWarning: string;
  // Effective values used in export (never mutate original segment)
  effTrackNumber: number | null;
  effStartedAt: string | null;
  effEndedAt: string | null;
  effStatus: Segment['status'];
  effNonRecordable: boolean;
}

/** Validate segments before export. Returns list of issues found. */
export function validateForExport(segments: Segment[], rstMode: boolean): ExportValidationError[] {
  const errors: ExportValidationError[] = [];

  segments.forEach((s) => {
    if (s.status === 'completado' && s.nonRecordable) {
      errors.push({ segmentId: s.id, segmentName: s.name, issue: 'Completado pero marcado no grabable', severity: 'warning', field: 'nonRecordable' });
    }
    if (s.status !== 'completado') return;
    if (s.trackNumber === null) {
      errors.push({ segmentId: s.id, segmentName: s.name, issue: 'Completado sin Track real', severity: 'error', field: 'trackNumber' });
    }
    if (!s.startedAt) {
      errors.push({ segmentId: s.id, segmentName: s.name, issue: 'Completado sin Inicio tramo', severity: 'error', field: 'startedAt' });
    }
    if (!s.endedAt) {
      errors.push({ segmentId: s.id, segmentName: s.name, issue: 'Completado sin Fin tramo', severity: 'error', field: 'endedAt' });
    }
  });

  let rstOffCorrected = 0;
  if (!rstMode) {
    const completedWithTrack = segments.filter((s) => s.status === 'completado' && s.trackNumber !== null);
    const trackCounts = new Map<number, string[]>();
    completedWithTrack.forEach((s) => {
      const names = trackCounts.get(s.trackNumber!) || [];
      names.push(s.name);
      trackCounts.set(s.trackNumber!, names);
    });
    trackCounts.forEach((names, track) => {
      if (names.length > 1) {
        rstOffCorrected += names.length;
        names.forEach((name) => {
          errors.push({ segmentId: '', segmentName: name, issue: `Track ${track} repetido (RST OFF: debe ser único)`, severity: 'warning', field: 'trackNumber' });
        });
      }
    });
    if (rstOffCorrected > 0) {
      errors.unshift({ segmentId: '', segmentName: '—', issue: `RST OFF detectado · ${rstOffCorrected} tramo(s) con Track duplicado`, severity: 'warning' });
    }
  }

  return errors;
}

/**
 * Construye una vista auditada de los segmentos para exportación.
 * NUNCA muta los segmentos originales. NUNCA inventa fechas con new Date().
 *
 * - mode='strict':  effective = original. Solo registra problemas en audit.
 * - mode='audited': aplica reconstrucciones reversibles solo para el Excel,
 *                   marcando origen y autofix en las columnas de auditoría.
 */
function buildAuditedSegments(
  exportSegments: Segment[],
  mode: ExportMode,
): { audited: AuditedSegment[]; auditRows: ExportAuditRow[] } {
  const auditRows: ExportAuditRow[] = [];

  let maxTrack = 0;
  exportSegments.forEach((s) => {
    if (s.trackNumber !== null && s.trackNumber > maxTrack) maxTrack = s.trackNumber;
    s.trackHistory.forEach((t) => { if (t > maxTrack) maxTrack = t; });
  });

  const audited = exportSegments.map<AuditedSegment>((s) => {
    const fields: string[] = [];
    const warnings: string[] = [];
    let effTrackNumber = s.trackNumber;
    let effStartedAt: string | null = s.startedAt ?? null;
    let effEndedAt: string | null = s.endedAt ?? null;
    let effStatus = s.status;
    let effNonRecordable = s.nonRecordable;
    let timestampSourceStart: AuditedSegment['timestampSourceStart'] = s.startedAt ? 'real' : 'vacío';
    let timestampSourceEnd: AuditedSegment['timestampSourceEnd'] = s.endedAt ? 'real' : 'vacío';

    // Caso especial: completado + no grabable es contradictorio
    if (s.status === 'completado' && s.nonRecordable) {
      if (mode === 'audited') {
        effStatus = 'posible_repetir';
        effTrackNumber = null;
        effEndedAt = null;
        timestampSourceEnd = 'vacío';
        fields.push('status', 'trackNumber', 'endedAt');
        warnings.push('Completado+no_grabable revertido a posible_repetir SOLO en export');
        auditRows.push({
          segmentId: s.id,
          segmentName: s.name,
          field: 'status',
          problem: 'Completado pero marcado no grabable',
          action: 'Revertido a posible_repetir solo en export (campaña no se modifica)',
          severity: 'warning',
        });
      } else {
        auditRows.push({
          segmentId: s.id,
          segmentName: s.name,
          field: 'status',
          problem: 'Completado pero marcado no grabable',
          action: 'Sin acción (modo estricto)',
          severity: 'warning',
        });
      }
    }

    if (effStatus === 'completado' && !effNonRecordable) {
      // trackNumber faltante
      if (effTrackNumber === null) {
        if (mode === 'audited') {
          maxTrack++;
          effTrackNumber = maxTrack;
          fields.push('trackNumber');
          warnings.push(`Track asignado por reconstrucción: ${maxTrack}`);
          auditRows.push({
            segmentId: s.id,
            segmentName: s.name,
            field: 'trackNumber',
            problem: 'Completado sin Track real',
            action: `Track ${maxTrack} asignado solo en export`,
            severity: 'warning',
          });
        } else {
          auditRows.push({
            segmentId: s.id,
            segmentName: s.name,
            field: 'trackNumber',
            problem: 'Completado sin Track real',
            action: 'Campo vacío (modo estricto)',
            severity: 'error',
          });
        }
      }

      // startedAt: NUNCA new Date(). Solo timestampInicio como alternativa.
      if (!effStartedAt) {
        if (mode === 'audited' && s.timestampInicio) {
          effStartedAt = s.timestampInicio;
          timestampSourceStart = 'timestampInicio';
          fields.push('startedAt');
          warnings.push('startedAt reconstruido desde timestampInicio');
          auditRows.push({
            segmentId: s.id,
            segmentName: s.name,
            field: 'startedAt',
            problem: 'Completado sin startedAt real',
            action: 'Reconstruido desde timestampInicio (origen alternativo)',
            severity: 'warning',
          });
        } else {
          // Sin dato real ni alternativo: queda vacío. NO se inventa fecha.
          timestampSourceStart = 'vacío';
          auditRows.push({
            segmentId: s.id,
            segmentName: s.name,
            field: 'startedAt',
            problem: 'Completado sin startedAt real',
            action: mode === 'audited'
              ? 'Sin alternativa disponible: campo vacío (no se inventa fecha)'
              : 'Campo vacío (modo estricto)',
            severity: 'error',
          });
        }
      }

      // endedAt: NUNCA new Date(). Solo timestampFin como alternativa.
      if (!effEndedAt) {
        if (mode === 'audited' && s.timestampFin) {
          effEndedAt = s.timestampFin;
          timestampSourceEnd = 'timestampFin';
          fields.push('endedAt');
          warnings.push('endedAt reconstruido desde timestampFin');
          auditRows.push({
            segmentId: s.id,
            segmentName: s.name,
            field: 'endedAt',
            problem: 'Completado sin endedAt real',
            action: 'Reconstruido desde timestampFin (origen alternativo)',
            severity: 'warning',
          });
        } else {
          timestampSourceEnd = 'vacío';
          auditRows.push({
            segmentId: s.id,
            segmentName: s.name,
            field: 'endedAt',
            problem: 'Completado sin endedAt real',
            action: mode === 'audited'
              ? 'Sin alternativa disponible: campo vacío (no se inventa fecha)'
              : 'Campo vacío (modo estricto)',
            severity: 'error',
          });
        }
      }
    }

    return {
      seg: s,
      autofixApplied: fields.length > 0,
      autofixFields: fields,
      timestampSourceStart,
      timestampSourceEnd,
      exportWarning: warnings.join(' · '),
      effTrackNumber,
      effStartedAt,
      effEndedAt,
      effStatus,
      effNonRecordable,
    };
  });

  return { audited, auditRows };
}

function durationSeconds(start?: string | null, end?: string | null): number | null {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return ms > 0 ? Math.round(ms / 1000) : null;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function computeFinalStatus(seg: Segment, effStatus: Segment['status']): string {
  if (effStatus === 'completado' && (seg.repeatNumber || 0) > 1) return 'Repetido';
  if (effStatus === 'completado') return 'Grabado';
  if (seg.nonRecordable) return 'No grabable';
  return 'Pendiente';
}

/** Añade una hoja con cabecera + filas a partir de objetos planos. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addSheetFromObjects(wb: any, sheetName: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    const ws = wb.addWorksheet(sheetName);
    return ws;
  }
  const headers = Object.keys(rows[0]);
  const ws = wb.addWorksheet(sheetName);
  ws.columns = headers.map((h) => ({
    header: h,
    key: h,
    width: Math.min(60, Math.max(h.length, ...rows.map((r) => String(r[h] ?? '').length)) + 2),
  }));
  rows.forEach((r) => ws.addRow(r));
  ws.getRow(1).font = { bold: true };
  return ws;
}

export interface ExportRouteOptions {
  selectedIds?: Set<string>;
  f5Events?: F5Event[];
  persistentEvents?: PersistentEvent[];
  mode?: ExportMode;
  /**
   * Si true, devuelve el workbook construido en lugar de descargarlo.
   * Útil para tests.
   */
  returnWorkbook?: boolean;
}

export interface ExportRouteResult {
  fileName: string;
  mode: ExportMode;
  auditRows: ExportAuditRow[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workbook?: any;
}

export async function exportRouteToExcel(
  route: Route,
  incidents: Incident[],
  selectedIdsOrOptions?: Set<string> | ExportRouteOptions,
  f5Events?: F5Event[],
  persistentEvents?: PersistentEvent[],
): Promise<ExportRouteResult> {
  // Compatibilidad hacia atrás: tercer parámetro puede ser Set<string> u opciones.
  let opts: ExportRouteOptions;
  if (selectedIdsOrOptions instanceof Set) {
    opts = {
      selectedIds: selectedIdsOrOptions,
      f5Events,
      persistentEvents,
      mode: 'strict',
    };
  } else {
    opts = selectedIdsOrOptions ?? {};
  }
  const mode: ExportMode = opts.mode ?? 'strict';

  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();

  const exportSegments = opts.selectedIds && opts.selectedIds.size > 0
    ? route.segments.filter((s) => opts.selectedIds!.has(s.id))
    : route.segments;

  const exportIncidents = opts.selectedIds && opts.selectedIds.size > 0
    ? incidents.filter((i) => opts.selectedIds!.has(i.segmentId))
    : incidents;

  const { audited, auditRows } = buildAuditedSegments(exportSegments, mode);

  const trackOrderMap = new Map<string, number>();
  const trackSegGroups = new Map<string, string[]>();
  audited.forEach((a) => {
    if (a.effTrackNumber !== null && a.effStatus === 'completado') {
      const key = `${a.seg.workDay ?? 0}_${a.effTrackNumber}`;
      if (!trackSegGroups.has(key)) trackSegGroups.set(key, []);
      trackSegGroups.get(key)!.push(a.seg.id);
    }
  });
  trackSegGroups.forEach((ids) => {
    ids.forEach((id, idx) => trackOrderMap.set(id, idx + 1));
  });

  // Sheet 1: Tramos
  const segData = audited.map((a) => {
    const seg = a.seg;
    const segIncidents = exportIncidents.filter((i) => i.segmentId === seg.id);
    const distKm = segmentDistanceKm(seg.coordinates);
    const trackReal = a.effNonRecordable ? '' : (a.effTrackNumber ?? '');
    const durSec = durationSeconds(a.effStartedAt, a.effEndedAt);
    return {
      'ID_EMPRESA': seg.companySegmentId || seg.kmlId || '',
      'NOMBRE_TRAMO': seg.name,
      'Ident. Tramo': seg.kmlId || seg.companySegmentId || seg.kmlMeta?.identtramo || '',
      'CAPA': seg.layer || 'Sin capa',
      'DIA': a.effStatus === 'completado' ? (seg.workDay ?? '') : '',
      'TRACK': a.effStatus === 'completado' ? trackReal : '',
      'ORDEN_EN_TRACK': a.effStatus === 'completado' ? (seg.segmentOrder ?? trackOrderMap.get(seg.id) ?? '') : '',
      'ESTADO': STATUS_LABELS[a.effStatus] || a.effStatus,
      'INCIDENCIA': segIncidents.length > 0 ? segIncidents.map(i => i.category).join(', ') : '',
      'HORA_INICIO': a.effStartedAt ?? '',
      'HORA_FIN': !a.effNonRecordable ? (a.effEndedAt ?? '') : '',
      'DURACION (s)': durSec ?? '',
      'DURACION': formatDuration(durSec),
      'Distancia (km)': Math.round(distKm * 100) / 100,
      'Coord. Inicio Lat': seg.coordinates[0]?.lat ?? '',
      'Coord. Inicio Lng': seg.coordinates[0]?.lng ?? '',
      'Coord. Fin Lat': seg.coordinates[seg.coordinates.length - 1]?.lat ?? '',
      'Coord. Fin Lng': seg.coordinates[seg.coordinates.length - 1]?.lng ?? '',
      'Carretera': seg.kmlMeta?.carretera || '',
      'Tipo KML': seg.kmlMeta?.tipo || '',
      'Calzada': seg.kmlMeta?.calzada || '',
      'Sentido': seg.kmlMeta?.sentido || '',
      'PK Inicial': seg.kmlMeta?.pkInicial || '',
      'PK Final': seg.kmlMeta?.pkFinal || '',
      'Tipo': TYPE_LABELS[seg.type] || seg.type,
      'Dirección': DIRECTION_LABELS[seg.direction] || seg.direction,
      'NOTAS': seg.notes || '',
      'Track planificado': seg.plannedTrackNumber ?? '',
      'Tracks anteriores': seg.trackHistory.length > 0 ? seg.trackHistory.join(', ') : '',
      'Estado final': computeFinalStatus(seg, a.effStatus),
      'Nº repetición': seg.repeatNumber || 0,
      'No grabable': seg.nonRecordable ? 'Sí' : '',
      'Repetir': seg.needsRepeat ? 'Sí' : '',
      'Track invalidado por': seg.invalidatedByTrack ?? '',
      'Incidencias (total)': segIncidents.length,
      'SEG_INICIO_TRACK': seg.segmentStartSeconds ?? '',
      'SEG_FIN_TRACK': seg.segmentEndSeconds ?? '',
      // Auditoría export
      'AUTOFIX_APPLIED': a.autofixApplied ? 'Sí' : '',
      'AUTOFIX_FIELDS': a.autofixFields.join(', '),
      'TIMESTAMP_SOURCE_START': a.timestampSourceStart,
      'TIMESTAMP_SOURCE_END': a.timestampSourceEnd,
      'EXPORT_WARNING': a.exportWarning,
    };
  });
  addSheetFromObjects(wb, 'Tramos', segData);

  // Sheet 2: Incidencias
  if (exportIncidents.length > 0) {
    const incData = exportIncidents.map((inc) => {
      const seg = route.segments.find((s) => s.id === inc.segmentId);
      return {
        'Track real': inc.trackAtIncident ?? '',
        'Track intento': inc.invalidatedBlock ? (inc.trackAtIncident ?? '') : '',
        'Tramo': seg?.name ?? inc.segmentId,
        'Capa': seg?.layer || 'Sin capa',
        'Categoría': inc.category,
        'Impacto': IMPACT_LABELS[inc.impact] || inc.impact,
        'Invalida bloque': inc.invalidatedBlock ? 'Sí' : 'No',
        'Nota': inc.note || '',
        'Fecha/Hora': new Date(inc.timestamp).toLocaleString('es-ES'),
        'Lat': inc.location?.lat ?? '',
        'Lng': inc.location?.lng ?? '',
      };
    });
    addSheetFromObjects(wb, 'Incidencias', incData);
  }

  // Sheet 3: Resumen
  const totalSegments = audited.length;
  const recorded = audited.filter((a) => a.effStatus === 'completado').length;
  const repeated = audited.filter((a) => (a.seg.repeatNumber || 0) > 1 && a.effStatus === 'completado').length;
  const nonRecordable = audited.filter((a) => a.seg.nonRecordable).length;
  const needsRepeat = audited.filter((a) => a.seg.needsRepeat).length;
  const uniqueTracks = new Set(audited.filter((a) => a.effTrackNumber !== null).map((a) => a.effTrackNumber)).size;
  const uniqueWorkDays = new Set(audited.filter((a) => a.seg.workDay != null).map((a) => a.seg.workDay)).size;

  let totalRecordingMs = 0;
  audited.forEach((a) => {
    const dur = durationSeconds(a.effStartedAt, a.effEndedAt);
    if (dur !== null && dur > 0) totalRecordingMs += dur * 1000;
  });
  const totalHours = Math.floor(totalRecordingMs / 3600000);
  const totalMins = Math.floor((totalRecordingMs % 3600000) / 60000);
  const totalSecs = Math.floor((totalRecordingMs % 60000) / 1000);

  const summaryData = [
    { 'Métrica': 'Modo de exportación', 'Valor': mode === 'audited' ? 'Con correcciones auditadas' : 'Estricto (sin reconstrucción)' },
    { 'Métrica': 'Código proyecto', 'Valor': route.projectCode || '' },
    { 'Métrica': 'Nombre proyecto', 'Valor': route.projectName || '' },
    { 'Métrica': 'Operador', 'Valor': route.operator || '' },
    { 'Métrica': 'Vehículo', 'Valor': route.vehicle || '' },
    { 'Métrica': 'Climatología', 'Valor': route.weather || '' },
    { 'Métrica': '', 'Valor': '' },
    { 'Métrica': 'Tramos totales', 'Valor': totalSegments },
    { 'Métrica': 'Tramos grabados', 'Valor': recorded },
    { 'Métrica': 'Tramos repetidos', 'Valor': repeated },
    { 'Métrica': 'Tramos pendientes repetir', 'Valor': needsRepeat },
    { 'Métrica': 'Tramos no grabables', 'Valor': nonRecordable },
    { 'Métrica': 'Tramos pendientes', 'Valor': totalSegments - recorded - nonRecordable },
    { 'Métrica': 'Tracks ejecutados', 'Valor': uniqueTracks },
    { 'Métrica': 'Días de trabajo', 'Valor': uniqueWorkDays },
    { 'Métrica': 'Tiempo total grabación', 'Valor': `${totalHours}h ${totalMins}m ${totalSecs}s` },
    { 'Métrica': 'Incidencias totales', 'Valor': exportIncidents.length },
    { 'Métrica': 'Hallazgos export (auditoría)', 'Valor': auditRows.length },
  ];
  addSheetFromObjects(wb, 'Resumen', summaryData);

  // Sheet 4: Eventos F5
  const exportF5Events = opts.f5Events || [];
  const relevantF5 = opts.selectedIds && opts.selectedIds.size > 0
    ? exportF5Events.filter((e) => opts.selectedIds!.has(e.segmentId))
    : exportF5Events;

  if (relevantF5.length > 0) {
    const f5Data = relevantF5.map((evt) => {
      const seg = route.segments.find((s) => s.id === evt.segmentId);
      return {
        'ID_EMPRESA': evt.companySegmentId || seg?.companySegmentId || '',
        'NOMBRE_TRAMO': seg?.name || evt.segmentId,
        'DIA': evt.workDay ?? '',
        'TRACK': evt.trackNumber ?? '',
        'TIPO_EVENTO_F5': evt.eventType,
        'PK_METROS': evt.distanceMarker ?? '',
        'HORA_CONFIRMACION': evt.confirmedAt ? new Date(evt.confirmedAt).toLocaleString('es-ES') : '',
        'ESTADO_CONFIRMACION': evt.confirmedByUser ? 'Confirmado' : 'Pendiente',
        'INTENTO': evt.attemptNumber ?? 0,
      };
    });
    addSheetFromObjects(wb, 'Eventos F5', f5Data);
  }

  // Sheet 5: Event Log
  const allEvents = opts.persistentEvents || [];
  if (allEvents.length > 0) {
    const evtData = allEvents.map((evt) => ({
      'Timestamp': evt.timestamp,
      'Tipo evento': evt.eventType,
      'Día trabajo': evt.workDay ?? '',
      'Track': evt.trackNumber ?? '',
      'Tramo ID': evt.segmentId ?? '',
      'Payload': evt.payload ? JSON.stringify(evt.payload) : '',
    }));
    addSheetFromObjects(wb, 'Event Log', evtData);
  }

  // Sheet 6: Validación Export — siempre presente, también con 0 hallazgos.
  const validationRows = auditRows.length > 0
    ? auditRows.map((r) => ({
        'Tramo ID': r.segmentId,
        'Tramo': r.segmentName,
        'Campo afectado': r.field,
        'Problema detectado': r.problem,
        'Acción aplicada': r.action,
        'Severidad': r.severity,
        'Modo export': mode,
        'Modifica campaña': 'No (solo afecta a este Excel)',
      }))
    : [{
        'Tramo ID': '',
        'Tramo': '—',
        'Campo afectado': '',
        'Problema detectado': 'Sin hallazgos',
        'Acción aplicada': '—',
        'Severidad': 'info',
        'Modo export': mode,
        'Modifica campaña': 'No',
      }];
  addSheetFromObjects(wb, 'Validación Export', validationRows);

  const suffix = mode === 'audited' ? '_corregido' : '';
  const fileName = `${route.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_hoja_de_ruta${suffix}.xlsx`;

  if (opts.returnWorkbook) {
    return { fileName, mode, auditRows, workbook: wb };
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return { fileName, mode, auditRows };
}
