import { describe, it, expect } from 'vitest';
import { exportRouteToExcel, validateForExport } from '@/utils/excel-export';
import type { Route, Segment, Incident } from '@/types/route';
import type { PersistentEvent } from '@/utils/persistence';

function mkSeg(overrides: Partial<Segment> = {}): Segment {
  return {
    id: 's1',
    routeId: 'r1',
    trackNumber: null,
    plannedTrackNumber: null,
    trackHistory: [],
    kmlId: 'KML1',
    name: 'Tramo 1',
    notes: '',
    coordinates: [{ lat: 40.4, lng: -3.7 }, { lat: 40.41, lng: -3.71 }],
    direction: 'creciente',
    type: 'tramo',
    status: 'pendiente',
    kmlMeta: {},
    ...overrides,
  };
}

function mkRoute(segments: Segment[]): Route {
  return {
    id: 'r1',
    name: 'Test Route',
    segments,
    optimizedOrder: segments.map((s) => s.id),
    availableLayers: [],
  } as unknown as Route;
}

async function getSheetRows(workbook: any, sheetName: string): Promise<Record<string, unknown>[]> {
  const ws = workbook.getWorksheet(sheetName);
  if (!ws) return [];
  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell((cell: any, col: number) => { headers[col - 1] = String(cell.value); });
  const rows: Record<string, unknown>[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      const v = row.getCell(i + 1).value;
      obj[h] = v;
    });
    rows.push(obj);
  }
  return rows;
}

