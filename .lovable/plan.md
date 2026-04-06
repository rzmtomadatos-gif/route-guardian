

# Lista blanca de emails autorizados

## Situación actual

Cualquier persona puede registrarse en `/auth` y acceder a la app. No hay control de acceso post-registro.

## Solución

Crear una tabla `allowed_emails` en la base de datos con los emails autorizados. El registro se bloquea en dos puntos:

1. **Frontend** (`AuthPage.tsx`): antes de llamar a `signUp`, consultar `allowed_emails` para verificar si el email está permitido. Si no lo está, mostrar error sin intentar el registro.
2. **Backend** (trigger SQL): como segunda barrera, un trigger `BEFORE INSERT` en `auth.users` que rechace registros de emails no autorizados. **Nota**: no se puede poner triggers en `auth.users` (esquema reservado). En su lugar, la validación será por RLS + frontend, y opcionalmente ocultar el registro por completo.

**Enfoque final elegido**: validación en frontend + tabla `allowed_emails` con política RLS de solo lectura pública para que el frontend pueda consultarla.

## Cambios

### 1. Migración SQL — tabla `allowed_emails`

```sql
CREATE TABLE public.allowed_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  added_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

ALTER TABLE public.allowed_emails ENABLE ROW LEVEL SECURITY;

-- Cualquier usuario (incluso anónimo) puede leer para validar registro
CREATE POLICY "Public read allowed_emails"
  ON public.allowed_emails FOR SELECT
  TO public
  USING (true);

-- Insertar tu email como primer autorizado
INSERT INTO public.allowed_emails (email, notes) 
VALUES ('ernestorru@gmail.com', 'Admin principal');
```

### 2. `src/pages/AuthPage.tsx` — validación pre-registro

En `handleRegister`, antes de llamar a `signUp`:

```typescript
// Verificar si el email está en la lista de autorizados
const { data } = await supabase
  .from('allowed_emails')
  .select('email')
  .eq('email', email.toLowerCase().trim())
  .maybeSingle();

if (!data) {
  toast.error('Este email no está autorizado. Contacta con el administrador.');
  setLoading(false);
  return;
}
```

### 3. `src/pages/SettingsPage.tsx` — gestión de lista blanca (solo admin)

Añadir una sección en Configuración visible solo para el usuario admin (comprobando el `role` del perfil) que permita:
- Ver emails autorizados
- Añadir nuevos emails
- Eliminar emails de la lista

Para esto se necesita una política RLS de INSERT/DELETE para admins:

```sql
CREATE POLICY "Admins manage allowed_emails"
  ON public.allowed_emails FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
```

### 4. Asignar rol admin a tu usuario

```sql
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role FROM auth.users 
WHERE email = 'ernestorru@gmail.com';
```

Esto requiere primero crear la tabla `user_roles` según las instrucciones de seguridad del sistema:

```sql
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
-- Nota: app_role ya existe en el proyecto (admin, supervisor, operator)
-- Se usará la función has_role existente o se creará si no existe

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
```

## Resumen de archivos afectados

| Archivo | Cambio |
|---------|--------|
| Migración SQL | Tabla `allowed_emails`, tabla `user_roles`, políticas RLS, seed admin |
| `src/pages/AuthPage.tsx` | Validación email antes de registro |
| `src/pages/SettingsPage.tsx` | Sección admin para gestionar lista blanca |

## Qué NO se toca

- `useAuth.ts`, `AuthGuard.tsx` — sin cambios
- Persistencia local, campaña, esquemas — intactos
- Flujo de login — sin cambios (solo se restringe el registro)

