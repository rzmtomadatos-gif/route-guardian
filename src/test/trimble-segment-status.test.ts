import { describe, it, expect } from 'vitest';
import { deriveTrimbleSegmentStatus } from '@/utils/trimble/recording-queue';
import type { SegmentCapture, TrimbleFieldStatus, TrimbleQaStatus } from '@/types/trimble';

function cap(p: Partial<SegmentCapture> & { segmentId: string; runId: string; endedAt: string | null }): SegmentCapture {
  return {
    id: p.id ?? `c-${Math.random()}`,
    segmentId: p.segmentId,
    runId: p.runId,
    missionId: p.missionId ?? 'm1',
    startedAt: p.startedAt ?? '2025-01-01T10:00:00.000Z',
    endedAt: p.endedAt,
    fieldStatus: (p.fieldStatus ?? 'en_captura') as TrimbleFieldStatus,
    qaStatus: (p.qaStatus ?? null) as TrimbleQaStatus | null,
  };
}

describe('deriveTrimbleSegmentStatus', () => {
  it('captura abierta del segmento en run activo → en_captura', () => {
    const c = cap({ segmentId: 'A', runId: 'r1', endedAt: null, fieldStatus: 'en_captura' });
    expect(deriveTrimbleSegmentStatus('A', [c], 'r1')).toBe('en_captura');
  });

  it('sin capturas → pendiente', () => {
    expect(deriveTrimbleSegmentStatus('A', [], null)).toBe('pendiente');
  });

  it('última cerrada con qaStatus procesado_ok gana sobre previa descartada', () => {
    const older = cap({ segmentId: 'A', runId: 'r1', endedAt: '2025-01-01T11:00:00.000Z', fieldStatus: 'capturado_pendiente_proceso', qaStatus: 'descartado_por_calidad' });
    const newer = cap({ segmentId: 'A', runId: 'r2', endedAt: '2025-01-02T11:00:00.000Z', fieldStatus: 'capturado_pendiente_proceso', qaStatus: 'procesado_ok' });
    expect(deriveTrimbleSegmentStatus('A', [older, newer], null)).toBe('procesado_ok');
  });

  it('última cerrada con qaStatus descartado gana sobre previa OK', () => {
    const older = cap({ segmentId: 'A', runId: 'r1', endedAt: '2025-01-01T11:00:00.000Z', qaStatus: 'procesado_ok', fieldStatus: 'capturado_pendiente_proceso' });
    const newer = cap({ segmentId: 'A', runId: 'r2', endedAt: '2025-01-02T11:00:00.000Z', qaStatus: 'descartado_por_calidad', fieldStatus: 'capturado_pendiente_proceso' });
    expect(deriveTrimbleSegmentStatus('A', [older, newer], null)).toBe('descartado_por_calidad');
  });

  it('última cerrada sin qaStatus, fieldStatus repetir → repetir', () => {
    const c = cap({ segmentId: 'A', runId: 'r1', endedAt: '2025-01-01T11:00:00.000Z', fieldStatus: 'repetir' });
    expect(deriveTrimbleSegmentStatus('A', [c], null)).toBe('repetir');
  });

  it('captura abierta en otro run distinto del activo no aplica', () => {
    const c = cap({ segmentId: 'A', runId: 'rOther', endedAt: null, fieldStatus: 'en_captura' });
    expect(deriveTrimbleSegmentStatus('A', [c], 'rActive')).toBe('pendiente');
  });
});
