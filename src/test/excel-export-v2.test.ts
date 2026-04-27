import { describe, it, expect } from 'vitest';
import { __testing } from '@/utils/excel-export-v2';
import type {
  Segment,
  Incident,
  F5Event,
  SegmentCorrection,
  CorrectableField,
  TrackGpsPoint,
} from '@/types/route';

const {
  autoFixCopy,
  buildQualityFindings,
  buildWorkbook,
  safe,
  getIdEmpresa,
  statusLabel,
  formatDuration,
  formatTrackSeconds,
  computeCumulativeDistanceFromGps,
  formatKmFromMeters,
} = __testing;

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

function mkCorrection(
  segmentId: string,
  field: CorrectableField,
  newValue: unknown,
  overrides: Partial<SegmentCorrection> = {},
): SegmentCorrection {
  return {
    id: `corr-${segmentId}-${field}`,
    segmentId,
    field,
    previousValue: null,
    newValue,
    reason: 'Motivo de prueba',
    correctedBy: 'gabinete@test',
    correctedByRole: 'gabinete',
    correctedAt: '2026-02-01T12:00:00Z',
    active: true,
    ...overrides,
  };
}

/** Helper alineado con el contrato actual de buildQualityFindings (9 args). */
function findings(
  segs: Segment[],
  incidents: Incident[] = [],
  f5: F5Event[] = [],
  applied: ReturnType<typeof autoFixCopy>['applied'] = [],
  skipped: ReturnType<typeof autoFixCopy>['skipped'] = [],
  corrections: SegmentCorrection[] = [],
  rstMode = true,
) {
  const rawById = new Map(segs.map((s) => [s.id, s]));
  const fixedById = new Map(segs.map((s) => [s.id, s]));
  return buildQualityFindings(
    segs, incidents, f5,
    applied, skipped, corrections,
    rawById, fixedById, rstMode,
  );
}

describe('safe()', () => {
  it('marks empty values as NO REGISTRADO', () => {
    expect(safe(null)).toBe('NO REGISTRADO');
    expect(safe(undefined)).toBe('NO REGISTRADO');
    expect(safe('')).toBe('NO REGISTRADO');
  });
  it('preserves non-empty values', () => {
    expect(safe('hola')).toBe('hola');
    expect(safe(42)).toBe('42');
  });
});

describe('formatDuration()', () => {
  it('returns NA for null', () => {
    expect(formatDuration(null)).toBe('NO REGISTRADO');
  });
  it('formats minutes and seconds', () => {
    expect(formatDuration(75)).toBe('1m 15s');
  });
  it('formats hours when >=3600', () => {
    expect(formatDuration(3725)).toBe('1h 2m 5s');
  });
});

describe('statusLabel()', () => {
  it('returns Repetido for completado with repeatNumber>1', () => {
    expect(statusLabel(mkSeg({ status: 'completado', repeatNumber: 2 }))).toBe('Repetido');
  });
  it('returns No grabable when nonRecordable', () => {
    expect(statusLabel(mkSeg({ nonRecordable: true }))).toBe('No grabable');
  });
  it('returns Grabado for plain completado', () => {
    expect(statusLabel(mkSeg({ status: 'completado' }))).toBe('Grabado');
  });
});

describe('autoFixCopy() — does NOT mutate originals', () => {
  it('infers track and timestamps for completado without them', () => {
    const segs = [mkSeg({ status: 'completado', trackNumber: null })];
    const before = JSON.parse(JSON.stringify(segs));
    const { fixed, applied, skipped } = autoFixCopy(segs);
    expect(segs).toEqual(before); // original intact
    expect(fixed[0].trackNumber).toBe(1);
    expect(fixed[0].startedAt).toBeTruthy();
    expect(fixed[0].endedAt).toBeTruthy();
    expect(applied.length).toBeGreaterThanOrEqual(3);
    expect(skipped).toHaveLength(0);
    expect(applied.every((f) => f.reason.startsWith('Autofix:'))).toBe(true);
  });

  it('reverts completado+nonRecordable to posible_repetir on copy only', () => {
    const segs = [mkSeg({ status: 'completado', nonRecordable: true, trackNumber: 5 })];
    const { fixed, applied, skipped } = autoFixCopy(segs);
    expect(segs[0].status).toBe('completado');
    expect(fixed[0].status).toBe('posible_repetir');
    expect(fixed[0].trackNumber).toBeNull();
    expect(applied[0].field).toBe('status');
    expect(skipped).toHaveLength(0);
  });

  it('does not touch already-valid segments', () => {
    const segs = [mkSeg({
      status: 'completado',
      trackNumber: 1,
      startedAt: '2026-01-01T10:00:00Z',
      endedAt: '2026-01-01T10:05:00Z',
    })];
    const { fixed, applied, skipped } = autoFixCopy(segs);
    expect(applied).toHaveLength(0);
    expect(skipped).toHaveLength(0);
    expect(fixed[0]).toEqual(segs[0]);
  });
});

