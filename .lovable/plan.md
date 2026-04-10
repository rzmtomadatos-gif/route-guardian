

# Gestión de roles de usuario desde admin

## Situación actual

- La tabla `user_roles` existe pero el admin no puede insertar, actualizar ni eliminar registros (RLS lo bloquea).
- La tabla `profiles` solo permite leer el perfil propio — el admin no puede ver la lista de usuarios.
- No hay ningún componente en la UI para gestionar roles.

## Cambios necesarios

### 1. Migración SQL — Abrir RLS para admin

```sql
-- Admin puede ver todos los perfiles
CREATE POLICY "Admins read all profiles"
ON public.profiles FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin gestiona user_roles (CRUD completo)
CREATE POLICY "Admins manage user_roles"
ON public.user_roles FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));
```

Esto no afecta a usuarios normales — solo amplía acceso para admin.

### 2. Nuevo componente `src/components/UserRolesManager.tsx`

- Carga todos los perfiles (`profiles`) con sus roles correspondientes (`user_roles`)
- Muestra lista: email, nombre, rol actual
- Selector desplegable por usuario con opciones: admin, operator, gabinete, supervisor
- Al cambiar: upsert en `user_roles` (insertar si no existe, actualizar si ya tiene rol)
- El admin no puede cambiarse el rol a sí mismo (protección contra auto-degradación)

### 3. Integrar en `src/pages/SettingsPage.tsx`

- Añadir `<UserRolesManager />` debajo de `AllowedEmailsManager`, visible solo si `canManageUsers`

### Archivos afectados

| Archivo | Cambio |
|---------|--------|
| Migración SQL | Políticas RLS para admin en profiles y user_roles |
| `src/components/UserRolesManager.tsx` | Nuevo — lista usuarios + selector de rol |
| `src/pages/SettingsPage.tsx` | Añadir UserRolesManager bajo canManageUsers |

### Riesgo

Bajo. Las políticas usan `has_role` (SECURITY DEFINER) que ya existe y funciona. No se tocan datos existentes.

