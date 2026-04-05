
-- Role enum (controlled, not free text)
CREATE TYPE public.app_role AS ENUM ('admin', 'supervisor', 'operator');

-- Organizations (preparatory — no invitation/management logic yet)
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- Profiles linked to auth.users
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  organization_id uuid REFERENCES public.organizations(id),
  role public.app_role NOT NULL DEFAULT 'operator',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- RLS: users read own profile
CREATE POLICY "Users read own profile" ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid());

-- RLS: users update own profile
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- RLS: members read own org
CREATE POLICY "Members read own org" ON public.organizations
  FOR SELECT TO authenticated
  USING (id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