describe('autoFixCopy() — protección de campos por gabinete', () => {
  it('omite el autofix de trackNumber si el campo está protegido', () => {
    const segs = [mkSeg({ id: 's1', status: 'completado', trackNumber: null, companySegmentId: 'X' })];
    const protectedFields = new Map<string, Set<CorrectableField>>([
      ['s1', new Set(['trackNumber'])],
    ]);
    const { fixed, applied, skipped } = autoFixCopy(segs, protectedFields);
    expect(fixed[0].trackNumber).toBeNull();
    expect(applied.find((a) => a.field === 'trackNumber')).toBeUndefined();
    expect(skipped.find((s) => s.field === 'trackNumber' && s.severity === 'REVISAR')).toBeTruthy();
  });

  it('emite ERROR cuando completado+nonRecordable y status protegido', () => {
    const segs = [mkSeg({
      id: 's1', status: 'completado', nonRecordable: true, trackNumber: 5,
    })];
    const protectedFields = new Map<string, Set<CorrectableField>>([
      ['s1', new Set(['status'])],
    ]);
    const { fixed, applied, skipped } = autoFixCopy(segs, protectedFields);
    // No mutación: estado se mantiene como gabinete decidió
    expect(fixed[0].status).toBe('completado');
    expect(fixed[0].nonRecordable).toBe(true);
    expect(applied).toHaveLength(0);
    expect(skipped[0].severity).toBe('ERROR');
    expect(skipped[0].reason).toContain('Inconsistencia crítica');
  });

  it('emite ERROR cuando completado+nonRecordable y nonRecordable protegido', () => {
    const segs = [mkSeg({
      id: 's1', status: 'completado', nonRecordable: true, trackNumber: 5,
    })];
    const protectedFields = new Map<string, Set<CorrectableField>>([
      ['s1', new Set(['nonRecordable'])],
    ]);
    const { applied, skipped } = autoFixCopy(segs, protectedFields);
    expect(applied).toHaveLength(0);
    expect(skipped[0].severity).toBe('ERROR');
    expect(skipped[0].field).toBe('nonRecordable');
  });

  it('startedAt/endedAt NO son protegibles (no están en CorrectableField) y siempre se infieren', () => {
    const segs = [mkSeg({
      id: 's1', status: 'completado', trackNumber: 1,
      timestampInicio: '2026-01-01T10:00:00Z',
      timestampFin: '2026-01-01T10:05:00Z',
    })];
    // Aunque añadiéramos protección espuria, no aplica: startedAt no es CorrectableField.
    const { applied } = autoFixCopy(segs);
    expect(applied.find((a) => a.field === 'startedAt')).toBeTruthy();
    expect(applied.find((a) => a.field === 'endedAt')).toBeTruthy();
  });
});

