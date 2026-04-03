

## Preservar token en actualizaciones Realtime

### Problema

Tras aplicar la migración de column-level grants, `payload.new` de Realtime ya no incluirá `token`. El handler del driver reemplaza el estado completo con `parseSession(payload.new)`, perdiendo el token necesario para las llamadas RPC (`advanceQueue` usa `session.token`). El handler del operador ya hace merge con `...prev`, pero también puede sobreescribir `token` con `undefined`.

### Cambios en `src/hooks/useCopilotSession.ts`

**1. Driver side (línea 180-182)** — Merge en vez de reemplazo, preservando token:

```typescript
(payload) => {
  setSession(prev => {
    const parsed = parseSession(payload.new);
    if (!prev) return parsed;
    return { ...prev, ...parsed, token: prev.token };
  });
}
```

**2. Operator side (línea 55-63)** — Añadir protección explícita del token:

```typescript
setSession(prev => {
  if (!prev) return prev;
  const raw = payload.new as any;
  return {
    ...prev,
    ...raw,
    queue: Array.isArray(raw.queue) ? raw.queue : JSON.parse(raw.queue || '[]'),
    token: prev.token,
  };
});
```

### Impacto

- Dos líneas añadidas (`token: prev.token`) en cada handler.
- Cero cambios en lógica de negocio, RPCs o base de datos.
- El token inicial (obtenido vía RPC `SECURITY DEFINER`) se conserva durante toda la sesión.
- Compatible con el estado actual (si `payload.new` aún trae `token`, se ignora a favor del original).

