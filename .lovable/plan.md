

# Fix: La app no redirige tras login exitoso

## Problema

`AuthPage` no tiene lógica de redirección. Tras un login exitoso:
- `supabase.auth.signInWithPassword()` actualiza la sesión internamente
- `onAuthStateChange` se dispara, pero `AuthPage` no reacciona navegando
- El usuario permanece en `/auth` hasta que recarga manualmente

## Corrección

**Archivo único**: `src/pages/AuthPage.tsx`

Dos cambios:

1. **Importar `useNavigate` y `Navigate`** de react-router-dom
2. **Obtener `user`** del hook `useAuth()`
3. **Si ya hay sesión activa, redirigir a `/`** (esto cubre el caso de que el usuario vuelva a `/auth` estando logueado, y también el momento justo post-login cuando `onAuthStateChange` actualiza el estado)

```typescript
import { useNavigate, Navigate } from 'react-router-dom';

export default function AuthPage() {
  const { signIn, signUp, resetPassword, user, loading } = useAuth();
  const navigate = useNavigate();

  // Si ya hay sesión, redirigir a la app
  if (!loading && user) {
    return <Navigate to="/" replace />;
  }

  // handleLogin: tras login exitoso, navegar explícitamente
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    const { error } = await signIn(email, password);
    setLoading(false);
    if (error) {
      toast.error(...);
    } else {
      navigate('/', { replace: true });
    }
  };
  // ... resto sin cambios
```

## Por qué funciona

- `useAuth` tiene `onAuthStateChange` que actualiza `user` cuando la sesión se crea
- La redirección con `Navigate` captura el caso reactivo (sesión ya activa)
- El `navigate()` en `handleLogin` cubre el caso imperativo (justo tras login exitoso)
- Doble garantía: si uno falla, el otro actúa

## Qué NO se toca

- `useAuth.ts` — sin cambios
- `AuthGuard.tsx` — sin cambios
- Persistencia, campaña, esquemas — intactos