describe('buildQualityFindings()', () => {
  it('returns OK row when nothing wrong', () => {
    const segs = [mkSeg({
      status: 'completado',
      trackNumber: 1,
      startedAt: '2026-01-01T10:00:00Z',
      endedAt: '2026-01-01T10:05:00Z',
      companySegmentId: 'BOA_00001',
    })];
    const f = findings(segs);
    expect(f).toHaveLength(1);
    expect(f[0].status).toBe('OK');
  });

  it('flags autofix records as REVISAR', () => {
    const segs = [mkSeg({ status: 'completado', companySegmentId: 'BOA_1' })];
    const { fixed, applied, skipped } = autoFixCopy(segs);
    const f = findings(fixed, [], [], applied, skipped);
    expect(f.some((x) => x.status === 'REVISAR' && x.reason.includes('Autofix'))).toBe(true);
  });

  it('flags duplicate tracks in RST OFF', () => {
    const segs = [
      mkSeg({ id: 'a', status: 'completado', trackNumber: 5, companySegmentId: 'X1' }),
      mkSeg({ id: 'b', status: 'completado', trackNumber: 5, companySegmentId: 'X2' }),
    ];
    const f = findings(segs, [], [], [], [], [], false);
    const dups = f.filter((x) => x.field === 'trackNumber' && x.reason.includes('repetido'));
    expect(dups).toHaveLength(2);
  });

  it('flags missing companySegmentId', () => {
    const segs = [mkSeg({ companySegmentId: undefined })];
    const f = findings(segs);
    expect(f.some((x) => x.field === 'companySegmentId')).toBe(true);
  });

  it('flags incident that invalidated block as REVISAR', () => {
    const segs = [mkSeg({ id: 's1', companySegmentId: 'X' })];
    const inc: Incident = {
      id: 'i1', segmentId: 's1', category: 'obra', impact: 'critica_invalida_bloque',
      timestamp: '2026-01-01T10:00:00Z', invalidatedBlock: true, trackAtIncident: 3,
    };
    const f = findings(segs, [inc]);
    expect(f.some((x) => x.field === 'invalidatedBlock' && x.status === 'REVISAR')).toBe(true);
  });

  it('flags unconfirmed F5 in RST mode', () => {
    const segs = [mkSeg({ id: 's1', companySegmentId: 'X' })];
    const evt: F5Event = {
      segmentId: 's1', eventType: 'inicio', distanceMarker: null,
      confirmedAt: '2026-01-01T10:00:00Z', confirmedByUser: false,
    };
    const f = findings(segs, [], [evt]);
    expect(f.some((x) => x.sheet === '07_EVENTOS_F5' && x.status === 'REVISAR')).toBe(true);
  });
});

describe('buildQualityFindings() — correcciones de gabinete', () => {
  it('emite finding REVISAR por cada corrección activa, leyendo el original del RAW', () => {
    const raw = mkSeg({ id: 's1', workDay: undefined, companySegmentId: 'BOA_1' });
    const consolidated = mkSeg({ id: 's1', workDay: 1, companySegmentId: 'BOA_1' });
    const corr = mkCorrection('s1', 'workDay', 1, {
      previousValue: undefined,
      reason: 'Tramos huérfanos del primer día',
      correctedBy: 'ana@vialroute',
    });
    const rawById = new Map([['s1', raw]]);
    const fixedById = new Map([['s1', consolidated]]);
    const result = buildQualityFindings(
      [consolidated], [], [],
      [], [], [corr],
      rawById, fixedById, true,
    );
    const corrFinding = result.find((f) => f.reason.includes('Corrección de gabinete'));
    expect(corrFinding).toBeTruthy();
    expect(corrFinding!.status).toBe('REVISAR');
    expect(corrFinding!.reason).toContain('original=—'); // workDay raw era undefined
    expect(corrFinding!.reason).toContain('consolidado=1');
    expect(corrFinding!.reason).toContain('ana@vialroute');
    expect(corrFinding!.reason).toContain('Tramos huérfanos');
  });

  it('VALORES_ORIGINALES sale del raw, no de previousValue (cuando hay supersede)', () => {
    // Simulamos: raw.workDay = undefined → corr#1 puso 99 (superseded) → corr#2 puso 1 (activa).
    // El finding debe mostrar original=undefined (raw), no 99 (previousValue de corr#2).
    const raw = mkSeg({ id: 's1', workDay: undefined, companySegmentId: 'X' });
    const consolidated = mkSeg({ id: 's1', workDay: 1, companySegmentId: 'X' });
    const activeCorr = mkCorrection('s1', 'workDay', 1, {
      previousValue: 99, // valor intermedio, NO debe usarse
    });
    const rawById = new Map([['s1', raw]]);
    const fixedById = new Map([['s1', consolidated]]);
    const result = buildQualityFindings(
      [consolidated], [], [],
      [], [], [activeCorr],
      rawById, fixedById, true,
    );
    const corrFinding = result.find((f) => f.reason.includes('Corrección de gabinete'));
    expect(corrFinding!.reason).toContain('original=—'); // raw=undefined → "—"
    expect(corrFinding!.reason).not.toContain('original=99');
  });

  it('autofix omitido se reporta diferenciado del aplicado y respeta severity', () => {
    const segs = [mkSeg({ id: 's1', status: 'completado', companySegmentId: 'X', trackNumber: null })];
    const { applied, skipped } = autoFixCopy(segs, new Map([['s1', new Set(['trackNumber'])]]));
    const f = findings(segs, [], [], applied, skipped);
    const skippedFinding = f.find((x) => x.reason.includes('Autofix omitido'));
    expect(skippedFinding).toBeTruthy();
    expect(skippedFinding!.status).toBe('REVISAR');
    // applied.length no incluye al skipped
    expect(applied.find((a) => a.field === 'trackNumber')).toBeUndefined();
  });

  it('conflicto crítico (completado+nonRecordable protegido) sale como ERROR en findings', () => {
    const segs = [mkSeg({
      id: 's1', status: 'completado', nonRecordable: true, trackNumber: 5, companySegmentId: 'X',
    })];
    const { applied, skipped } = autoFixCopy(segs, new Map([['s1', new Set(['status'])]]));
    const f = findings(segs, [], [], applied, skipped);
    const errFinding = f.find((x) => x.status === 'ERROR' && x.reason.includes('Inconsistencia crítica'));
    expect(errFinding).toBeTruthy();
  });
});

