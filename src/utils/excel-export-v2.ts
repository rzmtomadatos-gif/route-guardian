/**
 * Hoja de Ruta 2.0 — Exportación profesional con exceljs.
 *
 * Reglas críticas (no negociables):
 *  - exceljs se carga con dynamic import (nunca en el bundle inicial).
 *  - El autofix actúa SOLO sobre una copia de exportación, nunca muta el estado persistido.
 *  - Cada autofix queda registrado en la hoja 09_VALIDACION_CALIDAD con estado REVISAR
 *    y motivo legible para el auditor.
 *  - Datos faltantes se marcan como "NO REGISTRADO". No se inventa información.
 *  - El export clásico (excel-export.ts) no se toca.
 */

import type {
  Route,
  Segment,
  Incident,
  F5Event,
  SegmentCorrection,
  CorrectableField,
} from '@/types/route';
import type { PersistentEvent, EventType } from '@/utils/persistence';
import { segmentDistanceKm, haversineMeters } from '@/utils/geo-distance';
import {
  getConsolidatedSegments,
  getActiveCorrectionsByField,
  readFieldFromSegment,
} from '@/utils/gabinete/consolidate';
import { getFieldLabel, formatCorrectionValue } from '@/utils/gabinete/field-labels';

// ───────── Constantes ─────────
const NA = 'NO REGISTRADO';

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

const INCIDENT_CATEGORY_LABELS: Record<string, string> = {
  lluvia: 'Lluvia',
  niebla: 'Niebla',
  bache: 'Bache',
  obra: 'Obra',
  carretera_cortada: 'Carretera cortada',
  inundacion: 'Inundación',
  accidente: 'Accidente',
  obstaculo: 'Obstáculo',
  acceso_imposible: 'Acceso imposible',
  trafico_extremo: 'Tráfico extremo',
  error_sistema_pc360: 'Error PC360',
  error_sistema_pc2: 'Error PC2',
  error_sistema_linux: 'Error Linux',
  otro: 'Otro',
};

const EVENT_TYPE_LABELS: Partial<Record<EventType, string>> = {
  CAMPAIGN_IMPORTED: 'Campaña importada',
  CAMPAIGN_EXPORTED: 'Campaña exportada',
  ROUTE_LOADED: 'Ruta cargada',
  TRACK_OPENED: 'Track abierto',
  TRACK_CLOSED: 'Track cerrado',
  SEGMENT_STARTED: 'Tramo iniciado',
  SEGMENT_COMPLETED: 'Tramo completado',
  SEGMENT_SKIPPED: 'Tramo saltado',
  SEGMENT_RESET: 'Tramo reiniciado',
  SEGMENT_REPEATED: 'Tramo repetido',
  SEGMENT_CANCELLED: 'Tramo cancelado',
  SEGMENT_STATUS_CHANGED: 'Cambio estado',
  INCIDENT_RECORDED: 'Incidencia',
  NAV_STARTED: 'Navegación iniciada',
  NAV_STOPPED: 'Navegación detenida',
  WORK_DAY_CHANGED: 'Cambio de jornada',
  HW_CONFIRM_F5: 'F5 confirmado',
  HW_CONFIRM_F7: 'F7 fin adquisición',
  HW_CONFIRM_F9: 'F9 modo transporte',
  NAV_STATE_CHANGED: 'Cambio estado nav.',
  SEGMENT_CORRECTION_APPLIED: 'Corrección aplicada',
  SEGMENT_CORRECTION_REVERTED: 'Corrección revertida',
  MIGRATION_FROM_LOCALSTORAGE: 'Migración almacenamiento',
};

// ───────── Paleta operativa (estilo elegante imprimible) ─────────
const COLORS = {
  headerBg: 'FF1F3A5F',         // azul navy
  headerFg: 'FFFFFFFF',
  zebraEven: 'FFF7F9FC',
  zebraOdd: 'FFFFFFFF',
  border: 'FFD0D7DE',

  // estados
  completed: 'FFE2EFDA',        // verde claro
  pending: 'FFFFF2CC',          // amarillo claro
  inProgress: 'FFFCE4D6',       // naranja claro
  nonRecordable: 'FFE7E6E6',    // gris
  needsRepeat: 'FFFCE4D6',
  invalidated: 'FFFFC7CE',      // rojo claro

  // calidad
  ok: 'FFC6EFCE',
  review: 'FFFFEB9C',
  error: 'FFFFC7CE',

  banner: 'FF1F3A5F',
  bannerFg: 'FFFFFFFF',
  subBanner: 'FFEAF2FB',
};

// ───────── Tipos auxiliares ─────────
export interface QualityFinding {
  sheet: string;
  row: string;
  segmentId: string;
  segmentName: string;
  field: string;
  status: 'OK' | 'REVISAR' | 'ERROR';
  reason: string;
}

export interface AutoFixRecord {
  segmentId: string;
  segmentName: string;
  field: string;
  original: unknown;
  applied: unknown;
  reason: string;
}

export interface AutoFixSkipped {
  segmentId: string;
  segmentName: string;
  field: string;
  reason: string;
  severity: 'REVISAR' | 'ERROR';
}

interface ExportContext {
  route: Route;
  incidents: Incident[];
  f5Events: F5Event[];
  persistentEvents: PersistentEvent[];
  selectedIds?: Set<string>;
  segmentCorrections: SegmentCorrection[];
}

// ───────── Utilidades ─────────
function safe(value: unknown): string {
  if (value === null || value === undefined || value === '') return NA;
  return String(value);
}

function safeNum(value: unknown): number | string {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return NA;
}

function fmtDate(iso?: string | null): string {
  if (!iso) return NA;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return NA;
    return d.toLocaleString('es-ES');
  } catch {
    return NA;
  }
}

