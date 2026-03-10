import type { LatLng, Segment } from '@/types/route';
import { detectCorridors, type Corridor } from '@/utils/corridor-detection';

export interface CorridorDebugInfo {
  corridorId: string;
  roadName: string;
  totalSegments: number;
  directionA: string[];
  directionB: string[];
  entryExtreme: 'start' | 'end';
  hasReturn: boolean;
  explanation: string;
}

export interface OptimizerDebugInfo {
  corridors: CorridorDebugInfo[];
  activeBlock: string[];
  activeSegmentId: string | null;
  activeCorridorId: string | null;
  /** Map segmentId → corridorId */
  segmentCorridorMap: Map<string, string>;
  /** Map segmentId → 'A' | 'B' direction within corridor */
  segmentDirectionMap: Map<string, 'A' | 'B'>;
  timestamp: number;
}

/**
 * Generate debug info from current route state.
 */
export function generateDebugInfo(
  segments: Segment[],
  activeBlock: string[],
  activeSegmentId: string | null,
  currentPos: LatLng | null,
  hiddenLayers: Set<string>,
): OptimizerDebugInfo {
  const candidates = segments.filter((s) => {
    if (s.nonRecordable) return false;
    if (s.layer && hiddenLayers.has(s.layer)) return false;
    if (s.status === 'pendiente') return true;
    if (s.status === 'posible_repetir' && s.needsRepeat) return true;
    return false;
  });

  const corridors = detectCorridors(candidates);

  const segmentCorridorMap = new Map<string, string>();
  const segmentDirectionMap = new Map<string, 'A' | 'B'>();

  let activeCorridorId: string | null = null;

  const corridorInfos: CorridorDebugInfo[] = corridors.map((c) => {
    c.directionA.forEach((id) => {
      segmentCorridorMap.set(id, c.id);
      segmentDirectionMap.set(id, 'A');
    });
    c.directionB.forEach((id) => {
      segmentCorridorMap.set(id, c.id);
      segmentDirectionMap.set(id, 'B');
    });

    if (activeSegmentId && c.segmentIds.includes(activeSegmentId)) {
      activeCorridorId = c.id;
    }

    const hasReturn = c.directionB.length > 0;
    const entryExtreme: 'start' | 'end' = 'start'; // simplified

    let explanation = `Corredor "${c.roadName}": ${c.directionA.length} tramos sentido A`;
    if (hasReturn) {
      explanation += `, ${c.directionB.length} tramos sentido B (retorno)`;
    }
    explanation += '. Se completa sentido A y luego retorno por sentido B.';

    return {
      corridorId: c.id,
      roadName: c.roadName,
      totalSegments: c.segmentIds.length,
      directionA: c.directionA,
      directionB: c.directionB,
      entryExtreme,
      hasReturn,
      explanation,
    };
  });

  return {
    corridors: corridorInfos,
    activeBlock,
    activeSegmentId,
    activeCorridorId,
    segmentCorridorMap,
    segmentDirectionMap,
    timestamp: Date.now(),
  };
}