describe('excel-export classic — modo estricto vs auditado', () => {
  it('strict: completado sin startedAt → HORA_INICIO vacía y NO usa new Date()', async () => {
    const seg = mkSeg({
      id: 's1', status: 'completado', trackNumber: 1,
      startedAt: null, endedAt: '2026-05-01T10:05:00.000Z',
      workDay: 1,
    });
    const route = mkRoute([seg]);
    const before = JSON.stringify(seg);
    const result = await exportRouteToExcel(route, [], { mode: 'strict', returnWorkbook: true });
    expect(JSON.stringify(seg)).toBe(before); // no muta
    const rows = await getSheetRows(result.workbook, 'Tramos');
    expect(rows[0]['HORA_INICIO']).toBe('');
    expect(rows[0]['AUTOFIX_APPLIED']).toBe('');
    expect(rows[0]['TIMESTAMP_SOURCE_START']).toBe('vacío');
    const audit = await getSheetRows(result.workbook, 'Validación Export');
    expect(audit.some((r) => r['Campo afectado'] === 'startedAt')).toBe(true);
  });

  it('strict: completado sin endedAt → HORA_FIN vacía', async () => {
    const seg = mkSeg({
      id: 's1', status: 'completado', trackNumber: 1,
      startedAt: '2026-05-01T10:00:00.000Z', endedAt: null,
    });
    const result = await exportRouteToExcel(mkRoute([seg]), [], { mode: 'strict', returnWorkbook: true });
    const rows = await getSheetRows(result.workbook, 'Tramos');
    expect(rows[0]['HORA_FIN']).toBe('');
    expect(rows[0]['TIMESTAMP_SOURCE_END']).toBe('vacío');
  });

  it('strict: completado sin trackNumber → TRACK vacío', async () => {
    const seg = mkSeg({
      id: 's1', status: 'completado', trackNumber: null,
      startedAt: '2026-05-01T10:00:00.000Z', endedAt: '2026-05-01T10:05:00.000Z',
    });
    const result = await exportRouteToExcel(mkRoute([seg]), [], { mode: 'strict', returnWorkbook: true });
    const rows = await getSheetRows(result.workbook, 'Tramos');
    expect(rows[0]['TRACK']).toBe('');
    expect(rows[0]['AUTOFIX_APPLIED']).toBe('');
  });

  it('strict: completado + nonRecordable → genera advertencia, no muta estado', async () => {
    const seg = mkSeg({
      id: 's1', status: 'completado', trackNumber: 1, nonRecordable: true,
      startedAt: '2026-05-01T10:00:00.000Z', endedAt: '2026-05-01T10:05:00.000Z',
    });
    const result = await exportRouteToExcel(mkRoute([seg]), [], { mode: 'strict', returnWorkbook: true });
    const rows = await getSheetRows(result.workbook, 'Tramos');
    expect(rows[0]['ESTADO']).toBe('Completado');
    expect(result.auditRows.some((r) => r.field === 'status')).toBe(true);
  });

  it('audited: timestamp solo se reconstruye desde timestampInicio/Fin, NUNCA new Date()', async () => {
    const seg = mkSeg({
      id: 's1', status: 'completado', trackNumber: 1,
      startedAt: null, endedAt: null,
      timestampInicio: '2026-05-01T09:00:00.000Z',
      timestampFin: '2026-05-01T09:10:00.000Z',
    });
    const result = await exportRouteToExcel(mkRoute([seg]), [], { mode: 'audited', returnWorkbook: true });
    const rows = await getSheetRows(result.workbook, 'Tramos');
    expect(rows[0]['HORA_INICIO']).toBe('2026-05-01T09:00:00.000Z');
    expect(rows[0]['HORA_FIN']).toBe('2026-05-01T09:10:00.000Z');
    expect(rows[0]['TIMESTAMP_SOURCE_START']).toBe('timestampInicio');
    expect(rows[0]['TIMESTAMP_SOURCE_END']).toBe('timestampFin');
    expect(rows[0]['AUTOFIX_APPLIED']).toBe('Sí');
    expect(String(rows[0]['AUTOFIX_FIELDS'])).toContain('startedAt');
  });

  it('audited: sin timestamp real ni alternativo → campo vacío, jamás fecha actual', async () => {
    const seg = mkSeg({
      id: 's1', status: 'completado', trackNumber: 1,
      startedAt: null, endedAt: null,
    });
    const result = await exportRouteToExcel(mkRoute([seg]), [], { mode: 'audited', returnWorkbook: true });
    const rows = await getSheetRows(result.workbook, 'Tramos');
    expect(rows[0]['HORA_INICIO']).toBe('');
    expect(rows[0]['HORA_FIN']).toBe('');
    expect(rows[0]['TIMESTAMP_SOURCE_START']).toBe('vacío');
    expect(rows[0]['TIMESTAMP_SOURCE_END']).toBe('vacío');
  });

  it('audited: trackNumber faltante se reconstruye con secuencia y queda anotado', async () => {
    const segs = [
      mkSeg({ id: 'a', status: 'completado', trackNumber: 5, startedAt: 't1', endedAt: 't2' }),
      mkSeg({ id: 'b', status: 'completado', trackNumber: null, startedAt: 't1', endedAt: 't2' }),
    ];
    const result = await exportRouteToExcel(mkRoute(segs), [], { mode: 'audited', returnWorkbook: true });
    const rows = await getSheetRows(result.workbook, 'Tramos');
    expect(rows[1]['TRACK']).toBe(6);
    expect(String(rows[1]['AUTOFIX_FIELDS'])).toContain('trackNumber');
  });

  it('Tramos incluye columnas de auditoría', async () => {
    const result = await exportRouteToExcel(
      mkRoute([mkSeg({ status: 'pendiente' })]),
      [],
      { mode: 'audited', returnWorkbook: true },
    );
    const ws = result.workbook.getWorksheet('Tramos');
    const headers: string[] = [];
    ws.getRow(1).eachCell((c: any) => headers.push(String(c.value)));
    expect(headers).toContain('AUTOFIX_APPLIED');
    expect(headers).toContain('AUTOFIX_FIELDS');
    expect(headers).toContain('TIMESTAMP_SOURCE_START');
    expect(headers).toContain('TIMESTAMP_SOURCE_END');
    expect(headers).toContain('EXPORT_WARNING');
  });

  it('Hoja "Validación Export" siempre presente', async () => {
    const result = await exportRouteToExcel(
      mkRoute([mkSeg({ status: 'pendiente' })]),
      [],
      { mode: 'strict', returnWorkbook: true },
    );
    expect(result.workbook.getWorksheet('Validación Export')).toBeTruthy();
  });

  it('Event Log se exporta cuando hay eventos', async () => {
    const events: PersistentEvent[] = [
      { id: 'e1', timestamp: '2026-05-01T10:00:00Z', eventType: 'TRACK_OPENED', workDay: 1, trackNumber: 1, segmentId: 's1', payload: {} } as any,
    ];
    const result = await exportRouteToExcel(
      mkRoute([mkSeg({ status: 'pendiente' })]),
      [],
      { mode: 'strict', persistentEvents: events, returnWorkbook: true },
    );
    expect(result.workbook.getWorksheet('Event Log')).toBeTruthy();
    const rows = await getSheetRows(result.workbook, 'Event Log');
    expect(rows.length).toBe(1);
  });

  it('validateForExport marca severidad y campo afectado', () => {
    const segs = [
      mkSeg({ id: '1', status: 'completado', trackNumber: null, startedAt: null, endedAt: null }),
    ];
    const errs = validateForExport(segs, true);
    const fields = errs.map((e) => e.field);
    expect(fields).toContain('trackNumber');
    expect(fields).toContain('startedAt');
    expect(fields).toContain('endedAt');
    expect(errs.every((e) => e.severity === 'error' || e.severity === 'warning')).toBe(true);
  });
});
