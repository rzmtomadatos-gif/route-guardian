-- Revocar a public (que cubre anon) en las funciones legacy y helpers.

revoke execute on function public.update_copilot_session(text, jsonb) from public, anon, authenticated;
revoke execute on function public.read_copilot_session_by_token(text) from public, anon, authenticated;
revoke execute on function public.delete_copilot_session(text) from public, anon, authenticated;

revoke execute on function public.update_own_profile(text, text) from public, anon;
revoke execute on function public.check_email_allowed(text) from public, anon;
revoke execute on function public.has_role(uuid, public.app_role) from public, anon;

-- handle_new_user es un trigger, no necesita exposición pública.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
