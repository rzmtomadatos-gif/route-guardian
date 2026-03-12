import * as XLSX from 'xlsx';
import type { Route, Segment, Incident, F5Event } from '@/types/route';
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

export interface ExportValidationError {
  segmentId: string;
  segmentName: string;
  issue: string;
}

/** Validate segments before export. Returns list of issues found. */
export function validateForExport(segments: Segment[], rstMode: boolean): ExportValidationError[] {
  const errors: ExportValidationError[] = [];

  // Check completed segments missing track or timestamps
  segments.forEach((s) => {
    // nonRecordable should never be Completado
    if (s.status === 'completado' && s.nonRecordable) {
      errors.push({ segmentId: s.id, segmentName: s.name, issue: 'Completado pero marcado no grabable (se revertirá)' });
    }
    if (s.status !== 'completado') return;
    if (s.trackNumber === null) {
      errors.push({ segmentId: s.id, segmentName: s.name, issue: 'Completado sin Track real' });
    }
    if (!s.startedAt) {
      errors.push({ segmentId: s.id, segmentName: s.name, issue: 'Completado sin Inicio tramo' });
    }
    if (!s.endedAt) {
      errors.push({ segmentId: s.id, segmentName: s.name, issue: 'Completado sin Fin tramo' });
    }
  });

  // Check duplicate tracks in RST OFF (each completed segment should have unique track)
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
          errors.push({ segmentId: '', segmentName: name, issue: `Track ${track} repetido (RST OFF: debe ser único)` });
        });
      }
    });
    if (rstOffCorrected > 0) {
      errors.unshift({ segmentId: '', segmentName: '—', issue: `RST OFF detectado · Tracks corregidos automáticamente: ${rstOffCorrected}` });
    }
  }

  return errors;
}

/** Auto-fix completed segments missing track/timestamps. Returns fixed copies. */
function autoFixSegments(exportSegments: Segment[]): Segment[] {
  let maxTrack = 0;
  exportSegments.forEach((s) => {
    if (s.trackNumber !== null && s.trackNumber > maxTrack) maxTrack = s.trackNumber;
    s.trackHistory.forEach((t) => { if (t > maxTrack) maxTrack = t; });
  });

  return exportSegments.map((s) => {
    // nonRecordable cannot stay as Completado
    if (s.status === 'completado' && s.nonRecordable) {
      return { ...s, status: 'posible_repetir' as const, trackNumber: null, endedAt: null };
    }
    if (s.status !== 'completado') return s;
    const fixes: Partial<Segment> = {};
    if (s.trackNumber === null) {
      maxTrack++;
      fixes.trackNumber = maxTrack;
    }
    if (!s.startedAt) fixes.startedAt = s.timestampInicio || new Date().toISOString();
    if (!s.endedAt) fixes.endedAt = s.timestampFin || new Date().toISOString();
    return Object.keys(fixes).length > 0 ? { ...s, ...fixes } : s;
  });
}

/** Compute duration in seconds between two ISO timestamps, or null */
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

function computeFinalStatus(seg: Segment): string {
  if (seg.status === 'completado' && (seg.repeatNumber || 0) > 1) return 'Repetido';
  if (seg.status === 'completado') return 'Grabado';
  if (seg.nonRecordable) return 'No grabable';
  return 'Pendiente';
}

