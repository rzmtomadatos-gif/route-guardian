
-- Copilot sessions for driver-operator sync
CREATE TABLE public.copilot_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  segment_name text,
  segment_id text,
  destination_lat double precision,
  destination_lng double precision,
  status text NOT NULL DEFAULT 'waiting',
  track_number integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.copilot_sessions ENABLE ROW LEVEL SECURITY;

-- Public access policies (token-based, no auth required)
CREATE POLICY "Public read copilot sessions" ON public.copilot_sessions FOR SELECT USING (true);
CREATE POLICY "Public insert copilot sessions" ON public.copilot_sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update copilot sessions" ON public.copilot_sessions FOR UPDATE USING (true);
CREATE POLICY "Public delete copilot sessions" ON public.copilot_sessions FOR DELETE USING (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.copilot_sessions;
