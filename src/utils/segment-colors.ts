import type { Segment } from '@/types/route';

/**
 * Reserved state colors — these must NEVER be used as layer colors.
 * green = completado, yellow = en_progreso, red = incidencia
 */
const RESERVED_HUES: Array<{ min: number; max: number; label: string }> = [
  { min: 80, max: 160, label: 'green' },   // greens
  { min: 40, max: 65, label: 'yellow' },    // yellows/amber
  { min: 345, max: 360, label: 'red' },     // reds (wrap)
  { min: 0, max: 15, label: 'red' },        // reds (low end)
];

/** Safe palette for layers — no green, yellow, red */
export const SAFE_LAYER_COLORS = [
  'hsl(210 80% 55%)',  // blue
  'hsl(280 70% 55%)',  // purple
  'hsl(190 75% 45%)',  // cyan
  'hsl(174 72% 40%)',  // teal
  'hsl(330 70% 55%)',  // pink
  'hsl(260 60% 60%)',  // violet
  'hsl(200 85% 50%)',  // sky blue
  'hsl(300 55% 50%)',  // magenta
];

/** Check if a color string is in a reserved hue range */
function isReservedColor(color: string): boolean {
  // Parse HSL
  const hslMatch = color.match(/hsl\s*\(\s*(\d+)/);
  if (hslMatch) {
    const hue = parseInt(hslMatch[1], 10);
    return RESERVED_HUES.some((r) => hue >= r.min && hue <= r.max);
  }
  // Parse hex
  const hexMatch = color.match(/^#([0-9a-f]{6})$/i);
  if (hexMatch) {
    const r = parseInt(hexMatch[1].slice(0, 2), 16);
    const g = parseInt(hexMatch[1].slice(2, 4), 16);
    const b = parseInt(hexMatch[1].slice(4, 6), 16);
    // Simple hue check
    if (g > r && g > b && g > 100) return true;  // greenish
    if (r > 180 && g > 180 && b < 100) return true; // yellowish
    if (r > 180 && g < 80 && b < 80) return true;  // reddish
  }
  return false;
}

/** Sanitize a layer color — if reserved, replace with a safe alternative */
export function sanitizeLayerColor(color: string, index: number): string {
  if (isReservedColor(color)) {
    const replacement = SAFE_LAYER_COLORS[index % SAFE_LAYER_COLORS.length];
    console.warn(`[LayerColor] Color "${color}" is reserved for status. Replaced with "${replacement}".`);
    return replacement;
  }
  return color;
}

/** Get a safe layer color by index */
export function getSafeLayerColor(index: number): string {
  return SAFE_LAYER_COLORS[index % SAFE_LAYER_COLORS.length];
}

/** Resolve display color with operational priority: status > layer */
export function resolveSegmentColor(
  seg: Segment,
  activeSegmentId?: string | null,
  layerColor?: string | null,
): string {
  // 1. Active / in-progress → yellow
  if (seg.id === activeSegmentId || seg.status === 'en_progreso') return '#f59e0b';
  // 2. Completed → green (reserved)
  if (seg.status === 'completado') return '#22c55e';
  // 3. Non-recordable → dark gray
  if (seg.nonRecordable) return '#3f3f46';
  // 4. Needs repeat → orange
  if (seg.needsRepeat || seg.status === 'posible_repetir') return '#f97316';
  // 5. Pending → layer color or default gray
  return layerColor || seg.color || '#6b7280';
}