describe('formatTrackSeconds()', () => {
  it('returns NO REGISTRADO for null/undefined/NaN', () => {
    expect(formatTrackSeconds(null)).toBe('NO REGISTRADO');
    expect(formatTrackSeconds(undefined)).toBe('NO REGISTRADO');
    expect(formatTrackSeconds(NaN)).toBe('NO REGISTRADO');
  });
  it('formats seconds as mm:ss with two digits', () => {
    expect(formatTrackSeconds(0)).toBe('00:00');
    expect(formatTrackSeconds(5)).toBe('00:05');
    expect(formatTrackSeconds(65)).toBe('01:05');
    expect(formatTrackSeconds(599)).toBe('09:59');
    expect(formatTrackSeconds(3600)).toBe('60:00');
  });
  it('floors decimals and clamps negatives to 0', () => {
    expect(formatTrackSeconds(12.9)).toBe('00:12');
    expect(formatTrackSeconds(-30)).toBe('00:00');
  });
});

describe('formatKmFromMeters()', () => {
  it('NA when null', () => {
    expect(formatKmFromMeters(null)).toBe('NO REGISTRADO');
  });
  it('converts to km with 3 decimals', () => {
    expect(formatKmFromMeters(1234)).toBe(1.234);
    expect(formatKmFromMeters(0)).toBe(0);
  });
});

