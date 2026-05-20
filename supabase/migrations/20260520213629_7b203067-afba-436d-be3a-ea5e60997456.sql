-- Fix BUG-DRIVER-EVENT-001: allow OPERATOR_BATCH_SENT event type.
-- The RPCs operator_send_batch and operator_update_session emit this event,
-- but the existing CHECK constraint rejects it, aborting the whole batch
-- send transaction and leaving the Driver without updates.

ALTER TABLE public.copilot_session_events
  DROP CONSTRAINT IF EXISTS copilot_session_events_event_type_check;

ALTER TABLE public.copilot_session_events
  ADD CONSTRAINT copilot_session_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'DRIVER_PAIRING_STARTED'::text,
    'DRIVER_PAIRED'::text,
    'DRIVER_ROUTE_RECEIVED'::text,
    'DRIVER_ROUTE_OPENED'::text,
    'DRIVER_SESSION_EXPIRED'::text,
    'DRIVER_SESSION_ENDED'::text,
    'DRIVER_ERROR_RECOVERED'::text,
    'OPERATOR_QUEUE_PUSHED'::text,
    'OPERATOR_BATCH_SENT'::text,
    'OPERATOR_BATCH_FORCED'::text,
    'OPERATOR_SESSION_ENDED'::text,
    'PAIRING_REVOKED'::text,
    'PAIRING_CLAIM_FAILED'::text
  ]));