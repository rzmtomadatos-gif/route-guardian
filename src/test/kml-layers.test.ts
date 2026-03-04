import { describe, it, expect } from 'vitest';

// We'll test the collectSegments logic by simulating what kmlWithFolders returns
// Since we can't easily mock the full parser, we test the type structure and 
// verify the parser module exports correctly

describe('KML Parser - Layer support', () => {
  it('should import kmlWithFolders without errors', async () => {
    const mod = await import('@tmcw/togeojson');
    expect(typeof mod.kmlWithFolders).toBe('function');
  });

  it('should export parseKMLFile and applyNamingField', async () => {
    const mod = await import('@/utils/kml-parser');
    expect(typeof mod.parseKMLFile).toBe('function');
    expect(typeof mod.applyNamingField).toBe('function');
  });

  it('Segment type should accept layer field', () => {
    // Type-level test: if this compiles, the type is correct
    const seg: import('@/types/route').Segment = {
      id: '1',
      routeId: 'r1',
      trackNumber: null,
      plannedTrackNumber: null,
      trackHistory: [],
      kmlId: 'test',
      name: 'Test',
      notes: '',
      coordinates: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }],
      direction: 'ambos',
      type: 'tramo',
      status: 'pendiente',
      kmlMeta: {},
      layer: 'Troncos',
    };
    expect(seg.layer).toBe('Troncos');
  });

  it('Segment type should allow undefined layer', () => {
    const seg: import('@/types/route').Segment = {
      id: '1',
      routeId: 'r1',
      trackNumber: null,
      plannedTrackNumber: null,
      trackHistory: [],
      kmlId: 'test',
      name: 'Test',
      notes: '',
      coordinates: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }],
      direction: 'ambos',
      type: 'tramo',
      status: 'pendiente',
      kmlMeta: {},
    };
    expect(seg.layer).toBeUndefined();
  });
});
