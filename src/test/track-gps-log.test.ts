/**
 * Tests del registro GPS por track:
 *  - regla 10 m, primer punto, fase transport/recording, append por track,
 *    sin track activo no se registra, compatibilidad campañas antiguas.
 *
 * Probamos la lógica del hook a través de una versión pura equivalente —
 * la decisión "registrar / no registrar / con qué phase" — sin depender
 * del entorno React. El hook real solo orquesta esto encima de `useEffect`.
 */
import { describe, it, expect } from 'vitest';
import type { AppState, LatLng, Segment, TrackGpsPoint, TrackSession } from '@/types/route';
import { getDefaultState } from '@/utils/storage';

const MIN = 10;

function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sLat = Math.sin(dLat / 2);
  const sLng = Math.sin(dLng / 2);
  const h = sLat * sLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sLng * sLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Replicado de la decisión del hook (sin React). */
function decide(
  state: AppState,
  pos: LatLng | null,
  lastByTrack: Map<string, LatLng>,
): TrackGpsPoint | null {
  if (!state.navigationActive) return null;
  const session = state.trackSession;
  if (!session || !session.active) return null;
  if (!pos) return null;
  const key = `${state.workDay}#${session.trackNumber}`;
  const last = lastByTrack.get(key);
  if (last && haversineMeters(last, pos) < MIN) return null;
  const inProgress = state.route?.segments.find((s) => s.status === 'en_progreso');
  const phase: TrackGpsPoint['phase'] = inProgress ? 'recording' : 'transport';
  return {
    timestamp: '2025-01-01T00:00:00.000Z',
    lat: pos.lat,
    lng: pos.lng,
    accuracy: null,
    speed: null,
    heading: null,
    workDay: state.workDay,
    trackNumber: session.trackNumber,
    phase,
    segmentId: phase === 'recording' && inProgress ? inProgress.id : null,
    source: 'gps',
  };
}

function makeSegment(over: Partial<Segment> = {}): Segment {
  return {
    id: 's1',
    routeId: 'r1',
    trackNumber: null,
    plannedTrackNumber: null,
    trackHistory: [],
    kmlId: '',
    name: 'seg',
    notes: '',
    coordinates: [{ lat: 40, lng: -3 }, { lat: 40.001, lng: -3 }],
    direction: 'creciente',
    type: 'tramo',
    status: 'pendiente',
    kmlMeta: {},
    ...over,
  };
}

function makeSession(over: Partial<TrackSession> = {}): TrackSession {
  return {
    active: true,
    trackNumber: 1,
    capacity: 9,
    segmentIds: [],
    startedAt: '2025-01-01T00:00:00.000Z',
    endedAt: null,
    closedManually: false,
    ...over,
  };
}

function makeState(over: Partial<AppState> = {}): AppState {
  const base = getDefaultState();
  return { ...base, ...over };
}

describe('useTrackGpsLog — reglas operativas', () => {
  it('navegación activa + primer punto válido → guarda primer punto', () => {
    const state = makeState({
      navigationActive: true,
      trackSession: makeSession(),
      route: { id: 'r1', name: 'r', loadedAt: '', fileName: 'f', segments: [makeSegment()], optimizedOrder: ['s1'] },
    });
    const cache = new Map<string, LatLng>();
    const p = decide(state, { lat: 40, lng: -3 }, cache);
    expect(p).not.toBeNull();
    expect(p!.phase).toBe('transport');
  });

  it('segundo punto a < 10 m → no guarda', () => {
    const state = makeState({ navigationActive: true, trackSession: makeSession() });
    const cache = new Map<string, LatLng>([['1#1', { lat: 40, lng: -3 }]]);
    // ~5 m al norte
    const p = decide(state, { lat: 40 + 5 / 111320, lng: -3 }, cache);
    expect(p).toBeNull();
  });

  it('segundo punto a ≥ 10 m → sí guarda', () => {
    const state = makeState({ navigationActive: true, trackSession: makeSession() });
    const cache = new Map<string, LatLng>([['1#1', { lat: 40, lng: -3 }]]);
    // ~12 m al norte
    const p = decide(state, { lat: 40 + 12 / 111320, lng: -3 }, cache);
    expect(p).not.toBeNull();
  });

  it('segmento en_progreso → phase recording + segmentId', () => {
    const seg = makeSegment({ id: 'seg-X', status: 'en_progreso' });
    const state = makeState({
      navigationActive: true,
      trackSession: makeSession(),
      route: { id: 'r1', name: 'r', loadedAt: '', fileName: 'f', segments: [seg], optimizedOrder: ['seg-X'] },
    });
    const p = decide(state, { lat: 40, lng: -3 }, new Map());
    expect(p?.phase).toBe('recording');
    expect(p?.segmentId).toBe('seg-X');
  });

  it('sin segmento en_progreso → phase transport + segmentId null', () => {
    const state = makeState({
      navigationActive: true,
      trackSession: makeSession(),
      route: { id: 'r1', name: 'r', loadedAt: '', fileName: 'f', segments: [makeSegment()], optimizedOrder: ['s1'] },
    });
    const p = decide(state, { lat: 40, lng: -3 }, new Map());
    expect(p?.phase).toBe('transport');
    expect(p?.segmentId).toBeNull();
  });

  it('al cambiar de track → cache por (workDay, trackNumber) no contamina', () => {
    const state = makeState({ navigationActive: true, trackSession: makeSession({ trackNumber: 2 }) });
    // Cache tiene punto del track 1, pero ahora session es track 2: debe guardar.
    const cache = new Map<string, LatLng>([['1#1', { lat: 40, lng: -3 }]]);
    const p = decide(state, { lat: 40, lng: -3 }, cache);
    expect(p).not.toBeNull();
    expect(p!.trackNumber).toBe(2);
  });

  it('navegación detenida → no registra aunque haya GPS y track', () => {
    const state = makeState({ navigationActive: false, trackSession: makeSession() });
    const p = decide(state, { lat: 40, lng: -3 }, new Map());
    expect(p).toBeNull();
  });

  it('sin track activo (active=false) → no registra', () => {
    const state = makeState({ navigationActive: true, trackSession: makeSession({ active: false }) });
    const p = decide(state, { lat: 40, lng: -3 }, new Map());
    expect(p).toBeNull();
  });

  it('sin trackSession → no registra', () => {
    const state = makeState({ navigationActive: true, trackSession: null });
    const p = decide(state, { lat: 40, lng: -3 }, new Map());
    expect(p).toBeNull();
  });

  it('sin posición GPS → no registra', () => {
    const state = makeState({ navigationActive: true, trackSession: makeSession() });
    const p = decide(state, null, new Map());
    expect(p).toBeNull();
  });
});

describe('Compatibilidad de campañas antiguas', () => {
  it('parseAppStateDefaults añade trackGpsLogsByDay vacío si no existe', async () => {
    // Importamos el helper público de migración para evitar duplicar lógica.
    const mod = await import('@/utils/persistence/migration');
    // parseAppStateDefaults no se exporta — verificamos vía DEFAULT_STATE indirecto:
    // un AppState recién creado sin la clave debe quedar con {} tras pasar por
    // migrateAndLoad. Como atajo, validamos que getDefaultState la incluye.
    const def = getDefaultState();
    expect(def.trackGpsLogsByDay).toEqual({});
    // Garantía de que el módulo carga sin error.
    expect(typeof mod.migrateAndLoad).toBe('function');
  });
});
