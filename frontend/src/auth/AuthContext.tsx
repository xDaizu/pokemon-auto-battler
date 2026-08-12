import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { login as apiLogin, logout as apiLogout, fetchSession } from '../api/client';
import type { AuthUser } from '../api/types';

// Same namespaced convention as the language preference.
const STORAGE_KEY = 'pokemon-auto-battler:credentials';

interface CachedCredentials {
  username: string;
  displayName: string;
  pokemon: [string, string, string];
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, displayName: string, pokemon: [string, string, string]) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readCached(): CachedCredentials | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedCredentials;
    if (!parsed?.username || !parsed?.displayName || parsed.pokemon?.length !== 3) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Holds the signed-in trainer.
 *
 * Staying logged in is deliberately belt-and-braces. The session cookie is the
 * primary mechanism and is long-lived, but the combo is not a real secret, so
 * it's also cached here: if the cookie is ever gone (cleared, expired, a fresh
 * server), the cached combo is replayed silently and the trainer never sees the
 * form. Only an explicit logout ends that — which is why logout must clear the
 * cache too, or the next load would immediately sign them back in.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const booted = useRef(false);

  useEffect(() => {
    // StrictMode double-invokes effects in dev; without this guard the silent
    // relogin below fires two logins that race on session regeneration.
    if (booted.current) return;
    booted.current = true;

    void (async () => {
      const session = await fetchSession().catch(() => null);
      if (session?.user) {
        setUser(session.user);
        setLoading(false);
        return;
      }

      const cached = readCached();
      if (cached) {
        try {
          const { user: restored } = await apiLogin(cached.username, cached.displayName, cached.pokemon);
          setUser(restored);
          setLoading(false);
          return;
        } catch {
          // Stale combo or a network blip. Fall through to the form, but leave
          // the cache alone — a transient failure shouldn't discard a working
          // credential the trainer would otherwise never have to retype.
        }
      }

      setLoading(false);
    })();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      login: async (username, displayName, pokemon) => {
        const { user: loggedIn } = await apiLogin(username, displayName, pokemon);
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ username: loggedIn.username, displayName: loggedIn.displayName, pokemon })
        );
        setUser(loggedIn);
      },
      logout: async () => {
        await apiLogout().catch(() => undefined);
        window.localStorage.removeItem(STORAGE_KEY);
        setUser(null);
      },
    }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