function durationSeconds(start?: string | null, end?: string | null): number | null {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return ms > 0 ? Math.round(ms / 1000) : null;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return NA;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

function gmapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function statusLabel(seg: Segment): string {
  if (seg.status === 'completado' && (seg.repeatNumber || 0) > 1) return 'Repetido';
  if (seg.status === 'completado') return 'Grabado';
  if (seg.nonRecordable) return 'No grabable';
  if (seg.needsRepeat) return 'Pendiente (repetir)';
  return STATUS_LABELS[seg.status] || seg.status;
}

function statusFill(label: string): string | null {
  if (label.startsWith('Grabado') || label === 'Repetido') return COLORS.completed;
  if (label === 'No grabable') return COLORS.nonRecordable;
  if (label.startsWith('Pendiente')) return COLORS.pending;
  if (label === 'En progreso') return COLORS.inProgress;
  if (label.startsWith('Posible repetir')) return COLORS.needsRepeat;
  return null;
}

// ───────── Autofix sobre copia ─────────
/**
 * Aplica correcciones automáticas SOLO sobre un clon del array.
 *
 * `protectedByField`: para cada segId, conjunto de campos con corrección de
 * gabinete activa. El autofix NUNCA pisa esos campos: emite un `skipped`
 * (REVISAR o ERROR según gravedad).
 *
 * `startedAt`/`endedAt` NO son `CorrectableField` → no son protegibles por
 * gabinete; se siguen infiriendo cuando faltan (autofix `applied` REVISAR).
 *
 * El estado persistido NO se toca.
 */
function autoFixCopy(
  segments: Segment[],
  protectedByField?: Map<string, Set<CorrectableField>>,
): { fixed: Segment[]; applied: AutoFixRecord[]; skipped: AutoFixSkipped[] } {
  const applied: AutoFixRecord[] = [];
  const skipped: AutoFixSkipped[] = [];
  let maxTrack = 0;
  segments.forEach((s) => {
    if (s.trackNumber !== null && s.trackNumber > maxTrack) maxTrack = s.trackNumber;
    s.trackHistory.forEach((t) => { if (t > maxTrack) maxTrack = t; });
  });

  const isProtected = (segId: string, field: CorrectableField): boolean =>
    protectedByField?.get(segId)?.has(field) ?? false;

  const fixed = segments.map((seg) => {
    const copy: Segment = {
      ...seg,
      kmlMeta: { ...seg.kmlMeta },
      trackHistory: [...seg.trackHistory],
      coordinates: seg.coordinates,
    };

    // Caso 1: completado pero marcado no grabable
    if (copy.status === 'completado' && copy.nonRecordable) {
      const statusProtected = isProtected(copy.id, 'status');
      const nrProtected = isProtected(copy.id, 'nonRecordable');
      if (statusProtected || nrProtected) {
        skipped.push({
          segmentId: copy.id,
          segmentName: copy.name,
          field: statusProtected ? 'status' : 'nonRecordable',
          severity: 'ERROR',
          reason:
            'Inconsistencia crítica: tramo completado y no grabable simultáneamente con corrección de gabinete activa. Resolver manualmente.',
        });
        // NO mutamos: respetar la decisión humana, dejar el conflicto visible.
        return copy;
      }
      applied.push({
        segmentId: copy.id,
        segmentName: copy.name,
        field: 'status',
        original: 'completado',
        applied: 'posible_repetir',
        reason: 'Autofix: tramo marcado completado y no grabable simultáneamente.',
      });
      copy.status = 'posible_repetir';
      copy.trackNumber = null;
      copy.endedAt = null;
      return copy;
    }

    if (copy.status !== 'completado') return copy;

    if (copy.trackNumber === null) {
      if (isProtected(copy.id, 'trackNumber')) {
        skipped.push({
          segmentId: copy.id,
          segmentName: copy.name,
          field: 'trackNumber',
          severity: 'REVISAR',
          reason: 'Track null tras corrección de gabinete; verificar consolidado.',
        });
      } else {
        maxTrack++;
        applied.push({
          segmentId: copy.id,
          segmentName: copy.name,
          field: 'trackNumber',
          original: null,
          applied: maxTrack,
          reason: 'Autofix: track inferido (completado sin track).',
        });
        copy.trackNumber = maxTrack;
      }
    }
    if (!copy.startedAt) {
      const inferred = copy.timestampInicio || new Date().toISOString();
      applied.push({
        segmentId: copy.id,
        segmentName: copy.name,
        field: 'startedAt',
        original: null,
        applied: inferred,
        reason: 'Autofix: timestamp de inicio inferido.',
      });
      copy.startedAt = inferred;
    }
    if (!copy.endedAt) {
      const inferred = copy.timestampFin || new Date().toISOString();
      applied.push({
        segmentId: copy.id,
        segmentName: copy.name,
        field: 'endedAt',
        original: null,
        applied: inferred,
        reason: 'Autofix: timestamp de fin inferido.',
      });
      copy.endedAt = inferred;
    }
    return copy;
  });

  return { fixed, applied, skipped };
}

// ───────── Validación de calidad (auditoría real) ─────────
function buildQualityFindings(
  exportSegments: Segment[],
  incidents: Incident[],
  f5Events: F5Event[],
  applied: AutoFixRecord[],
  skipped: AutoFixSkipped[],
  scopedCorrections: SegmentCorrection[],
  rawById: Map<string, Segment>,
  fixedById: Map<string, Segment>,
  rstMode: boolean,
): QualityFinding[] {
  const findings: QualityFinding[] = [];

  // 1a. Autofixes APLICADOS (REVISAR)
  applied.forEach((fx) => {
    findings.push({
      sheet: '05_DETALLE_TECNICO_TRAMOS',
      row: fx.segmentId,
      segmentId: fx.segmentId,
      segmentName: fx.segmentName,
      field: fx.field,
      status: 'REVISAR',
      reason: `${fx.reason} (original=${JSON.stringify(fx.original)} → aplicado=${JSON.stringify(fx.applied)})`,
    });
  });

  // 1b. Autofixes OMITIDOS por corrección de gabinete (REVISAR o ERROR)
  skipped.forEach((sk) => {
    findings.push({
      sheet: '05_DETALLE_TECNICO_TRAMOS',
      row: sk.segmentId,
      segmentId: sk.segmentId,
      segmentName: sk.segmentName,
      field: sk.field,
      status: sk.severity,
      reason: `Autofix omitido por corrección de gabinete: ${sk.reason}`,
    });
  });

  // 1c. Correcciones de gabinete activas — auditoría obligatoria, valor original tomado del RAW
  scopedCorrections.forEach((c) => {
    const raw = rawById.get(c.segmentId);
    if (!raw) return;
    const consolidated = fixedById.get(c.segmentId);
    const rawValue = readFieldFromSegment(raw, c.field);
    const finalValue = consolidated ? readFieldFromSegment(consolidated, c.field) : c.newValue;
    findings.push({
      sheet: '05_DETALLE_TECNICO_TRAMOS',
      row: c.segmentId,
      segmentId: c.segmentId,
      segmentName: raw.name,
      field: getFieldLabel(c.field),
      status: 'REVISAR',
      reason: `Corrección de gabinete · original=${formatCorrectionValue(rawValue)} → consolidado=${formatCorrectionValue(finalValue)} · «${c.reason || 'sin motivo registrado'}» · por ${c.correctedBy} el ${fmtDate(c.correctedAt)}`,
    });
  });

  // 2. Tramos completados sin coordenadas válidas
  exportSegments.forEach((s) => {
    if (s.status === 'completado' && (!s.coordinates || s.coordinates.length < 2)) {
      findings.push({
        sheet: '05_DETALLE_TECNICO_TRAMOS', row: s.id, segmentId: s.id, segmentName: s.name,
        field: 'coordinates', status: 'ERROR',
        reason: 'Tramo completado sin geometría suficiente (<2 puntos).',
      });
    }
  });

  // 3. Tracks duplicados en RST OFF
  if (!rstMode) {
    const completedWithTrack = exportSegments.filter((s) => s.status === 'completado' && s.trackNumber !== null);
    const trackCounts = new Map<number, Segment[]>();
    completedWithTrack.forEach((s) => {
      const arr = trackCounts.get(s.trackNumber!) || [];
      arr.push(s);
      trackCounts.set(s.trackNumber!, arr);
    });
    trackCounts.forEach((segs, track) => {
      if (segs.length > 1) {
        segs.forEach((s) => findings.push({
          sheet: '05_DETALLE_TECNICO_TRAMOS', row: s.id, segmentId: s.id, segmentName: s.name,
          field: 'trackNumber', status: 'REVISAR',
          reason: `Track ${track} repetido en RST OFF (debería ser único).`,
        }));
      }
    });
  }

  // 4. Tramos sin companySegmentId
  exportSegments.forEach((s) => {
    if (!s.companySegmentId) {
      findings.push({
        sheet: '05_DETALLE_TECNICO_TRAMOS', row: s.id, segmentId: s.id, segmentName: s.name,
        field: 'companySegmentId', status: 'REVISAR',
        reason: 'Tramo sin ID_EMPRESA asignado. Generar IDs únicos en Configuración.',
      });
    }
  });

  // 5. Incidencias críticas que invalidaron bloque
  incidents.forEach((inc) => {
    if (inc.invalidatedBlock) {
      const seg = exportSegments.find((s) => s.id === inc.segmentId);
      findings.push({
        sheet: '06_INCIDENCIAS', row: inc.id, segmentId: inc.segmentId,
        segmentName: seg?.name || inc.segmentId,
        field: 'invalidatedBlock', status: 'REVISAR',
        reason: `Incidencia crítica (${INCIDENT_CATEGORY_LABELS[inc.category] || inc.category}) invalidó el bloque del Track ${inc.trackAtIncident ?? '?'}.`,
      });
    }
  });

  // 6. Tramos pendientes de repetir
  exportSegments.forEach((s) => {
    if (s.needsRepeat) {
      findings.push({
        sheet: '05_DETALLE_TECNICO_TRAMOS', row: s.id, segmentId: s.id, segmentName: s.name,
        field: 'needsRepeat', status: 'REVISAR',
        reason: `Tramo marcado para repetir${s.invalidatedByTrack ? ` (Track ${s.invalidatedByTrack} invalidado).` : '.'}`,
      });
    }
  });

  // 7. F5 sin confirmación (modo RST)
  if (rstMode) {
    f5Events.forEach((evt) => {
      if (!evt.confirmedByUser) {
        const seg = exportSegments.find((s) => s.id === evt.segmentId);
        findings.push({
          sheet: '07_EVENTOS_F5', row: evt.segmentId, segmentId: evt.segmentId,
          segmentName: seg?.name || evt.segmentId, field: evt.eventType,
          status: 'REVISAR',
          reason: `Evento F5 ${evt.eventType} no confirmado por el operador.`,
        });
      }
    });
  }

  // 8. Si no hay findings → marca un OK explícito para que la hoja no quede vacía
  if (findings.length === 0) {
    findings.push({
      sheet: 'global', row: '-', segmentId: '-', segmentName: '-',
      field: 'integridad', status: 'OK',
      reason: 'Sin incidencias detectadas. La campaña pasa todas las validaciones automáticas.',
    });
  }

  return findings;
}

// ───────── Construcción del libro ─────────
async function buildWorkbook(ctx: ExportContext, rstMode: boolean) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'VialRoute';
  wb.created = new Date();
  wb.properties.date1904 = false;

  const route = ctx.route;
  const rawSegments = ctx.selectedIds && ctx.selectedIds.size > 0
    ? route.segments.filter((s) => ctx.selectedIds!.has(s.id))
    : route.segments;
  const rawIds = new Set(rawSegments.map((s) => s.id));
  const rawById = new Map<string, Segment>(rawSegments.map((s) => [s.id, s]));

  const allIncidents = ctx.selectedIds && ctx.selectedIds.size > 0
    ? ctx.incidents.filter((i) => ctx.selectedIds!.has(i.segmentId))
    : ctx.incidents;

  const allF5 = ctx.selectedIds && ctx.selectedIds.size > 0
    ? ctx.f5Events.filter((e) => ctx.selectedIds!.has(e.segmentId))
    : ctx.f5Events;

  // Pipeline gabinete → consolidado → autofix protegido
  // Filtrar correcciones a solo activas Y dentro del scope (ajuste obligatorio #5)
  const scopedCorrections = ctx.segmentCorrections.filter(
    (c) => c.active && rawIds.has(c.segmentId),
  );

  const consolidatedSegments = getConsolidatedSegments(rawSegments, scopedCorrections);

  // Mapa { segId → Map<field, corrección activa> } a partir del scope
  const activeByField = new Map<string, Map<CorrectableField, SegmentCorrection>>();
  rawSegments.forEach((s) => {
    const m = getActiveCorrectionsByField(s.id, scopedCorrections);
    if (m.size > 0) {
      const setMap = new Map<CorrectableField, SegmentCorrection>();
      m.forEach((corr, field) => setMap.set(field, corr));
      activeByField.set(s.id, setMap);
    }
  });
  const protectedFields = new Map<string, Set<CorrectableField>>();
  activeByField.forEach((fmap, segId) => {
    protectedFields.set(segId, new Set(fmap.keys()));
  });

  // Autofix SOLO sobre copia (consolidada), respetando campos protegidos
  const { fixed: segments, applied, skipped } = autoFixCopy(consolidatedSegments, protectedFields);
  const fixedById = new Map<string, Segment>(segments.map((s) => [s.id, s]));

  const findings = buildQualityFindings(
    segments, allIncidents, allF5,
    applied, skipped, scopedCorrections,
    rawById, fixedById, rstMode,
  );

  // ───────── 01_PORTADA ─────────
  const sh1 = wb.addWorksheet('01_PORTADA', { views: [{ showGridLines: false }] });
  sh1.columns = [{ width: 32 }, { width: 60 }];
  sh1.mergeCells('A1:B1');
  const titleCell = sh1.getCell('A1');
  titleCell.value = 'HOJA DE RUTA OPERATIVA';
  titleCell.font = { name: 'Calibri', size: 22, bold: true, color: { argb: COLORS.bannerFg } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.banner } };
  sh1.getRow(1).height = 40;

  sh1.mergeCells('A2:B2');
  const sub = sh1.getCell('A2');
  sub.value = 'VialRoute · Versión 2.0';
  sub.font = { italic: true, color: { argb: 'FF555555' } };
  sub.alignment = { horizontal: 'center' };

  const meta: Array<[string, string]> = [
    ['Proyecto', safe(route.projectName || route.name)],
    ['Código proyecto', safe(route.projectCode)],
    ['Cliente', safe(route.client)],
    ['Empresa ejecutora', safe(route.company)],
    ['Operador', safe(route.operator)],
    ['Conductor', safe(route.driver)],
    ['Vehículo', safe(route.vehicle)],
    ['Climatología', safe(route.weather)],
    ['Modo adquisición', rstMode ? 'RST (F5)' : 'GARMIN (tiempo)'],
    ['Tramos exportados', String(segments.length)],
    ['Incidencias', String(allIncidents.length)],
    ['Eventos F5', String(allF5.length)],
    ['Eventos en log', String(ctx.persistentEvents.length)],
    ['Fecha de exportación', new Date().toLocaleString('es-ES')],
    ['Archivo origen', safe(route.fileName)],
  ];
  meta.forEach((row, i) => {
    const r = sh1.getRow(i + 4);
    r.getCell(1).value = row[0];
    r.getCell(1).font = { bold: true, color: { argb: 'FF1F3A5F' } };
    r.getCell(1).alignment = { vertical: 'middle' };
    r.getCell(2).value = row[1];
    r.getCell(2).alignment = { vertical: 'middle' };
    if (row[1] === NA) r.getCell(2).font = { italic: true, color: { argb: 'FF999999' } };
    r.getCell(1).border = { bottom: { style: 'hair', color: { argb: COLORS.border } } };
    r.getCell(2).border = { bottom: { style: 'hair', color: { argb: COLORS.border } } };
  });

  // ───────── 02_RESUMEN_EJECUTIVO ─────────
  const sh2 = wb.addWorksheet('02_RESUMEN_EJECUTIVO', { views: [{ showGridLines: false }] });
  sh2.columns = [{ width: 35 }, { width: 18 }];
  bannerRow(sh2, 'A1:B1', 'RESUMEN EJECUTIVO');

  const totalSegs = segments.length;
  const recorded = segments.filter((s) => s.status === 'completado').length;
  const repeated = segments.filter((s) => (s.repeatNumber || 0) > 1 && s.status === 'completado').length;
  const nonRec = segments.filter((s) => s.nonRecordable).length;
  const needsRep = segments.filter((s) => s.needsRepeat).length;
  const pending = totalSegs - recorded - nonRec;
  const uniqueTracks = new Set(segments.filter((s) => s.trackNumber !== null).map((s) => s.trackNumber)).size;
  const uniqueWorkDays = new Set(segments.filter((s) => s.workDay != null).map((s) => s.workDay)).size;

  let totalRecMs = 0;
  segments.forEach((s) => {
    const d = durationSeconds(s.startedAt || s.timestampInicio, s.endedAt || s.timestampFin);
    if (d) totalRecMs += d * 1000;
  });
  const totalKmPlanned = segments.reduce((acc, s) => acc + segmentDistanceKm(s.coordinates), 0);
  const totalKmRecorded = segments
    .filter((s) => s.status === 'completado')
    .reduce((acc, s) => acc + segmentDistanceKm(s.coordinates), 0);

  const kpis: Array<[string, string | number]> = [
    ['Tramos totales', totalSegs],
    ['Tramos grabados', recorded],
    ['Tramos repetidos', repeated],
    ['Tramos pendientes', pending],
    ['Tramos pendientes repetir', needsRep],
    ['Tramos no grabables', nonRec],
    ['Tracks ejecutados', uniqueTracks],
    ['Días de trabajo', uniqueWorkDays],
    ['Km planificados (suma geometría)', totalKmPlanned.toFixed(2)],
    ['Km grabados (estimado)', totalKmRecorded.toFixed(2)],
    ['Tiempo total grabación', formatDuration(Math.floor(totalRecMs / 1000))],
    ['Incidencias totales', allIncidents.length],
    ['Incidencias críticas (invalidan bloque)', allIncidents.filter((i) => i.invalidatedBlock).length],
    ['Autofixes aplicados (revisar)', fixes.length],
  ];
  kpis.forEach((kv, i) => {
    const r = sh2.getRow(i + 3);
    r.getCell(1).value = kv[0];
    r.getCell(1).font = { bold: true };
    r.getCell(2).value = kv[1];
    r.getCell(2).alignment = { horizontal: 'right' };
    r.eachCell((c) => {
      c.border = { bottom: { style: 'hair', color: { argb: COLORS.border } } };
    });
  });
  sh2.getRow(2).getCell(1).value = 'KPI';
  sh2.getRow(2).getCell(2).value = 'Valor';
  styleHeaderRow(sh2.getRow(2));

  // ───────── 03_INDICE ─────────
  const sh3 = wb.addWorksheet('03_INDICE', { views: [{ showGridLines: false }] });
  sh3.columns = [{ width: 40 }, { width: 60 }];
  bannerRow(sh3, 'A1:B1', 'ÍNDICE');
  const indexEntries: Array<[string, string]> = [
    ['01_PORTADA', 'Datos del proyecto, cliente, empresa, operador, conductor.'],
    ['02_RESUMEN_EJECUTIVO', 'KPIs clave de campaña (tramos, tracks, km, incidencias).'],
    ['03_INDICE', 'Esta hoja.'],
    ['04_HOJA_RUTA_OPERATIVA', 'Vista humana agrupada por jornada y track.'],
    ['05_DETALLE_TECNICO_TRAMOS', 'Tabla técnica auditable. Una fila por tramo.'],
    ['06_INCIDENCIAS', 'Incidencias registradas con impacto y bloque afectado.'],
    ['07_EVENTOS_F5', 'Confirmaciones F5/F7/F9 del operador (modo RST).'],
    ['08_EVENT_LOG', 'Log persistente de eventos operativos.'],
    ['09_VALIDACION_CALIDAD', 'Checklist de auditoría: autofixes, errores, revisiones.'],
    ['10_DICCIONARIO', 'Definición de campos y abreviaturas.'],
  ];
  sh3.getRow(2).getCell(1).value = 'Hoja';
  sh3.getRow(2).getCell(2).value = 'Contenido';
  styleHeaderRow(sh3.getRow(2));
  indexEntries.forEach((e, i) => {
    const r = sh3.getRow(i + 3);
    const c1 = r.getCell(1);
    c1.value = { text: e[0], hyperlink: `#'${e[0]}'!A1` };
    c1.font = { color: { argb: 'FF1F6FEB' }, underline: true };
    r.getCell(2).value = e[1];
    r.eachCell((c) => {
      c.border = { bottom: { style: 'hair', color: { argb: COLORS.border } } };
    });
  });

  // ───────── 04_HOJA_RUTA_OPERATIVA ─────────
  const sh4 = wb.addWorksheet('04_HOJA_RUTA_OPERATIVA', { views: [{ state: 'frozen', ySplit: 2, showGridLines: false }] });
  const headers4 = ['Jornada', 'Track', 'Orden', 'ID_EMPRESA', 'Tramo', 'Estado', 'Inicio', 'Fin', 'Duración', 'Km', 'Incidencias', 'Notas'];
  setHeaders(sh4, headers4, [10, 8, 8, 16, 38, 18, 19, 19, 12, 9, 14, 40]);

  // Agrupar por workDay → trackNumber, ordenar
  type Group = { day: number | null; track: number | null; segs: Segment[] };
  const groupMap = new Map<string, Group>();
  segments.forEach((s) => {
    const key = `${s.workDay ?? 'X'}_${s.trackNumber ?? 'X'}`;
    if (!groupMap.has(key)) groupMap.set(key, { day: s.workDay ?? null, track: s.trackNumber ?? null, segs: [] });
    groupMap.get(key)!.segs.push(s);
  });
  const groups = Array.from(groupMap.values()).sort((a, b) => {
    const ad = a.day ?? 9999, bd = b.day ?? 9999;
    if (ad !== bd) return ad - bd;
    return (a.track ?? 9999) - (b.track ?? 9999);
  });

  let row4 = 3;
  let zebra = 0;
  groups.forEach((g) => {
    // Cabecera de grupo
    sh4.mergeCells(row4, 1, row4, headers4.length);
    const groupCell = sh4.getCell(row4, 1);
    groupCell.value = `Jornada ${g.day ?? NA} · Track ${g.track ?? NA} · ${g.segs.length} tramos`;
    groupCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    groupCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.banner } };
    groupCell.alignment = { vertical: 'middle' };
    sh4.getRow(row4).height = 20;
    row4++;

    g.segs.sort((a, b) => (a.segmentOrder ?? 0) - (b.segmentOrder ?? 0));
    g.segs.forEach((s) => {
      const segIncs = allIncidents.filter((i) => i.segmentId === s.id);
      const dur = durationSeconds(s.startedAt || s.timestampInicio, s.endedAt || s.timestampFin);
      const km = segmentDistanceKm(s.coordinates);
      const stLab = statusLabel(s);
      const r = sh4.getRow(row4);
      r.values = [
        g.day ?? NA,
        g.track ?? NA,
        s.segmentOrder ?? NA,
        safe(s.companySegmentId),
        s.name,
        stLab,
        fmtDate(s.startedAt || s.timestampInicio),
        fmtDate(s.endedAt || s.timestampFin),
        formatDuration(dur),
        Number(km.toFixed(3)),
        segIncs.length > 0 ? segIncs.map((i) => INCIDENT_CATEGORY_LABELS[i.category] || i.category).join(', ') : '',
        s.notes || '',
      ];
      const fill = statusFill(stLab);
      const bg = zebra % 2 === 0 ? COLORS.zebraEven : COLORS.zebraOdd;
      r.eachCell((c, col) => {
        c.border = { bottom: { style: 'hair', color: { argb: COLORS.border } } };
        if (col === 6 && fill) {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
          c.font = { bold: true };
        } else {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        }
        c.alignment = { vertical: 'middle', wrapText: col === 12 };
      });
      row4++;
      zebra++;
    });
  });
  sh4.autoFilter = { from: { row: 2, column: 1 }, to: { row: row4 - 1, column: headers4.length } };

  // ───────── 05_DETALLE_TECNICO_TRAMOS ─────────
  const sh5 = wb.addWorksheet('05_DETALLE_TECNICO_TRAMOS', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1, showGridLines: false }] });
  const headers5 = [
    'ID_EMPRESA', 'NOMBRE_TRAMO', 'Ident. KML', 'Capa', 'Jornada', 'Track', 'Orden',
    'Estado operativo', 'Estado final', 'Nº repetición', 'Repetir', 'No grabable', 'Track invalidado por',
    'Hora inicio', 'Hora fin', 'Duración (s)', 'Duración', 'Distancia (km)',
    'Lat inicio', 'Lng inicio', 'Lat fin', 'Lng fin', 'Maps inicio', 'Maps fin',
    'Carretera', 'Tipo KML', 'Calzada', 'Sentido', 'PK Inicial', 'PK Final',
    'Tipo', 'Dirección', 'Track planificado', 'Tracks anteriores', 'Notas',
    'Incidencias (total)', 'SEG_INICIO_TRACK', 'SEG_FIN_TRACK',
  ];
  setHeaders(sh5, headers5, headers5.map((h) => Math.max(h.length + 2, 12)));

  const fixedIds = new Set(fixes.map((f) => f.segmentId));
  segments.forEach((s, idx) => {
    const segIncs = allIncidents.filter((i) => i.segmentId === s.id);
    const km = segmentDistanceKm(s.coordinates);
    const dur = durationSeconds(s.startedAt || s.timestampInicio, s.endedAt || s.timestampFin);
    const start = s.coordinates[0];
    const end = s.coordinates[s.coordinates.length - 1];
    const stLab = statusLabel(s);

    const r = sh5.getRow(idx + 2);
    r.values = [
      safe(s.companySegmentId),
      s.name,
      safe(s.kmlId),
      safe(s.layer),
      s.workDay ?? NA,
      s.trackNumber ?? NA,
      s.segmentOrder ?? NA,
      STATUS_LABELS[s.status] || s.status,
      stLab,
      s.repeatNumber || 0,
      s.needsRepeat ? 'Sí' : '',
      s.nonRecordable ? 'Sí' : '',
      s.invalidatedByTrack ?? '',
      fmtDate(s.startedAt || s.timestampInicio),
      fmtDate(s.endedAt || s.timestampFin),
      dur ?? NA,
      formatDuration(dur),
      Number(km.toFixed(3)),
      start ? start.lat : NA,
      start ? start.lng : NA,
      end ? end.lat : NA,
      end ? end.lng : NA,
      start ? { text: 'Ver inicio', hyperlink: gmapsLink(start.lat, start.lng) } : NA,
      end ? { text: 'Ver fin', hyperlink: gmapsLink(end.lat, end.lng) } : NA,
      safe(s.kmlMeta?.carretera),
      safe(s.kmlMeta?.tipo),
      safe(s.kmlMeta?.calzada),
      safe(s.kmlMeta?.sentido),
      safe(s.kmlMeta?.pkInicial),
      safe(s.kmlMeta?.pkFinal),
      TYPE_LABELS[s.type] || s.type,
      DIRECTION_LABELS[s.direction] || s.direction,
      s.plannedTrackNumber ?? '',
      s.trackHistory.length > 0 ? s.trackHistory.join(', ') : '',
      s.notes || '',
      segIncs.length,
      s.segmentStartSeconds ?? '',
      s.segmentEndSeconds ?? '',
    ];

    const bg = idx % 2 === 0 ? COLORS.zebraEven : COLORS.zebraOdd;
    const wasFixed = fixedIds.has(s.id);
    r.eachCell((c, col) => {
      c.border = { bottom: { style: 'hair', color: { argb: COLORS.border } } };
      c.alignment = { vertical: 'middle' };
      const fill = wasFixed ? COLORS.review : bg;
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
      if (typeof c.value === 'object' && c.value && 'hyperlink' in (c.value as any)) {
        c.font = { color: { argb: 'FF1F6FEB' }, underline: true };
      }
      if (col === 9) {
        const f = statusFill(String(c.value));
        if (f) {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f } };
          c.font = { bold: true };
        }
      }
      if (c.value === NA || c.value === '') {
        // marca visual sutil
      }
    });
  });
  sh5.autoFilter = { from: { row: 1, column: 1 }, to: { row: segments.length + 1, column: headers5.length } };

  // ───────── 06_INCIDENCIAS ─────────
  const sh6 = wb.addWorksheet('06_INCIDENCIAS', { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
  const headers6 = ['Fecha/Hora', 'Tramo', 'ID_EMPRESA', 'Capa', 'Categoría', 'Impacto', 'Track', 'Invalida bloque', 'Lat', 'Lng', 'Maps', 'Nota'];
  setHeaders(sh6, headers6, [20, 30, 16, 16, 18, 22, 8, 16, 12, 12, 14, 40]);
  if (allIncidents.length === 0) {
    sh6.getRow(2).getCell(1).value = 'Sin incidencias registradas.';
    sh6.getRow(2).getCell(1).font = { italic: true, color: { argb: 'FF888888' } };
  } else {
    allIncidents.forEach((inc, idx) => {
      const seg = route.segments.find((s) => s.id === inc.segmentId);
      const r = sh6.getRow(idx + 2);
      r.values = [
        fmtDate(inc.timestamp),
        seg?.name || inc.segmentId,
        safe(seg?.companySegmentId),
        safe(seg?.layer),
        INCIDENT_CATEGORY_LABELS[inc.category] || inc.category,
        IMPACT_LABELS[inc.impact] || inc.impact,
        inc.trackAtIncident ?? NA,
        inc.invalidatedBlock ? 'Sí' : 'No',
        inc.location?.lat ?? NA,
        inc.location?.lng ?? NA,
        inc.location ? { text: 'Ver', hyperlink: gmapsLink(inc.location.lat, inc.location.lng) } : NA,
        inc.note || '',
      ];
      const bg = idx % 2 === 0 ? COLORS.zebraEven : COLORS.zebraOdd;
      r.eachCell((c, col) => {
        c.border = { bottom: { style: 'hair', color: { argb: COLORS.border } } };
        c.alignment = { vertical: 'middle', wrapText: col === 12 };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        if (col === 8 && c.value === 'Sí') {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.invalidated } };
          c.font = { bold: true };
        }
        if (col === 11 && typeof c.value === 'object') {
          c.font = { color: { argb: 'FF1F6FEB' }, underline: true };
        }
      });
    });
    sh6.autoFilter = { from: { row: 1, column: 1 }, to: { row: allIncidents.length + 1, column: headers6.length } };
  }

  // ───────── 07_EVENTOS_F5 ─────────
  const sh7 = wb.addWorksheet('07_EVENTOS_F5', { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
  const headers7 = ['Hora confirmación', 'Tramo', 'ID_EMPRESA', 'Jornada', 'Track', 'Tipo evento', 'PK (m)', 'Confirmado', 'Intento'];
  setHeaders(sh7, headers7, [20, 30, 16, 9, 8, 24, 10, 14, 9]);
  if (allF5.length === 0) {
    sh7.getRow(2).getCell(1).value = 'Sin eventos F5 registrados.';
    sh7.getRow(2).getCell(1).font = { italic: true, color: { argb: 'FF888888' } };
  } else {
    allF5.forEach((evt, idx) => {
      const seg = route.segments.find((s) => s.id === evt.segmentId);
      const r = sh7.getRow(idx + 2);
      r.values = [
        fmtDate(evt.confirmedAt),
        seg?.name || evt.segmentId,
        safe(evt.companySegmentId || seg?.companySegmentId),
        evt.workDay ?? NA,
        evt.trackNumber ?? NA,
        evt.eventType,
        evt.distanceMarker ?? '',
        evt.confirmedByUser ? 'Sí' : 'No',
        evt.attemptNumber ?? 0,
      ];
      const bg = idx % 2 === 0 ? COLORS.zebraEven : COLORS.zebraOdd;
      r.eachCell((c, col) => {
        c.border = { bottom: { style: 'hair', color: { argb: COLORS.border } } };
        c.alignment = { vertical: 'middle' };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        if (col === 8 && c.value === 'No') {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.review } };
        }
      });
    });
    sh7.autoFilter = { from: { row: 1, column: 1 }, to: { row: allF5.length + 1, column: headers7.length } };
  }

  // ───────── 08_EVENT_LOG ─────────
  const sh8 = wb.addWorksheet('08_EVENT_LOG', { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
  const headers8 = ['Timestamp', 'Tipo evento', 'Descripción', 'Jornada', 'Track', 'Tramo ID', 'Payload'];
  setHeaders(sh8, headers8, [22, 26, 26, 9, 8, 28, 60]);
  const events = ctx.persistentEvents;
  if (events.length === 0) {
    sh8.getRow(2).getCell(1).value = 'Log de eventos vacío.';
    sh8.getRow(2).getCell(1).font = { italic: true, color: { argb: 'FF888888' } };
  } else {
    events.forEach((evt, idx) => {
      const r = sh8.getRow(idx + 2);
      r.values = [
        fmtDate(evt.timestamp),
        evt.eventType,
        EVENT_TYPE_LABELS[evt.eventType] || evt.eventType,
        evt.workDay ?? '',
        evt.trackNumber ?? '',
        evt.segmentId ?? '',
        evt.payload ? JSON.stringify(evt.payload) : '',
      ];
      const bg = idx % 2 === 0 ? COLORS.zebraEven : COLORS.zebraOdd;
      r.eachCell((c, col) => {
        c.border = { bottom: { style: 'hair', color: { argb: COLORS.border } } };
        c.alignment = { vertical: 'middle', wrapText: col === 7 };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      });
    });
    sh8.autoFilter = { from: { row: 1, column: 1 }, to: { row: events.length + 1, column: headers8.length } };
  }

  // ───────── 09_VALIDACION_CALIDAD ─────────
  const sh9 = wb.addWorksheet('09_VALIDACION_CALIDAD', { views: [{ state: 'frozen', ySplit: 2, showGridLines: false }] });
  sh9.mergeCells('A1:G1');
  const banner9 = sh9.getCell('A1');
  banner9.value = 'CHECKLIST DE AUDITORÍA — Revisar cada fila REVISAR/ERROR antes de cerrar la campaña';
  banner9.font = { bold: true, color: { argb: COLORS.bannerFg } };
  banner9.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.banner } };
  banner9.alignment = { vertical: 'middle', horizontal: 'center' };
  sh9.getRow(1).height = 22;

  const headers9 = ['Estado', 'Hoja origen', 'ID Tramo', 'Tramo', 'Campo', 'Motivo', 'Acción recomendada'];
  setHeaders(sh9, headers9, [12, 26, 26, 28, 22, 70, 28], 2);
  findings.forEach((f, idx) => {
    const r = sh9.getRow(idx + 3);
    let action = '';
    if (f.status === 'OK') action = 'Ninguna.';
    else if (f.field === 'trackNumber') action = 'Validar track real con Event Log y corregir desde Gabinete.';
    else if (f.field === 'startedAt' || f.field === 'endedAt') action = 'Confirmar timestamps con grabación o GPS.';
    else if (f.field === 'companySegmentId') action = 'Generar IDs únicos en Configuración → Identificadores.';
    else if (f.field === 'needsRepeat') action = 'Programar re-grabación del tramo.';
    else if (f.field === 'invalidatedBlock') action = 'Marcar tramos del bloque para re-grabación.';
    else if (f.field === 'coordinates') action = 'Re-importar geometría desde KML original.';
    else action = 'Revisar manualmente y corregir desde Gabinete.';

    r.values = [f.status, f.sheet, f.segmentId, f.segmentName, f.field, f.reason, action];
    const fill = f.status === 'OK' ? COLORS.ok : f.status === 'ERROR' ? COLORS.error : COLORS.review;
    r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    r.getCell(1).font = { bold: true };
    r.eachCell((c, col) => {
      c.border = { bottom: { style: 'hair', color: { argb: COLORS.border } } };
      c.alignment = { vertical: 'middle', wrapText: col === 6 || col === 7 };
    });
  });
  sh9.autoFilter = { from: { row: 2, column: 1 }, to: { row: findings.length + 2, column: headers9.length } };

  // ───────── 10_DICCIONARIO ─────────
  const sh10 = wb.addWorksheet('10_DICCIONARIO', { views: [{ showGridLines: false }] });
  sh10.columns = [{ width: 28 }, { width: 70 }];
  bannerRow(sh10, 'A1:B1', 'DICCIONARIO DE CAMPOS');
  const dict: Array<[string, string]> = [
    ['ID_EMPRESA', 'Identificador único interno de empresa, formato p.ej. BOA_00012.'],
    ['Ident. KML', 'Identificador del tramo procedente del archivo KML original.'],
    ['Jornada', 'Día operativo (workDay). Avanza secuencialmente y nunca se reutiliza.'],
    ['Track', 'Número de bloque de grabación. En RST agrupa hasta 9 tramos.'],
    ['Orden', 'Posición del tramo dentro de su track (segmentOrder).'],
    ['Estado operativo', 'Estado interno: pendiente / en_progreso / completado / posible_repetir.'],
    ['Estado final', 'Estado consolidado: Grabado / Repetido / No grabable / Pendiente.'],
    ['Repetir', 'Tramo que necesita re-grabación (needsRepeat).'],
    ['No grabable', 'Tramo físicamente imposible de grabar (corte, inundación, acceso).'],
    ['Track invalidado por', 'Track que invalidó este bloque y forzó re-grabación.'],
    ['SEG_INICIO_TRACK / SEG_FIN_TRACK', 'Modo Garmin: segundos desde inicio del track al inicio/fin del tramo.'],
    ['Autofix', 'Corrección automática aplicada SOLO sobre la copia de exportación. El estado persistido NO se modifica.'],
    ['NO REGISTRADO', 'Dato no presente en la campaña. La aplicación nunca inventa valores.'],
    ['REVISAR', 'Hallazgo que requiere validación humana antes de cerrar la campaña.'],
    ['ERROR', 'Inconsistencia grave que impide auditar el dato.'],
  ];
  sh10.getRow(2).getCell(1).value = 'Campo / Concepto';
  sh10.getRow(2).getCell(2).value = 'Definición';
  styleHeaderRow(sh10.getRow(2));
  dict.forEach((d, i) => {
    const r = sh10.getRow(i + 3);
    r.getCell(1).value = d[0];
    r.getCell(1).font = { bold: true };
    r.getCell(2).value = d[1];
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    r.eachCell((c) => {
      c.border = { bottom: { style: 'hair', color: { argb: COLORS.border } } };
    });
  });

  return { wb, fixes, findings };
}

