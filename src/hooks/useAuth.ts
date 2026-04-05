import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { sessionStore } from '@/utils/session-storage';
import { loadStateFromDB, destroyDatabase } from '@/utils/persistence';
import type { Session, User } from '@supabase/supabase-js';

const HAS_EVER_AUTH_KEY = 'hasEverAuthenticated';

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  /** True when operating without valid session but with local data */
  isOfflineMode: boolean;
  /** True when local data exists and device was previously authenticated */
  hasLocalFallback: boolean;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
    isOfflineMode: false,
    hasLocalFallback: false,
  });

  useEffect(() => {
    // Set up listener BEFORE getSession (per Supabase best practice)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session?.user) {
          sessionStore.set(HAS_EVER_AUTH_KEY, 'true');
        }
        setState((prev) => ({
          ...prev,
          user: session?.user ?? null,
          session,
          loading: false,
          isOfflineMode: !session && prev.hasLocalFallback,
        }));
      }
    );

    // Initial session check
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const hasEverAuth = sessionStore.get(HAS_EVER_AUTH_KEY) === 'true';

      let hasLocalData = false;
      if (!session && hasEverAuth) {
        try {
          const localState = await loadStateFromDB();
          hasLocalData = localState !== null;
        } catch {
          hasLocalData = false;
        }
      }

      if (session?.user) {
        sessionStore.set(HAS_EVER_AUTH_KEY, 'true');
      }

      setState({
        user: session?.user ?? null,
        session,
        loading: false,
        isOfflineMode: !session && hasEverAuth && hasLocalData,
        hasLocalFallback: hasEverAuth && hasLocalData,
      });
    };

    init();

    return () => subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }, []);

  const signUp = useCallback(async (email: string, password: string, fullName?: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: window.location.origin,
      },
    });
    return { error };
  }, []);

  const signOut = useCallback(async (wipeLocalData = false) => {
    if (wipeLocalData) {
      await destroyDatabase();
      sessionStore.remove(HAS_EVER_AUTH_KEY);
    }
    await supabase.auth.signOut();
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    return { error };
  }, []);

  return {
    ...state,
    signIn,
    signUp,
    signOut,
    resetPassword,
  };
}
