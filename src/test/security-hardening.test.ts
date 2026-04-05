/**
 * Security & validation tests for Phase 2 hardening.
 * Covers: KML sanitization, campaign schema, import rejection/correction.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeHtml, stripHtml, sanitizeTextField } from '@/utils/sanitize';
import { campaignExportSchema, MAX_FILE_SIZE_BYTES } from '@/utils/persistence/campaign-schema';

// ── Sanitize tests ─────────────────────────────────────────────

describe('sanitizeHtml', () => {
  it('strips script tags from KML description', () => {
    const dirty = '<table><tr><td>Carretera</td><td><script>alert("xss")</script>AP-7</td></tr></table>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain('<script');
    expect(clean).toContain('AP-7');
  });

  it('strips event handlers', () => {
    const dirty = '<b onmouseover="alert(1)">Tramo 1</b>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain('onmouseover');
    expect(clean).toContain('Tramo 1');
  });

  it('strips iframes', () => {
    const dirty = '<iframe src="https://evil.com"></iframe><p>Ok</p>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain('iframe');
    expect(clean).toContain('Ok');
  });
});

describe('stripHtml', () => {
  it('returns plain text from markup', () => {
    expect(stripHtml('<b>Hello</b> <i>world</i>')).toBe('Hello world');
  });

  it('removes dangerous tags completely', () => {
    expect(stripHtml('<script>alert(1)</script>safe')).toBe('safe');
  });
});

describe('sanitizeTextField', () => {
  it('removes control characters', () => {
    expect(sanitizeTextField('hello\x00world')).toBe('helloworld');
  });

  it('trims and limits length', () => {
    const long = 'a'.repeat(1000);
    expect(sanitizeTextField(long, 100).length).toBe(100);
  });

  it('preserves newlines and tabs', () => {
    expect(sanitizeTextField('line1\nline2\ttab')).toBe('line1\nline2\ttab');
  });
});

// ── Campaign schema tests ──────────────────────────────────────

function makeValidCampaign(overrides?: Record<string, unknown>) {
  return {
    version: 1,
    exportedAt: '2026-04-05T10:00:00Z',
    appVersion: '1.1.0',
    state: {
      route: {
        id: 'r1',
        name: 'Test Route',
        loadedAt: '2026-04-05T09:00:00Z',
        fileName: 'test.kml',
        segments: [
          {
            id: 's1',
            routeId: 'r1',
            trackNumber: null,
            plannedTrackNumber: null,
            trackHistory: [],
            kmlId: 'kml-1',
            name: 'Tramo 1',
            notes: '',
            coordinates: [
              { lat: 40.0, lng: -3.0 },
              { lat: 40.1, lng: -3.1 },
            ],
            direction: 'ambos',
            type: 'tramo',
            status: 'pendiente',
            kmlMeta: {},
          },
        ],
        optimizedOrder: ['s1'],
      },
      incidents: [],
      activeSegmentId: null,
      navigationActive: false,
      currentPosition: null,
      base: null,
      rstMode: true,
      rstGroupSize: 9,
      trackSession: null,
      blockEndPrompt: { isOpen: false, trackNumber: null, reason: 'capacity' },
      workDay: 1,
      acquisitionMode: 'RST',
    },
    eventLog: [],
    ...overrides,
  };
}

describe('campaignExportSchema', () => {
  it('accepts a valid campaign', () => {
    const result = campaignExportSchema.safeParse(makeValidCampaign());
    expect(result.success).toBe(true);
  });

  it('rejects invalid JSON structure (missing version)', () => {
    const data = makeValidCampaign();
    delete (data as any).version;
    const result = campaignExportSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects wrong version number', () => {
    const result = campaignExportSchema.safeParse(makeValidCampaign({ version: 2 }));
    expect(result.success).toBe(false);
  });

  it('rejects invalid timestamp format in exportedAt', () => {
    const result = campaignExportSchema.safeParse(
      makeValidCampaign({ exportedAt: 'not-a-date' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects unknown eventType in eventLog', () => {
    const data = makeValidCampaign({
      eventLog: [
        {
          eventId: 'e1',
          timestamp: '2026-04-05T10:00:00Z',
          eventType: 'FAKE_EVENT_THAT_DOES_NOT_EXIST',
        },
      ],
    });
    const result = campaignExportSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('accepts valid eventTypes', () => {
    const data = makeValidCampaign({
      eventLog: [
        { eventId: 'e1', timestamp: '2026-04-05T10:00:00Z', eventType: 'SEGMENT_COMPLETED' },
        { eventId: 'e2', timestamp: '2026-04-05T10:01:00Z', eventType: 'TRACK_OPENED', workDay: 1, trackNumber: 1 },
      ],
    });
    const result = campaignExportSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('rejects unknown fields at top level (strict mode)', () => {
    const data = makeValidCampaign({ hackerField: 'malicious' });
    const result = campaignExportSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects unknown fields in segment (strict mode)', () => {
    const data = makeValidCampaign();
    (data as any).state.route.segments[0].evilProp = 'inject';
    const result = campaignExportSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects invalid incident category', () => {
    const data = makeValidCampaign();
    (data as any).state.incidents = [
      {
        id: 'i1',
        segmentId: 's1',
        category: 'categoria_inventada',
        impact: 'informativa',
        timestamp: '2026-04-05T10:00:00Z',
      },
    ];
    const result = campaignExportSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects segment with only 1 coordinate', () => {
    const data = makeValidCampaign();
    (data as any).state.route.segments[0].coordinates = [{ lat: 40, lng: -3 }];
    const result = campaignExportSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects coordinates out of range', () => {
    const data = makeValidCampaign();
    (data as any).state.route.segments[0].coordinates = [
      { lat: 200, lng: -3 },
      { lat: 40, lng: -3 },
    ];
    const result = campaignExportSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('provides readable error messages', () => {
    const result = campaignExportSchema.safeParse({ version: 1 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths.some((p) => p.includes('exportedAt') || p.includes('state'))).toBe(true);
    }
  });
});

// ── MAX_FILE_SIZE_BYTES ────────────────────────────────────────

describe('MAX_FILE_SIZE_BYTES', () => {
  it('is 100 MB', () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(100 * 1024 * 1024);
  });
});
