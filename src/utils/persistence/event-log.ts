/**
 * Centralized event logging — single entry point for all operational events.
 * Append-only, persistent via IndexedDB.
 */

import { appendEvent } from './db';
import type { EventType, PersistentEvent } from './types';

let counter = 0;

function generateEventId(): string {
  counter++;
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `${ts}-${rand}-${counter}`;
}

/**
 * Record an operational event. This is the ONLY function that should be called
 * to log events. All other modules must use this to ensure consistent format.
 */
export async function logEvent(
  eventType: EventType,
  opts?: {
    workDay?: number;
    trackNumber?: number;
    segmentId?: string;
    payload?: Record<string, unknown>;
  },
): Promise<PersistentEvent> {
  const evt: PersistentEvent = {
    eventId: generateEventId(),
    timestamp: new Date().toISOString(),
    eventType,
    workDay: opts?.workDay,
    trackNumber: opts?.trackNumber,
    segmentId: opts?.segmentId,
    payload: opts?.payload,
  };

  try {
    await appendEvent(evt);
  } catch (e) {
    console.error('Failed to persist event:', e, evt);
  }

  return evt;
}
