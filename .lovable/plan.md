

# Implementación de roles: admin, operator, gabinete

## Resumen

Añadir el rol `gabinete` al enum existente, crear un hook `useUserRole` para consultar el rol del usuario actual, y aplicar restricciones en la UI según el rol.

## Definición de permisos

| Capacidad | Admin | Operator | Gabinete |
|-----------|-------|----------|----------|
| Cargar KML / importar campaña | ✓ | ✓ | ✓ |
| Ver mapa, buscar tramos | ✓ | ✓ | ✓ |
| Gestionar capas, mover tramos | ✓ | ✓ | ✓ |
| Crear/unir/editar tramos | ✓ | ✓ | ✓ |
| Iniciar/detener navegación | ✓ | ✓ | ✗ |
| Iniciar/completar/cancelar tramos | ✓ | ✓ | ✗ |
| Añadir incidencias | ✓ | ✓ | ✗ |
| Gestionar emails autorizados | ✓ | ✗ | ✗ |
| Exportar campaña / KML | ✓ | ✓ | ✓ |
| Configuración general | ✓ | ✓ | ✓ |

## Cambios

### 1. Migración SQL — añadir `gabinete` al enum `app_role`

```sql
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'gabinete';
```

Una sola sentencia. No rompe datos existentes ni políticas RLS actuales.

### 2. Nuevo hook `src/hooks/useUserRole.ts`

- Consulta `user_roles` al montar (si hay usuario autenticado)
- Cachea en `sessionStorage` para no repetir consultas
- Expone: `role: 'admin' | 'operator' | 'gabinete' | 'supervisor' | null`, `loading`, `canNavigate` (admin/operator), `canManageUsers` (admin), `isFieldOperator` (admin/operator)
- En modo offline devuelve el rol cacheado

### 3. Restricciones en UI

**`src/pages/MapPage.tsx`**:
- Si `!canNavigate`: ocultar botón "Iniciar navegación", botón de GPS, y no renderizar `NavigationOverlay`
- El mapa sigue visible y funcional (buscar tramos, ver capas, crear tramos)

**`src/components/MapControlPanel.tsx`**:
- Si `!canNavigate`: ocultar controles de navegación (Start/Stop nav)

**`src/pages/SettingsPage.tsx`**:
- Ya tiene `isAdmin` — se reemplaza por `useUserRole().canManageUsers`

**`src/components/AppLayout.tsx`**:
- Sin cambios (gabinete tiene acceso a todas las pestañas)

### 4. Archivos afectados

| Archivo | Cambio |
|---------|--------|
| Migración SQL | `ALTER TYPE app_role ADD VALUE 'gabinete'` |
| `src/hooks/useUserRole.ts` | Nuevo — hook de rol con helpers |
| `src/pages/MapPage.tsx` | Condicionar navegación a `canNavigate` |
| `src/components/MapControlPanel.tsx` | Ocultar controles de nav si `!canNavigate` |
| `src/pages/SettingsPage.tsx` | Usar `useUserRole` en vez de consulta directa |

### 5. Riesgos

- Ninguno sobre datos o lógica existente. El enum acepta `ADD VALUE` sin romper filas existentes.
- Los usuarios actuales (admin, operator) no cambian de comportamiento.
- Gabinete es puramente restrictivo en UI — no añade rutas nuevas ni modifica persistencia.

