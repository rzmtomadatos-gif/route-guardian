

# Corrección modo contingencia + doble confirmación logout

## Cambios (4 archivos)

### 1. `src/utils/persistence/db.ts` — nueva función `probeLocalCampaign()`

```typescript
export async function probeLocalCampaign(): Promise<boolean> {
  try {
    const database = await initDatabase();
    if (!database) return false;
    const result = database.exec(
      `SELECT 1 FROM app_state WHERE key = 'current' LIMIT 1;`
    );
    return result.length > 0 && result[0].values.length > 0;
  } catch {
    return false;
  }
}
```

Solo lectura. No parsea JSON, no escribe, no modifica estado. `initDatabase()` es idempotente.

### 2. `src/utils/persistence/index.ts` — exportar `probeLocalCampaign`

Añadir a la línea de exports de `db.ts`.

### 3. `src/hooks/useAuth.ts` — usar `probeLocalCampaign()` en `init()`

Reemplazar `loadStateFromDB` + `initDatabase` por `probeLocalCampaign`:

```typescript
import { probeLocalCampaign, destroyDatabase } from '@/utils/persistence';

// En init():
if (!session && hasEverAuth) {
  try {
    hasLocalData = await probeLocalCampaign();
  } catch {
    hasLocalData = false;
  }
}
```

`signOut(false)` sigue sin tocar SQLite ni `hasEverAuthenticated`.

### 4. `src/components/LogoutDialog.tsx` — doble confirmación para borrado

Estado `confirmWipe`: primer clic cambia texto a "¿Seguro? Se perderán TODOS los datos. Pulsa de nuevo." con estilo destructivo fuerte. Timeout de 5s que resetea si no se confirma. Segundo clic ejecuta `signOut(true)`. "Conservar datos" sigue siendo un solo clic.

## Qué NO se toca

- Import/export de campañas — sin gate de auth
- `campaign-io.ts`, `campaign-schema.ts`, `AuthGuard.tsx`, `db.ts` (salvo nueva función)
- Datos locales reales — nunca se modifican durante el probe

## Validación post-implementación

Verificar con campaña Boadilla (626 tramos, 99+ incidencias, workDay 12):
1. Login con red → acceso normal
2. Cierre sesión conservando datos → SQLite intacta
3. Reapertura sin red → `probeLocalCampaign()` detecta estado → modo contingencia activo
4. Restauración correcta de ruta, tramos, incidencias y event log
5. Import/export accesible sin login

