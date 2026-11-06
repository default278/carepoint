import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getSupabaseConfigError, isSupabaseConfigured, supabase } from '../lib/supabase';
import { extractAssignedRoles } from '../lib/role-mapping';
import type { UserProfile } from '../types';

const STORAGE_KEY = 'carepoint-session';

type LoginPayload = {
  email: string;
  password: string;
};

type AuthContextValue = {
  user: UserProfile | null;
  loading: boolean;
  error: string | null;
  login: (payload: LoginPayload) => Promise<UserProfile | null>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type ProfileWithRoles = {
  id: string;
  full_name: string | null;
  phone: string | null;
  user_roles?: unknown;
};

async function loadProfile(authUser: {
  id: string;
  email?: string;
  banned_until?: string;
}): Promise<UserProfile> {
  if (authUser.banned_until && Date.parse(authUser.banned_until) > Date.now()) {
    throw new Error('This account is currently disabled.');
  }
  if (!supabase) {
    throw new Error('Supabase client is not initialized.');
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id,full_name,phone,user_roles(roles(name))')
    .eq('id', authUser.id)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to retrieve your profile and database role: ${error.message}`);
  }
  if (!data) {
    throw new Error('This Auth account has no matching profile.');
  }

  const profileData = data as ProfileWithRoles;
  const assignedRoles = extractAssignedRoles(profileData.user_roles);

  if (assignedRoles.length === 0) {
    throw new Error('This account has no valid role assigned in user_roles.');
  }
  if (assignedRoles.length > 1) {
    throw new Error('This account has multiple role assignments. Contact an administrator to resolve the ambiguity.');
  }
  const [roleName] = assignedRoles;

  return {
    id: profileData.id,
    email: authUser.email ?? '',
    full_name: profileData.full_name ?? authUser.email ?? 'Carepoint User',
    phone: profileData.phone ?? null,
    role: roleName,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setSession = useCallback((value: UserProfile | null) => {
    setUser(value);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  useEffect(() => {
    const hydrateSession = async () => {
      if (!isSupabaseConfigured || !supabase) {
        setUser(null);
        setLoading(false);
        return;
      }

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          localStorage.removeItem(STORAGE_KEY);
          setUser(null);
          setLoading(false);
          return;
        }

        setSession(await loadProfile(session.user));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to restore the session.');
        setUser(null);
        localStorage.removeItem(STORAGE_KEY);
      } finally {
        setLoading(false);
      }
    };

    void hydrateSession();
  }, [setSession]);

  const login = useCallback(async ({ email, password }: LoginPayload) => {
    setError(null);
    setLoading(true);

    try {
      const configError = getSupabaseConfigError();
      if (configError) {
        throw new Error(`${configError} Configure the project .env file and restart the app.`);
      }

      if (!supabase) {
        throw new Error('Supabase client is not initialized.');
      }

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        throw new Error(signInError.message);
      }

      const userId = data.user?.id;
      if (!userId) {
        throw new Error('Authentication succeeded but the user profile is unavailable.');
      }

      const profile = await loadProfile(data.user);
      setSession(profile);
      return profile;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to sign in.';
      setError(message);
      setSession(null);
      if (supabase) {
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) {
          setError(`${message} Sign-out cleanup failed: ${signOutError.message}`);
        }
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, [setSession]);

  const logout = useCallback(async () => {
    if (supabase) {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        throw new Error(`Unable to sign out: ${signOutError.message}`);
      }
    }
    setSession(null);
  }, [setSession]);

  const resetPassword = useCallback(async (email: string) => {
    if (!supabase) {
      throw new Error('Supabase is not configured. Add the required values to .env before resetting a password.');
    }

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim());
    if (resetError) {
      throw new Error(resetError.message);
    }
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    if (!supabase) {
      throw new Error('Supabase is not configured. Add the required values to .env before updating a password.');
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      throw new Error(error.message);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, error, login, logout, resetPassword, updatePassword }),
    [error, loading, login, logout, resetPassword, updatePassword, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
