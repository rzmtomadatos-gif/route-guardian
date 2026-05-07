/**
 * Aislamiento de campaña: una NUEVA campaña no debe heredar Día, tracks,
 * incidencias, correcciones, GPS log ni base de la campaña anterior.
 *
 * Cubre el factory `createEmptyCampaignState` (puro, sin SQLite) y los
 * casos del flujo:
 *   A — campaña anterior avanzada → nueva campaña empieza limpia
 *   B — KML como nueva campaña → todos los tramos pendientes, Día = 1
 *   C — importar campaña existente → conserva Día y trazabilidad propios
 *   D — reset preserva preferencias del operador (RST, modo adquisición)
 */
import { describe, it, expect } from 'vitest';
import { createEmptyCampaignState } from '@/utils/storage';
import { campaignExportSchema } from '@/utils/persistence/campaign-schema';
import type { AppState, Route, Segment } from '@/types/route';

function mkSeg(id: string, over: Partial<Segment> = {}): Segment {
  return {
    id,
    routeId: 'r1',
    trackNumber: null,
    plannedTrackNumber: null,
    trackHistory: [],
    kmlId: id,
    name: id,
    notes: '',
    coordinates: [{ lat: 40, lng: -3 }, { lat: 40.01, lng: -3.01 }],
    direction: 'creciente',
    type: 'tramo',
    status: 'pendiente',
    kmlMeta: {},
    ...over,
  };
}

/** State simulando una campaña anterior con actividad real. */
function makeAdvancedCampaignState(): AppState {
  const route: Route = {
    id: 'route-old',
    name: 'Campaña antigua Boadilla',
    loadedAt: '2026-01-01T00:00:00Z',
    fileName: 'old.kml',
    projectCode: 'BOA',
    segments: [
      mkSeg('a1', {
        status: 'completado',
        trackNumber: 1,
        trackHistory: [1],
        workDay: 3,
        timestampInicio: '2026-01-03T08:00:00Z',
        timestampFin: '2026-01-03T08:05:00Z',
        startedAt: '2026-01-03T08:00:00Z',
        endedAt: '2026-01-03T08:05:00Z',
        companySegmentId: 'BOA_00001',
      }),
    ],
    optimizedOrder: ['a1'],
  };
  return {
    route,
    incidents: [
      {
        id: 'inc1',
        segmentId: 'a1',
        category: 'lluvia',
        impact: 'leve',
        notes: '',
        timestamp: '2026-01-03T08:02:00Z',
        recordedAt: '2026-01-03T08:02:00Z',
      } as unknown as AppState['incidents'][number],
    ],
    activeSegmentId: 'a1',
    navigationActive: true,
    currentPosition: { lat: 40, lng: -3 },
    base: { position: { lat: 40, lng: -3 }, label: 'Base antigua' } as unknown as AppState['base'],
    rstMode: true,
    rstGroupSize: 9,
    trackSession: {
      active: true,
      trackNumber: 4,
      capacity: 9,
      segmentIds: ['a1'],
      startedAt: '2026-01-03T08:00:00Z',
      endedAt: null,
      closedManually: false,
      trackStartTime: null,
    } as AppState['trackSession'],
    blockEndPrompt: { isOpen: false, trackNumber: null, reason: 'capacity' },
    workDay: 3,
    acquisitionMode: 'GARMIN',
    lastConsumedTrackByDay: { 1: 2, 2: 3, 3: 4 },
    segmentCorrections: [
      {
        id: 'c1',
        segmentId: 'a1',
        field: 'name',
        previousValue: 'old',
        newValue: 'new',
        reason: '',
        correctedBy: 'gabinete',
        correctedByRole: 'gabinete',
        correctedAt: '2026-01-04T10:00:00Z',
        active: true,
      } as AppState['segmentCorrections'][number],
    ],
    trackGpsLogsByDay: {
      3: {
        4: [
          {
            timestamp: '2026-01-03T08:00:00Z',
            lat: 40,
            lng: -3,
            accuracy: 5,
            speed: 0,
            heading: 0,
            workDay: 3,
            trackNumber: 4,
            phase: 'recording',
            segmentId: 'a1',
            source: 'gps',
          } as AppState['trackGpsLogsByDay'][number][number][number],
        ],
      },
    },
  };
}

