

# Autenticación Fase 1 — Plan de implementación

## Resumen

Registro, login, logout y persistencia de sesión con Lovable Cloud Auth (email/contraseña). AuthGuard offline-aware que no bloquea operativa local si el dispositivo ya autenticó antes. Logout con opción de conservar o borrar datos locales. Modelo de dispositivo de usuario único. `organization_id` preparatorio. `role` como enum. Import/export local sin gate de auth. Copilot no se toca.

## Arquitectura

- **Auth**: Lovable Cloud Auth (email + contraseña)
- **Sesión offline**: JWT cacheado por Supabase SDK en localStorage. Si existe sesión (válida o expirada) + hay estado local → se permite operar offline
- **Datos locales**: Dispositivo de usuario único. SQLite no se segmenta por `user_id`
- **Guard**: Doble comprobación: `hasEverAuthenticated` flag + existencia de estado local en SQLite

## Flujo offline-aware del AuthGuard

```text
INICIO APP
│
├─ ¿Sesión JWT válida en cache? ──→ SÍ ──→ Acceso normal
│
├─ NO ──→ ¿hasEverAuthenticated + existe estado local?
│           ├─ SÍ ──→ MODO LOCAL DE CONTINGENCIA
│           │         - Operativa local completa
│           │         - Sin funciones cloud (copilot, sync futuro)
│           │         - Banner: "Sesión cloud inactiva"
│           │
│           └─ NO ──→ BLOQUEAR → Pantalla login (requiere red)
```

El modo contingencia NO es un booleano simple. Se comprueban dos cosas:
1. Flag `hasEverAuthenticated` en session-storage
2. Que `loadStateFromDB()` devuelva estado no nulo (hay campaña local)

## Base de datos — 1 migración

```sql
CREATE TYPE public.app_role AS ENUM ('admin', 'supervisor', 'operator');

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read own org" ON public.organizations
  FOR SELECT TO authenticated
  USING (id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  organization_id uuid REFERENCES public.organizations(id),
  role public.app_role NOT NULL DEFAULT 'operator',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own profile" ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

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
```

## Archivos nuevos

| Archivo | Función |
|---|---|
| `src/utils/session-storage.ts` | Abstracción get/set/remove para flags de sesión. Web: localStorage. Preparado para SecureStorage nativo |
| `src/hooks/useAuth.ts` | Hook: user, session, loading, isOfflineMode, signIn, signUp, signOut. `onAuthStateChange` antes de `getSession()` |
| `src/components/AuthGuard.tsx` | Guard offline-aware: sesión válida → pasa; hasEverAuthenticated + estado local → modo contingencia con banner; sin nada → login |
| `src/pages/AuthPage.tsx` | Login + registro. Email/contraseña. Validación Zod. Textos en español. Link recuperación de contraseña |
| `src/pages/ResetPasswordPage.tsx` | Formulario para nueva contraseña tras enlace de recuperación. Detecta `type=recovery` en URL hash |
| `src/components/LogoutDialog.tsx` | Diálogo de cierre de sesión con opción: conservar datos locales / borrar datos locales. Explica que el dispositivo es de usuario único |

## Archivos modificados

| Archivo | Cambio |
|---|---|
| `src/App.tsx` | Envolver con AuthGuard. Rutas `/auth` y `/reset-password` fuera del guard (públicas). Rutas `/driver` y `/driver-mini` también públicas (acceso por token). Pasar `isOfflineMode` para que componentes puedan saber si están en contingencia |
| `src/components/AppLayout.tsx` | Indicador de sesión en nav: iniciales/email del usuario o badge "Modo local". Botón que abre LogoutDialog |
| `src/pages/SettingsPage.tsx` | Sección "Cuenta" al principio: email, role, estado de sesión, botón logout con LogoutDialog |

## Logout con decisión sobre datos locales

El `LogoutDialog` presenta dos opciones:

1. **Cerrar sesión y conservar datos** — `signOut()` + mantener SQLite + mantener `hasEverAuthenticated`
2. **Cerrar sesión y borrar datos** — `signOut()` + `destroyDatabase()` + borrar `hasEverAuthenticated`

Texto explícito: "Este dispositivo se considera de usuario único. Si otro operador va a usar este dispositivo, se recomienda borrar los datos locales."

## Import/export local

No se toca. Sigue siendo función puramente local sin gate de auth. La sección de campaña en SettingsPage no se condiciona a sesión.

## Copilot

No se toca. Sigue funcionando con tokens anónimos via RPC. Documentado como migración futura para asociar sesiones a `user_id`.

## session-storage.ts

```typescript
const PREFIX = 'vialroute_';

export const sessionStore = {
  get(key: string): string | null {
    try { return localStorage.getItem(PREFIX + key); } catch { return null; }
  },
  set(key: string, value: string): void {
    try { localStorage.setItem(PREFIX + key, value); } catch {}
  },
  remove(key: string): void {
    try { localStorage.removeItem(PREFIX + key); } catch {}
  },
};
```

Preparado para sustituir por Capacitor SecureStorage en fase nativa sin cambiar la interfaz.

## Pendiente para siguiente subfase

- RLS por `user_id` en datos sincronizados cloud
- Migración copilot a sesiones asociadas a `user_id`
- Sincronización de campañas SQLite ↔ Cloud
- Gestión de organizaciones (invitaciones, admin)
- Tabla `user_roles` separada si se necesitan roles múltiples
- Migración de session-storage a Capacitor SecureStorage

