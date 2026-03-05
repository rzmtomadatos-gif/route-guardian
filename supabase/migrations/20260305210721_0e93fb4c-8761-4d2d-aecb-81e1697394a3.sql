ALTER TABLE public.copilot_sessions
  ADD COLUMN batch_number integer NOT NULL DEFAULT 0,
  ADD COLUMN batch_url text DEFAULT NULL;