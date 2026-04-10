-- Admin puede ver todos los perfiles
CREATE POLICY "Admins read all profiles"
ON public.profiles FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin gestiona user_roles (CRUD completo)
CREATE POLICY "Admins manage user_roles"
ON public.user_roles FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));