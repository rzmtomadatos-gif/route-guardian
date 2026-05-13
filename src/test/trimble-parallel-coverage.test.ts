/**
 * Test del helper §10: hasNearbyParallelCoverage.
 * Verifica que detecte cobertura cercana de otro tramo paralelo y que
 * descarte tramos lejanos o sin estado live activo.
 */
import { describe, it, expect } from 'vitest';
import { hasNearbyParallelCoverage } from '@/utils/trimble/parallel-coverage';
import type { Segment } from '@/types/route';

function seg(id: string, coords: [number, number][]): Segment {
  return {
    id,
    name: id,
    coordinates: coords.map(([lat, lng]) => ({ lat, lng })),
    status: 'pendiente',
    type: 'tramo',
    direction: 'creciente',
    layer: 'L',
    createdAt: '',
  } as unknown as Segment;
}

describe('hasNearbyParallelCoverage', () => {
  // ~10m apart at lat 40 (~ 0.0001° lat ≈ 11m)
  const A = seg('A', [[40.0, -3.7], [40.0, -3.69]]);
  const B_close = seg('B', [[40.0001, -3.7], [40.0001, -3.69]]); // ~11m
  const C_far = seg('C', [[40.01, -3.7], [40.01, -3.69]]); // ~1km

  it('detecta paralelo cercano cubierto live', () => {
    expect(
      hasNearbyParallelCoverage('A', [A, B_close], [{ segmentId: 'B', state: 'live_covered' }]),
    ).toBe(true);
  });

  it('ignora paralelo lejano', () => {
    expect(
      hasNearbyParallelCoverage('A', [A, C_far], [{ segmentId: 'C', state: 'live_covered' }]),
    ).toBe(false);
  });

  it('ignora si no hay items live activos', () => {
    expect(hasNearbyParallelCoverage('A', [A, B_close], [])).toBe(false);
  });

  it('no se cuenta a sí mismo', () => {
    expect(
      hasNearbyParallelCoverage('A', [A], [{ segmentId: 'A', state: 'live_covered' }]),
    ).toBe(false);
  });
});