// ───────── Helpers de estilo ─────────
function styleHeaderRow(row: any) {
  row.eachCell((c: any) => {
    c.font = { bold: true, color: { argb: COLORS.headerFg } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } };
    c.alignment = { vertical: 'middle', horizontal: 'left' };
    c.border = { bottom: { style: 'thin', color: { argb: COLORS.border } } };
  });
  row.height = 22;
}

function setHeaders(sheet: any, headers: string[], widths: number[], rowIdx = 1) {
  headers.forEach((h, i) => {
    sheet.getColumn(i + 1).width = widths[i] ?? 14;
  });
  const r = sheet.getRow(rowIdx);
  headers.forEach((h, i) => { r.getCell(i + 1).value = h; });
  styleHeaderRow(r);
}

function bannerRow(sheet: any, range: string, text: string) {
  sheet.mergeCells(range);
  const cell = sheet.getCell(range.split(':')[0]);
  cell.value = text;
  cell.font = { bold: true, size: 14, color: { argb: COLORS.bannerFg } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.banner } };
  cell.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(1).height = 26;
}

// ───────── API pública ─────────
export interface ExportV2Result {
  fileName: string;
  fixes: AutoFixRecord[];
  findings: QualityFinding[];
}

export async function exportRouteToExcelV2(
  route: Route,
  incidents: Incident[],
  rstMode: boolean,
  options?: {
    selectedIds?: Set<string>;
    f5Events?: F5Event[];
    persistentEvents?: PersistentEvent[];
  },
): Promise<ExportV2Result> {
  const ctx: ExportContext = {
    route,
    incidents,
    f5Events: options?.f5Events || [],
    persistentEvents: options?.persistentEvents || [],
    selectedIds: options?.selectedIds,
  };

  const { wb, fixes, findings } = await buildWorkbook(ctx, rstMode);

  const ts = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;
  const baseName = (route.projectName || route.name || 'campana').replace(/[\\/:*?"<>|]/g, '_').trim() || 'campana';
  const fileName = `${baseName}_HojaRuta2.0_${stamp}.xlsx`;

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return { fileName, fixes, findings };
}

// Export internals para tests
export const __testing = { autoFixCopy, buildQualityFindings, safe, fmtDate, formatDuration, statusLabel };
