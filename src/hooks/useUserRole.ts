import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

const ROLE_CACHE_KEY = 'vialroute_user_role';

export type AppRole = 'admin' | 'supervisor' | 'operator' | 'gabinete';

interface UserRoleState {
  role: AppRole | null;
  loading: boolean;
  /** Can start/stop navigation, initiate/complete segments, add incidents */
  canNavigate: boolean;
  /** Can manage allowed emails and user administration */
  canManageUsers: boolean;
  /** Field operator (admin or operator) — full operational capabilities */
  isFieldOperator: boolean;
}

export function useUserRole(): UserRoleState {
  const { user, isOfflineMode } = useAuth();
  const [role, setRole] = useState<AppRole | null>(() => {
    try {
      const cached = sessionStorage.getItem(ROLE_CACHE_KEY);
      return cached as AppRole | null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(!role);

  useEffect(() => {
    if (!user) {
      if (isOfflineMode) {
        // Keep cached role for offline mode
        setLoading(false);
      } else {
        setRole(null);
        setLoading(false);
        try { sessionStorage.removeItem(ROLE_CACHE_KEY); } catch { }
      }
      return;
    }

    let cancelled = false;

    const fetchRole = async () => {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();

      if (cancelled) return;

      const fetched = (data?.role as AppRole) ?? null;
      setRole(fetched);
      setLoading(false);

      if (fetched) {
        try { sessionStorage.setItem(ROLE_CACHE_KEY, fetched); } catch { }
      }
    };

    fetchRole();
    return () => { cancelled = true; };
  }, [user, isOfflineMode]);

  const canNavigate = role === 'admin' || role === 'operator';
  const canManageUsers = role === 'admin';
  const isFieldOperator = role === 'admin' || role === 'operator';

  return { role, loading, canNavigate, canManageUsers, isFieldOperator };
}