describe('computeCumulativeDistanceFromGps()', () => {
  function pt(
    lat: number, lng: number, phase: 'transport' | 'recording', segmentId: string | null = null,
  ): TrackGpsPoint {
    return {
      timestamp: '2026-01-01T00:00:00Z',
      lat, lng,
      workDay: 1, trackNumber: 1,
      phase,
      segmentId,
      source: 'gps',
    };
  }

  it('returns null for empty/short arrays', () => {
    expect(computeCumulativeDistanceFromGps(null, 's1', 'start')).toBeNull();
    expect(computeCumulativeDistanceFromGps([], 's1', 'start')).toBeNull();
    expect(computeCumulativeDistanceFromGps([pt(40, -3, 'recording', 's1')], 's1', 'start')).toBeNull();
  });

  it('returns null when segment never appears in recording phase', () => {
    const points = [
      pt(40.0, -3.0, 'transport'),
      pt(40.001, -3.0, 'recording', 'OTHER'),
    ];
    expect(computeCumulativeDistanceFromGps(points, 's1', 'start')).toBeNull();
  });

  it('start uses cumulative distance to first matching recording point', () => {
    // 3 puntos transport, luego empieza recording de s1 en idx=3
    const points = [
      pt(40.0000, -3.0, 'transport'),
      pt(40.0010, -3.0, 'transport'),
      pt(40.0020, -3.0, 'transport'),
      pt(40.0030, -3.0, 'recording', 's1'),
      pt(40.0040, -3.0, 'recording', 's1'),
    ];
    const startM = computeCumulativeDistanceFromGps(points, 's1', 'start');
    const endM = computeCumulativeDistanceFromGps(points, 's1', 'end');
    expect(startM).toBeGreaterThan(300); // ~333m
    expect(startM).toBeLessThan(360);
    expect(endM!).toBeGreaterThan(startM!);
  });

  it('ignores points of other segments when locating boundaries', () => {
    const points = [
      pt(40.0000, -3.0, 'transport'),
      pt(40.0010, -3.0, 'recording', 'OTHER'),
      pt(40.0020, -3.0, 'recording', 's1'),
      pt(40.0030, -3.0, 'recording', 's1'),
      pt(40.0040, -3.0, 'recording', 'OTHER'),
    ];
    const startM = computeCumulativeDistanceFromGps(points, 's1', 'start')!;
    const endM = computeCumulativeDistanceFromGps(points, 's1', 'end')!;
    // start corresponde al idx=2 (~222m), end al idx=3 (~333m)
    expect(Math.round(startM)).toBeGreaterThan(200);
    expect(Math.round(startM)).toBeLessThan(240);
    expect(Math.round(endM)).toBeGreaterThan(310);
    expect(Math.round(endM)).toBeLessThan(360);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ID_EMPRESA — visibilidad sistemática en hojas de datos
// ─────────────────────────────────────────────────────────────────────────────

describe('getIdEmpresa()', () => {
  it('devuelve companySegmentId cuando existe', () => {
    expect(getIdEmpresa(mkSeg({ companySegmentId: 'BOA26_00470' }))).toBe('BOA26_00470');
  });
  it('devuelve NO REGISTRADO cuando falta', () => {
    expect(getIdEmpresa(mkSeg({ companySegmentId: undefined }))).toBe('NO REGISTRADO');
    expect(getIdEmpresa(null)).toBe('NO REGISTRADO');
  });
  it('NO usa segment.id como sustituto silencioso', () => {
    const seg = mkSeg({ id: 'internal-uuid-123', companySegmentId: undefined });
    expect(getIdEmpresa(seg)).not.toContain('internal-uuid-123');
  });
});

describe('buildQualityFindings() — companySegmentId en findings', () => {
  it('rellena companySegmentId desde el tramo afectado', () => {
    const segs = [mkSeg({ id: 's1', companySegmentId: 'BOA26_00001', needsRepeat: true })];
    const f = findings(segs);
    const fin = f.find((x) => x.field === 'needsRepeat');
    expect(fin?.companySegmentId).toBe('BOA26_00001');
  });

  it('rellena companySegmentId desde un F5Event si el tramo no lo tiene', () => {
    const segs = [mkSeg({ id: 's1', companySegmentId: undefined })];
    const evt: F5Event = {
      segmentId: 's1', companySegmentId: 'BOA26_FROM_F5',
      eventType: 'inicio', distanceMarker: null,
      confirmedAt: '2026-01-01T10:00:00Z', confirmedByUser: false,
    };
    const f = findings(segs, [], [evt]);
    const fin = f.find((x) => x.sheet === '07_EVENTOS_F5');
    expect(fin?.companySegmentId).toBe('BOA26_FROM_F5');
  });

  it('deja companySegmentId undefined cuando no hay dato (la hoja 09 mostrará NO REGISTRADO)', () => {
    const segs = [mkSeg({ id: 's1', companySegmentId: undefined, needsRepeat: true })];
    const f = findings(segs);
    const fin = f.find((x) => x.field === 'needsRepeat');
    expect(fin?.companySegmentId).toBeUndefined();
  });
});

describe('buildWorkbook() — ID_EMPRESA visible en hojas operativas', () => {
  function mkRoute(segs: Segment[]) {
    return {
      id: 'r1', name: 'Test Route', loadedAt: '2026-01-01T00:00:00Z',
      fileName: 'test.kml', segments: segs, optimizedOrder: segs.map((s) => s.id),
      projectName: 'Boadilla 2026', projectCode: 'BOA',
    } as any;
  }

  async function readSheet(wb: any, name: string) {
    const sh = wb.getWorksheet(name);
    const headers: string[] = [];
    const headerRow = sh.getRow(name === '09_VALIDACION_CALIDAD' ? 2 : 1);
    headerRow.eachCell((c: any, col: number) => { headers[col - 1] = String(c.value ?? ''); });
    return { sh, headers };
  }

  it('hoja 06 contiene columna ID_EMPRESA y muestra el companySegmentId del tramo', async () => {
    const segs = [mkSeg({ id: 's1', companySegmentId: 'BOA26_00010' })];
    const inc: Incident = {
      id: 'i1', segmentId: 's1', category: 'obra', impact: 'informativa',
      timestamp: '2026-01-01T10:00:00Z',
    };
    const { wb } = await buildWorkbook({
      route: mkRoute(segs), incidents: [inc], f5Events: [], persistentEvents: [],
      segmentCorrections: [],
    } as any, true);
    const { sh, headers } = await readSheet(wb, '06_INCIDENCIAS');
    expect(headers).toContain('ID_EMPRESA');
    const colIdx = headers.indexOf('ID_EMPRESA') + 1;
    expect(sh.getRow(2).getCell(colIdx).value).toBe('BOA26_00010');
  });

  it('hoja 06 muestra NO REGISTRADO si el tramo no tiene companySegmentId', async () => {
    const segs = [mkSeg({ id: 's1', companySegmentId: undefined })];
    const inc: Incident = {
      id: 'i1', segmentId: 's1', category: 'obra', impact: 'informativa',
      timestamp: '2026-01-01T10:00:00Z',
    };
    const { wb } = await buildWorkbook({
      route: mkRoute(segs), incidents: [inc], f5Events: [], persistentEvents: [],
      segmentCorrections: [],
    } as any, true);
    const { sh, headers } = await readSheet(wb, '06_INCIDENCIAS');
    const colIdx = headers.indexOf('ID_EMPRESA') + 1;
    expect(sh.getRow(2).getCell(colIdx).value).toBe('NO REGISTRADO');
  });

  it('hoja 07 contiene columna ID_EMPRESA con fallback evt.companySegmentId → segmento', async () => {
    const segs = [
      mkSeg({ id: 's1', companySegmentId: 'BOA_FROM_SEG' }),
      mkSeg({ id: 's2', companySegmentId: undefined }),
    ];
    const evts: F5Event[] = [
      { segmentId: 's1', eventType: 'inicio', distanceMarker: null,
        confirmedAt: '2026-01-01T10:00:00Z', confirmedByUser: true },
      { segmentId: 's2', companySegmentId: 'BOA_FROM_EVT', eventType: 'inicio',
        distanceMarker: null, confirmedAt: '2026-01-01T10:01:00Z', confirmedByUser: true },
    ];
    const { wb } = await buildWorkbook({
      route: mkRoute(segs), incidents: [], f5Events: evts, persistentEvents: [],
      segmentCorrections: [],
    } as any, true);
    const { sh, headers } = await readSheet(wb, '07_EVENTOS_F5');
    expect(headers).toContain('ID_EMPRESA');
    const colIdx = headers.indexOf('ID_EMPRESA') + 1;
    expect(sh.getRow(2).getCell(colIdx).value).toBe('BOA_FROM_SEG');
    expect(sh.getRow(3).getCell(colIdx).value).toBe('BOA_FROM_EVT');
  });

  it('hoja 09 contiene columna ID_EMPRESA y muestra el ID del tramo del finding', async () => {
    const segs = [mkSeg({ id: 's1', companySegmentId: 'BOA26_00099', needsRepeat: true })];
    const { wb } = await buildWorkbook({
      route: mkRoute(segs), incidents: [], f5Events: [], persistentEvents: [],
      segmentCorrections: [],
    } as any, true);
    const { sh, headers } = await readSheet(wb, '09_VALIDACION_CALIDAD');
    expect(headers).toContain('ID_EMPRESA');
    const colIdx = headers.indexOf('ID_EMPRESA') + 1;
    // Localiza la fila del finding needsRepeat
    let found = false;
    for (let r = 3; r <= sh.rowCount; r++) {
      if (String(sh.getRow(r).getCell(colIdx).value) === 'BOA26_00099') { found = true; break; }
    }
    expect(found).toBe(true);
  });

  it('hoja 09 muestra NO REGISTRADO en ID_EMPRESA cuando el tramo carece de él', async () => {
    const segs = [mkSeg({ id: 's1', companySegmentId: undefined, needsRepeat: true })];
    const { wb } = await buildWorkbook({
      route: mkRoute(segs), incidents: [], f5Events: [], persistentEvents: [],
      segmentCorrections: [],
    } as any, true);
    const { sh, headers } = await readSheet(wb, '09_VALIDACION_CALIDAD');
    const colIdx = headers.indexOf('ID_EMPRESA') + 1;
    let sawNA = false;
    for (let r = 3; r <= sh.rowCount; r++) {
      if (sh.getRow(r).getCell(colIdx).value === 'NO REGISTRADO') { sawNA = true; break; }
    }
    expect(sawNA).toBe(true);
  });

  it('hojas 04 y 05 mantienen columna ID_EMPRESA', async () => {
    const segs = [mkSeg({ id: 's1', companySegmentId: 'BOA_X', status: 'completado', trackNumber: 1, workDay: 1 })];
    const { wb } = await buildWorkbook({
      route: mkRoute(segs), incidents: [], f5Events: [], persistentEvents: [],
      segmentCorrections: [],
    } as any, true);
    const { headers: h4 } = await readSheet(wb, '04_HOJA_RUTA_OPERATIVA');
    const { headers: h5 } = await readSheet(wb, '05_DETALLE_TECNICO_TRAMOS');
    expect(h4).toContain('ID_EMPRESA');
    expect(h5).toContain('ID_EMPRESA');
  });

  it('portada, resumen, índice y event log NO añaden columna ID_EMPRESA', async () => {
    const segs = [mkSeg({ id: 's1', companySegmentId: 'BOA_X' })];
    const { wb } = await buildWorkbook({
      route: mkRoute(segs), incidents: [], f5Events: [], persistentEvents: [],
      segmentCorrections: [],
    } as any, true);
    for (const name of ['01_PORTADA', '02_RESUMEN_EJECUTIVO', '03_INDICE', '08_EVENT_LOG']) {
      const sh = wb.getWorksheet(name);
      // Recolecta TODOS los valores de las primeras 3 filas
      const cells: string[] = [];
      for (let r = 1; r <= 3; r++) {
        sh.getRow(r).eachCell((c: any) => cells.push(String(c.value ?? '')));
      }
      expect(cells.every((v) => v !== 'ID_EMPRESA')).toBe(true);
    }
  });

  it('exportación filtrada por selectedIds: solo aparecen ID_EMPRESA de tramos incluidos', async () => {
    const segs = [
      mkSeg({ id: 's1', companySegmentId: 'BOA_INCLUIDO' }),
      mkSeg({ id: 's2', companySegmentId: 'BOA_EXCLUIDO' }),
    ];
    const incs: Incident[] = [
      { id: 'i1', segmentId: 's1', category: 'obra', impact: 'informativa', timestamp: '2026-01-01T10:00:00Z' },
      { id: 'i2', segmentId: 's2', category: 'obra', impact: 'informativa', timestamp: '2026-01-01T10:00:00Z' },
    ];
    const { wb } = await buildWorkbook({
      route: mkRoute(segs), incidents: incs, f5Events: [], persistentEvents: [],
      segmentCorrections: [], selectedIds: new Set(['s1']),
    } as any, true);
    const { sh, headers } = await readSheet(wb, '06_INCIDENCIAS');
    const colIdx = headers.indexOf('ID_EMPRESA') + 1;
    const allValues: string[] = [];
    for (let r = 2; r <= sh.rowCount; r++) {
      allValues.push(String(sh.getRow(r).getCell(colIdx).value ?? ''));
    }
    expect(allValues).toContain('BOA_INCLUIDO');
    expect(allValues).not.toContain('BOA_EXCLUIDO');
  });
});