export function exportRouteToExcel(route: Route, incidents: Incident[], selectedIds?: Set<string>, f5Events?: F5Event[]) {
  const wb = XLSX.utils.book_new();

  const exportSegments = selectedIds && selectedIds.size > 0
    ? route.segments.filter((s) => selectedIds.has(s.id))
    : route.segments;

  const exportIncidents = selectedIds && selectedIds.size > 0
    ? incidents.filter((i) => selectedIds.has(i.segmentId))
    : incidents;

  // Auto-fix completed segments missing track/timestamps
  const validatedSegments = autoFixSegments(exportSegments);

  // Build order-in-track map keyed by workDay + trackNumber
  const trackOrderMap = new Map<string, number>();
  const trackSegGroups = new Map<string, string[]>();
  validatedSegments.forEach((seg) => {
    if (seg.trackNumber !== null) {
      const key = `${seg.workDay ?? 0}_${seg.trackNumber}`;
      if (!trackSegGroups.has(key)) trackSegGroups.set(key, []);
      trackSegGroups.get(key)!.push(seg.id);
    }
  });
  trackSegGroups.forEach((ids) => {
    ids.forEach((id, idx) => trackOrderMap.set(id, idx + 1));
  });

  // Sheet 1: Segments — exact column order per spec
  const segData = validatedSegments.map((seg) => {
    const segIncidents = exportIncidents.filter((i) => i.segmentId === seg.id);
    const distKm = segmentDistanceKm(seg.coordinates);
    const trackReal = seg.nonRecordable ? '' : (seg.trackNumber ?? '');
    const durSec = durationSeconds(seg.startedAt || seg.timestampInicio, seg.endedAt || seg.timestampFin);
    return {
      'ID_EMPRESA': seg.companySegmentId || '',
      'NOMBRE_TRAMO': seg.name,
      'Ident. Tramo': seg.kmlMeta?.identtramo || '',
      'CAPA': seg.layer || 'Sin capa',
      'DIA': seg.workDay ?? '',
      'TRACK': trackReal,
      'ORDEN_EN_TRACK': seg.segmentOrder ?? trackOrderMap.get(seg.id) ?? '',
      'ESTADO': STATUS_LABELS[seg.status] || seg.status,
      'INCIDENCIA': segIncidents.length > 0 ? segIncidents.map(i => i.category).join(', ') : '',
      'HORA_INICIO': seg.startedAt || seg.timestampInicio || '',
      'HORA_FIN': !seg.nonRecordable ? (seg.endedAt || seg.timestampFin || '') : '',
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
      'Estado final': computeFinalStatus(seg),
      'Nº repetición': seg.repeatNumber || 0,
      'No grabable': seg.nonRecordable ? 'Sí' : '',
      'Repetir': seg.needsRepeat ? 'Sí' : '',
      'Track invalidado por': seg.invalidatedByTrack ?? '',
      'Incidencias (total)': segIncidents.length,
    };
  });

  const ws1 = XLSX.utils.json_to_sheet(segData);
  const colWidths = Object.keys(segData[0] || {}).map((key) => ({
    wch: Math.max(key.length, ...segData.map((r) => String((r as any)[key]).length)) + 2,
  }));
  ws1['!cols'] = colWidths;
  XLSX.utils.book_append_sheet(wb, ws1, 'Tramos');

  // Sheet 2: Incidents
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
    const ws2 = XLSX.utils.json_to_sheet(incData);
    const colWidths2 = Object.keys(incData[0] || {}).map((key) => ({
      wch: Math.max(key.length, ...incData.map((r) => String((r as any)[key]).length)) + 2,
    }));
    ws2['!cols'] = colWidths2;
    XLSX.utils.book_append_sheet(wb, ws2, 'Incidencias');
  }

  // Sheet 3: Summary
  const totalSegments = validatedSegments.length;
  const recorded = validatedSegments.filter((s) => s.status === 'completado').length;
  const repeated = validatedSegments.filter((s) => (s.repeatNumber || 0) > 1 && s.status === 'completado').length;
  const nonRecordable = validatedSegments.filter((s) => s.nonRecordable).length;
  const needsRepeat = validatedSegments.filter((s) => s.needsRepeat).length;
  const uniqueTracks = new Set(validatedSegments.filter((s) => s.trackNumber !== null).map((s) => s.trackNumber)).size;
  const uniqueWorkDays = new Set(validatedSegments.filter((s) => s.workDay != null).map((s) => s.workDay)).size;

  // Total recording time
  let totalRecordingMs = 0;
  validatedSegments.forEach((seg) => {
    const dur = durationSeconds(seg.startedAt || seg.timestampInicio, seg.endedAt || seg.timestampFin);
    if (dur !== null && dur > 0) totalRecordingMs += dur * 1000;
  });
  const totalHours = Math.floor(totalRecordingMs / 3600000);
  const totalMins = Math.floor((totalRecordingMs % 3600000) / 60000);
  const totalSecs = Math.floor((totalRecordingMs % 60000) / 1000);

  const summaryData = [
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
  ];
  const ws3 = XLSX.utils.json_to_sheet(summaryData);
  ws3['!cols'] = [{ wch: 25 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws3, 'Resumen');

  // Sheet 4: F5 Events
  const exportF5Events = f5Events || [];
  const relevantF5 = selectedIds && selectedIds.size > 0
    ? exportF5Events.filter((e) => selectedIds.has(e.segmentId))
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
    const ws4 = XLSX.utils.json_to_sheet(f5Data);
    const colWidths4 = Object.keys(f5Data[0] || {}).map((key) => ({
      wch: Math.max(key.length, ...f5Data.map((r) => String((r as any)[key]).length)) + 2,
    }));
    ws4['!cols'] = colWidths4;
    XLSX.utils.book_append_sheet(wb, ws4, 'Eventos F5');
  }

  const fileName = `${route.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_hoja_de_ruta.xlsx`;
  XLSX.writeFile(wb, fileName);
}
