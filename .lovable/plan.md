

## Diagnóstico

La app muestra una pantalla completamente en blanco porque **`sql.js` v1.11.0 no proporciona un export default ESM**, pero el código en `src/utils/persistence/db.ts` lo importa como si lo tuviera:

```
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
```

El error exacto en consola es:
> `SyntaxError: The requested module '/node_modules/sql.js/dist/sql-wasm.js' does not provide an export named 'default'`

Esto mata la carga de `db.ts` → `persistence/index.ts` → `App.tsx` → **nada se renderiza**.

## Plan de corrección

### Paso 1: Corregir el import de sql.js en `src/utils/persistence/db.ts`

Cambiar la línea 38 de:
```typescript
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
```

A un import compatible con el formato CommonJS de sql.js:
```typescript
import initSqlJsModule from 'sql.js';
const initSqlJs = initSqlJsModule as unknown as typeof import('sql.js').default;
```

O más simple y robusto, usar un dynamic import con fallback:
```typescript
// sql.js exports CJS, not ESM default — handle both cases
import * as sqlJsModule from 'sql.js';
const initSqlJs: any = (sqlJsModule as any).default ?? sqlJsModule;
```

Y para el tipo `Database`, importarlo solo como type:
```typescript
import type { Database as SqlJsDatabase } from 'sql.js';
```

### Paso 2: Verificar que la app renderiza

Tras el cambio, comprobar que `/map` y `/` cargan correctamente sin errores en consola.

## Archivos a modificar

- `src/utils/persistence/db.ts` — línea 38: corregir import de sql.js

## Impacto

- Cero impacto en lógica de negocio
- Restaura el renderizado completo de la app
- Mantiene toda la funcionalidad de persistencia SQLite existente

