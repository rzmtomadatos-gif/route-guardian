-- Restore controlled SELECT policy on copilot_sessions for Realtime subscriptions
-- Token column remains protected via column-level REVOKE SELECT
CREATE POLICY "Public read copilot sessions (token protected)"
  ON public.copilot_sessions
  FOR SELECT
  TO public
  USING (true);