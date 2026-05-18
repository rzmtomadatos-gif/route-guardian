-- Revocar execute a public/anon en todas las nuevas funciones de Copiloto.
-- Solo authenticated puede invocarlas (ya tienen GRANT explícito).

revoke execute on function public.create_copilot_session() from public, anon;
revoke execute on function public.operator_generate_pairing(uuid) from public, anon;
revoke execute on function public.operator_update_session(uuid, jsonb) from public, anon;
revoke execute on function public.operator_end_session(uuid) from public, anon;
revoke execute on function public.operator_get_session(uuid) from public, anon;
revoke execute on function public.claim_driver_pairing(text) from public, anon;
revoke execute on function public.driver_read_session(text) from public, anon;
revoke execute on function public.driver_mark_route_opened(text, integer) from public, anon;
revoke execute on function public.driver_report_recovered(text) from public, anon;

-- Helpers internos: solo deben ser invocados desde otras funciones SECURITY DEFINER.
revoke execute on function public.hash_token(text) from public, anon, authenticated;
revoke execute on function public._gen_url_token(int) from public, anon, authenticated;
