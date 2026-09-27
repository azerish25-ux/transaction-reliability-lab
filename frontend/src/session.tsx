import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from 'react';
import { ApiClient, ApiError, type Registered, type Session } from './api.js';

export type SessionStatus = 'BOOTING' | 'ANONYMOUS' | 'AUTHENTICATED' | 'ERROR';
export type ExecuteApi = <T>(operation: (api: ApiClient) => Promise<T>) => Promise<T>;

interface SessionContextValue {
  api: ApiClient;
  status: SessionStatus;
  user?: Session;
  bootstrapError?: unknown;
  expired: boolean;
  execute: ExecuteApi;
  login(email: string, password: string): Promise<Session>;
  register(input: { email: string; password: string; displayName: string }): Promise<{ registered: Registered; session: Session }>;
  logout(): Promise<void>;
  retryBootstrap(): Promise<void>;
  dismissExpired(): void;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function SessionProvider({ children }: PropsWithChildren): JSX.Element {
  const api = useMemo(() => new ApiClient(), []);
  const [status, setStatus] = useState<SessionStatus>('BOOTING');
  const [user, setUser] = useState<Session | undefined>();
  const [bootstrapError, setBootstrapError] = useState<unknown>();
  const [expired, setExpired] = useState(false);

  const becomeAnonymous = useCallback((showExpiry: boolean) => {
    api.clearSession();
    setUser(undefined);
    setStatus('ANONYMOUS');
    setExpired(showExpiry);
  }, [api]);

  const retryBootstrap = useCallback(async () => {
    setStatus('BOOTING');
    setBootstrapError(undefined);
    try {
      await api.csrfToken();
      const active = await api.me();
      setUser(active);
      setExpired(false);
      setStatus('AUTHENTICATED');
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        becomeAnonymous(false);
        return;
      }
      setUser(undefined);
      setBootstrapError(failure);
      setStatus('ERROR');
    }
  }, [api, becomeAnonymous]);

  useEffect(() => {
    void retryBootstrap();
  }, [retryBootstrap]);

  useEffect(() => {
    if (!user) return;
    const expiry = Date.parse(user.expiresAt);
    const delay = expiry - Date.now();
    if (!Number.isFinite(expiry) || delay <= 0) {
      becomeAnonymous(true);
      return;
    }
    const timer = window.setTimeout(() => becomeAnonymous(true), Math.min(delay, 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [becomeAnonymous, user]);

  const execute = useCallback<ExecuteApi>(async operation => {
    try {
      return await operation(api);
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) becomeAnonymous(true);
      throw failure;
    }
  }, [api, becomeAnonymous]);

  const login = useCallback(async (email: string, password: string) => {
    const active = await api.login(email, password);
    setUser(active);
    setExpired(false);
    setStatus('AUTHENTICATED');
    return active;
  }, [api]);

  const register = useCallback(async (input: { email: string; password: string; displayName: string }) => {
    const registered = await api.register(input);
    const active = await api.login(input.email, input.password);
    setUser(active);
    setExpired(false);
    setStatus('AUTHENTICATED');
    return { registered, session: active };
  }, [api]);

  const logout = useCallback(async () => {
    await execute(client => client.logout());
    becomeAnonymous(false);
  }, [becomeAnonymous, execute]);

  const value = useMemo<SessionContextValue>(() => ({
    api,
    status,
    user,
    bootstrapError,
    expired,
    execute,
    login,
    register,
    logout,
    retryBootstrap,
    dismissExpired: () => setExpired(false)
  }), [api, bootstrapError, execute, expired, login, logout, register, retryBootstrap, status, user]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used within SessionProvider');
  return value;
}
