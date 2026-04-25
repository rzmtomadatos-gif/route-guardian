import { describe, it, expect } from 'vitest';
import { __testing } from '@/utils/excel-export-v2';
import type { Segment, Incident, F5Event } from '@/types/route';

const { autoFixCopy, buildQualityFindings, safe, statusLabel, formatDuration } = __testing;

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
    const { fixed, fixes } = autoFixCopy(segs);
    expect(segs).toEqual(before); // original intact
    expect(fixed[0].trackNumber).toBe(1);
    expect(fixed[0].startedAt).toBeTruthy();
    expect(fixed[0].endedAt).toBeTruthy();
    expect(fixes.length).toBeGreaterThanOrEqual(3);
    expect(fixes.every((f) => f.reason.startsWith('Autofix:'))).toBe(true);
  });

  it('reverts completado+nonRecordable to posible_repetir on copy only', () => {
    const segs = [mkSeg({ status: 'completado', nonRecordable: true, trackNumber: 5 })];
    const { fixed, fixes } = autoFixCopy(segs);
    expect(segs[0].status).toBe('completado');
    expect(fixed[0].status).toBe('posible_repetir');
    expect(fixed[0].trackNumber).toBeNull();
    expect(fixes[0].field).toBe('status');
  });

  it('does not touch already-valid segments', () => {
    const segs = [mkSeg({
      status: 'completado',
      trackNumber: 1,
      startedAt: '2026-01-01T10:00:00Z',
      endedAt: '2026-01-01T10:05:00Z',
    })];
    const { fixed, fixes } = autoFixCopy(segs);
    expect(fixes).toHaveLength(0);
    expect(fixed[0]).toEqual(segs[0]);
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
    const findings = buildQualityFindings(segs, [], [], [], true);
    expect(findings).toHaveLength(1);
    expect(findings[0].status).toBe('OK');
  });

  it('flags autofix records as REVISAR', () => {
    const segs = [mkSeg({ status: 'completado', companySegmentId: 'BOA_1' })];
    const { fixed, fixes } = autoFixCopy(segs);
    const findings = buildQualityFindings(fixed, [], [], fixes, true);
    expect(findings.some((f) => f.status === 'REVISAR' && f.reason.includes('Autofix'))).toBe(true);
  });

  it('flags duplicate tracks in RST OFF', () => {
    const segs = [
      mkSeg({ id: 'a', status: 'completado', trackNumber: 5, companySegmentId: 'X1' }),
      mkSeg({ id: 'b', status: 'completado', trackNumber: 5, companySegmentId: 'X2' }),
    ];
    const findings = buildQualityFindings(segs, [], [], [], false);
    const dups = findings.filter((f) => f.field === 'trackNumber' && f.reason.includes('repetido'));
    expect(dups).toHaveLength(2);
  });

  it('flags missing companySegmentId', () => {
    const segs = [mkSeg({ companySegmentId: undefined })];
    const findings = buildQualityFindings(segs, [], [], [], true);
    expect(findings.some((f) => f.field === 'companySegmentId')).toBe(true);
  });

  it('flags incident that invalidated block as REVISAR', () => {
    const segs = [mkSeg({ id: 's1', companySegmentId: 'X' })];
    const inc: Incident = {
      id: 'i1', segmentId: 's1', category: 'obra', impact: 'critica_invalida_bloque',
      timestamp: '2026-01-01T10:00:00Z', invalidatedBlock: true, trackAtIncident: 3,
    };
    const findings = buildQualityFindings(segs, [inc], [], [], true);
    expect(findings.some((f) => f.field === 'invalidatedBlock' && f.status === 'REVISAR')).toBe(true);
  });

  it('flags unconfirmed F5 in RST mode', () => {
    const segs = [mkSeg({ id: 's1', companySegmentId: 'X' })];
    const evt: F5Event = {
      segmentId: 's1', eventType: 'inicio', distanceMarker: null,
      confirmedAt: '2026-01-01T10:00:00Z', confirmedByUser: false,
    };
    const findings = buildQualityFindings(segs, [], [evt], [], true);
    expect(findings.some((f) => f.sheet === '07_EVENTOS_F5' && f.status === 'REVISAR')).toBe(true);
  });
});
