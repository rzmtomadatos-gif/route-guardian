/**
 * Importación de campañas LEGADO (RST/Garmin antiguas, sin colecciones Trimble).
 * El Zod schema debe aceptar el archivo y rellenar defaults vacíos.
 */
import { describe, it, expect } from 'vitest';
import { campaignExportSchema } from '@/utils/persistence/campaign-schema';

const legacyState = {
  route: null,
  // Resto de campos opcionales con default — no los enviamos
};

describe('Import legado RST/Garmin sin Trimble', () => {
  it('una campaña antigua sin trimble* importa y recibe defaults vacíos', () => {
    const exp = {
      version: 1 as const,
      exportedAt: '2026-01-01T00:00:00Z',
      appVersion: '0.9.0',
      state: legacyState,
      eventLog: [],
    };
    const r = campaignExportSchema.safeParse(exp);
    expect(r.success, JSON.stringify(r.success ? null : r.error.issues, null, 2)).toBe(true);
    if (!r.success) return;
    const s = r.data.state;
    expect(s.trimbleMissions).toEqual([]);
    expect(s.trimbleRuns).toEqual([]);
    expect(s.trimbleSegmentCaptures).toEqual([]);
    expect(s.trimbleIncidents).toEqual([]);
    expect(s.trimbleDeliverables).toEqual([]);
    expect(s.trimbleGpsLogsByRun).toEqual({});
    expect(s.activeMissionId).toBeNull();
    expect(s.activeRunId).toBeNull();
    expect(s.acquisitionMode).toBe('RST');
  });

  it('campaña con acquisitionMode TRIMBLE_LIDAR es válida', () => {
    const r = campaignExportSchema.safeParse({
      version: 1 as const,
      exportedAt: '2026-01-01T00:00:00Z',
      appVersion: '1.0.0',
      state: { route: null, acquisitionMode: 'TRIMBLE_LIDAR' },
      eventLog: [],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.state.acquisitionMode).toBe('TRIMBLE_LIDAR');
  });
});
