
ALTER TABLE public.copilot_sessions
  ADD COLUMN queue jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN cursor_index integer NOT NULL DEFAULT 0;
