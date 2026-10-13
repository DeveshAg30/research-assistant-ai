import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as apiClient from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [usage, setUsage] = useState(null);
  const [isLoading, setIsLoading] = useState(() => Boolean(apiClient.getToken()));

  const logout = useCallback(() => {
    apiClient.setToken(null);
    setUser(null);
    setUsage(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await apiClient.fetchMe();
      setUser(data.user);
      setUsage(data.usage);
    } catch (err) {
      if (err.response?.status === 401) logout();
    }
  }, [logout]);

  useEffect(() => {
    apiClient.setUnauthorizedHandler(logout);
    if (!apiClient.getToken()) return;
    refresh().finally(() => setIsLoading(false));
  }, [logout, refresh]);

  const authenticate = useCallback(
    async (mode, email, password) => {
      const fn = mode === 'register' ? apiClient.register : apiClient.login;
      const { token, user: nextUser } = await fn(email, password);
      apiClient.setToken(token);
      setUser(nextUser);
      await refresh();
    },
    [refresh]
  );

  const value = useMemo(
    () => ({ user, usage, isLoading, authenticate, logout, refreshUsage: refresh }),
    [user, usage, isLoading, authenticate, logout, refresh]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