describe('Caso A — nueva campaña tras una avanzada', () => {
  it('createEmptyCampaignState devuelve estado totalmente limpio', () => {
    const advanced = makeAdvancedCampaignState();
    const fresh = createEmptyCampaignState({
      rstMode: advanced.rstMode,
      rstGroupSize: advanced.rstGroupSize,
      acquisitionMode: advanced.acquisitionMode,
      // base intencionalmente NO se preserva
    });

    // 1. Día reseteado a 1
    expect(fresh.workDay).toBe(1);

    // 2. Sin route, sin tracks, sin segmentos heredados
    expect(fresh.route).toBeNull();
    expect(fresh.trackSession).toBeNull();
    expect(fresh.activeSegmentId).toBeNull();
    expect(fresh.navigationActive).toBe(false);

    // 3. Sin tracks consumidos previos (gabinete no puede mostrar Día 3)
    expect(fresh.lastConsumedTrackByDay).toEqual({});

    // 4. Sin incidencias, correcciones ni GPS heredado
    expect(fresh.incidents).toEqual([]);
    expect(fresh.segmentCorrections).toEqual([]);
    expect(fresh.trackGpsLogsByDay).toEqual({});

    // 5. Sin base ni posición de la campaña anterior
    expect(fresh.base).toBeNull();
    expect(fresh.currentPosition).toBeNull();

    // 6. Prompt limpio
    expect(fresh.blockEndPrompt).toEqual({
      isOpen: false,
      trackNumber: null,
      reason: 'capacity',
    });
  });
});

describe('Caso B — nueva campaña desde KML', () => {
  it('al combinar fresh + nueva route, todos los tramos arrancan pendientes y workDay=1', () => {
    const fresh = createEmptyCampaignState();
    const newRoute: Route = {
      id: 'route-new',
      name: 'Tres Cantos',
      loadedAt: '2026-05-07T08:00:00Z',
      fileName: 'mad_tc.kml',
      projectCode: 'MAD',
      segments: [
        mkSeg('n1'),
        mkSeg('n2'),
        mkSeg('n3'),
      ],
      optimizedOrder: ['n1', 'n2', 'n3'],
    };
    const next: AppState = { ...fresh, route: newRoute };

    expect(next.workDay).toBe(1);
    expect(next.route!.segments.every((s) => s.status === 'pendiente')).toBe(true);
    expect(next.route!.segments.every((s) => s.trackNumber === null)).toBe(true);
    expect(next.route!.segments.every((s) => s.trackHistory.length === 0)).toBe(true);
    expect(next.route!.segments.every((s) => s.workDay === undefined)).toBe(true);
    expect(next.trackSession).toBeNull();
    expect(next.lastConsumedTrackByDay).toEqual({});
  });
});

describe('Caso C — importar campaña existente conserva Día y eventos', () => {
  it('el schema acepta una campaña con workDay=4 y eventLog propio sin perder datos', () => {
    const advanced = makeAdvancedCampaignState();
    advanced.workDay = 4;
    const exportPayload = {
      version: 1 as const,
      exportedAt: '2026-05-07T10:00:00Z',
      appVersion: '1.1.0',
      state: advanced,
      eventLog: [
        {
          eventId: 'e1',
          timestamp: '2026-01-03T08:00:00Z',
          eventType: 'TRACK_OPENED' as const,
          workDay: 3,
          trackNumber: 4,
        },
      ],
    };
    const result = campaignExportSchema.safeParse(exportPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.state.workDay).toBe(4);
      expect(result.data.eventLog).toHaveLength(1);
      expect(result.data.eventLog[0].workDay).toBe(3);
    }
  });
});

describe('Caso D — preferencias del operador se preservan', () => {
  it('rstMode, rstGroupSize y acquisitionMode pasados se mantienen', () => {
    const fresh = createEmptyCampaignState({
      rstMode: true,
      rstGroupSize: 7,
      acquisitionMode: 'GARMIN',
    });
    expect(fresh.rstMode).toBe(true);
    expect(fresh.rstGroupSize).toBe(7);
    expect(fresh.acquisitionMode).toBe('GARMIN');
  });

  it('sin preferencias usa defaults seguros (RST modo desactivado, group=3, RST adquisición)', () => {
    const fresh = createEmptyCampaignState();
    expect(fresh.rstMode).toBe(false);
    expect(fresh.rstGroupSize).toBe(3);
    expect(fresh.acquisitionMode).toBe('RST');
  });
});
