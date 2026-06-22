/**
 * BUG-VIEW-MODE-001 — Regresión.
 *
 * La vista por capas es transversal a todos los modos de adquisición.
 * La vista Trimble es específica del modo TRIMBLE_LIDAR.
 *
 * Estos tests blindan la regla:
 *   effectiveViewMode = isTrimbleMode ? persistedViewMode : 'layers';
 *
 * sin acoplarse al render completo de SegmentsPage (que arrastraría
 * GoogleMaps, sql.js, etc.). La función espejo reproduce 1:1 la lógica
 * implementada en src/pages/SegmentsPage.tsx tras la corrección del bug.
 */
import { describe, it, expect } from 'vitest';

type ViewMode = 'layers' | 'trimble';
type AcquisitionMode = 'RST' | 'GARMIN' | 'TRIMBLE_LIDAR';

function computeEffectiveViewMode(
  acquisitionMode: AcquisitionMode,
  persistedViewMode: ViewMode,
): ViewMode {
  const isTrimbleMode = acquisitionMode === 'TRIMBLE_LIDAR';
  return isTrimbleMode ? persistedViewMode : 'layers';
}

function shouldShowToggle(acquisitionMode: AcquisitionMode): boolean {
  return acquisitionMode === 'TRIMBLE_LIDAR';
}

describe('BUG-VIEW-MODE-001 — vista por capas transversal', () => {
  it('RST siempre fuerza vista por capas, aunque localStorage diga trimble', () => {
    expect(computeEffectiveViewMode('RST', 'trimble')).toBe('layers');
    expect(computeEffectiveViewMode('RST', 'layers')).toBe('layers');
  });

  it('Garmin siempre fuerza vista por capas, aunque localStorage diga trimble', () => {
    expect(computeEffectiveViewMode('GARMIN', 'trimble')).toBe('layers');
    expect(computeEffectiveViewMode('GARMIN', 'layers')).toBe('layers');
  });

  it('Trimble respeta la preferencia persistida', () => {
    expect(computeEffectiveViewMode('TRIMBLE_LIDAR', 'trimble')).toBe('trimble');
    expect(computeEffectiveViewMode('TRIMBLE_LIDAR', 'layers')).toBe('layers');
  });

  it('Toggle de vista solo se ofrece en modo Trimble', () => {
    expect(shouldShowToggle('RST')).toBe(false);
    expect(shouldShowToggle('GARMIN')).toBe(false);
    expect(shouldShowToggle('TRIMBLE_LIDAR')).toBe(true);
  });

  it('Trimble→RST: aunque se quedara persistido viewMode=trimble, RST no se queda atascado', () => {
    const persisted: ViewMode = 'trimble';
    expect(computeEffectiveViewMode('TRIMBLE_LIDAR', persisted)).toBe('trimble');
    expect(computeEffectiveViewMode('RST', persisted)).toBe('layers');
    expect(computeEffectiveViewMode('GARMIN', persisted)).toBe('layers');
  });
});
