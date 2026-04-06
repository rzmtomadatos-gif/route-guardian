
-- 1. Table: allowed_emails
CREATE TABLE public.allowed_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  added_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

ALTER TABLE public.allowed_emails ENABLE ROW LEVEL SECURITY;

-- Public can read (for registration validation)
CREATE POLICY "Public read allowed_emails"
  ON public.allowed_emails FOR SELECT
  TO public
  USING (true);

-- Seed first authorized email
INSERT INTO public.allowed_emails (email, notes)
VALUES ('ernestorru@gmail.com', 'Admin principal');

-- 2. Table: user_roles (roles stored separately per security best practice)
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Users can read their own roles
CREATE POLICY "Users read own roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- 3. Security definer function to check roles (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- 4. Admin management policy for allowed_emails (insert/update/delete)
CREATE POLICY "Admins manage allowed_emails"
  ON public.allowed_emails FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 5. Assign admin role to primary user
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role FROM auth.users
WHERE email = 'ernestorru@gmail.com';
