import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Me = {
  id: number;
  email: string;
  name: string;
  is_admin: boolean;
  worker: { id: number; first_name: string; last_name: string; phone: string; email: string } | null;
  roles: { id: number; name: string; is_steward: number }[];
};

type Session = {
  ready: boolean;
  server: string;
  token: string | null;
  me: Me | null;
  signIn: (server: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
};

const SERVER_KEY = "crewstaff.server";
const TOKEN_KEY = "crewstaff.token";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Module-level copy so plain functions (api, push) can reach the current session.
const current = { server: "", token: null as string | null, onUnauthorized: () => {} };

export function normalizeServer(s: string) {
  let v = s.trim().replace(/\/+$/, "");
  if (!v) return v;
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
  if (!/:\d+$/.test(v.replace(/^https?:\/\//, "")) && v.startsWith("http://")) v = `${v}:3000`;
  return v;
}

export async function api<T = unknown>(method: string, path: string, body?: unknown, opts?: { server?: string; token?: string | null }): Promise<T> {
  const server = opts?.server ?? current.server;
  const token = opts?.token !== undefined ? opts.token : current.token;
  if (!server) throw new ApiError(0, "Set the server address first");
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(`${server}/api${path}`, {
      method,
      signal: ctrl.signal,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body && !isForm ? { "content-type": "application/json" } : {}),
      },
      body: body ? (isForm ? (body as FormData) : JSON.stringify(body)) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can't reach the CrewStaff server. Check you're on the office Wi-Fi.");
  } finally {
    clearTimeout(timer);
  }
  const data = (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : null;
  if (res.status === 401 && token) current.onUnauthorized();
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [server, setServer] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);

  const clear = useCallback(async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    current.token = null;
    setToken(null);
    setMe(null);
  }, []);

  useEffect(() => {
    current.onUnauthorized = () => void clear();
  }, [clear]);

  useEffect(() => {
    (async () => {
      const s = (await SecureStore.getItemAsync(SERVER_KEY)) ?? process.env.EXPO_PUBLIC_SERVER_URL ?? "";
      const t = await SecureStore.getItemAsync(TOKEN_KEY);
      current.server = s;
      current.token = t;
      setServer(s);
      if (t) {
        try {
          const m = await api<Me>("GET", "/me");
          setMe(m);
          setToken(t);
        } catch (e) {
          // Offline at launch: keep the token and let screens retry.
          if (e instanceof ApiError && e.status === 0) setToken(t);
          else await clear();
        }
      }
      setReady(true);
    })();
  }, [clear]);

  const signIn = useCallback(async (srv: string, email: string, password: string) => {
    const s = normalizeServer(srv);
    const r = await api<{ token: string; user: Me }>("POST", "/auth/login", { email, password }, { server: s, token: null });
    if (!r.user.worker) throw new ApiError(403, "This app is for crew. Office admins use the CrewStaff website.");
    await SecureStore.setItemAsync(SERVER_KEY, s);
    await SecureStore.setItemAsync(TOKEN_KEY, r.token);
    current.server = s;
    current.token = r.token;
    setServer(s);
    setToken(r.token);
    setMe(r.user);
  }, []);

  const refreshMe = useCallback(async () => {
    setMe(await api<Me>("GET", "/me"));
  }, []);

  const signOut = useCallback(async () => {
    const { currentPushToken } = await import("./push");
    try {
      await api("POST", "/auth/logout", { push_token: currentPushToken() });
    } catch {
      // ignore — signing out locally is what matters
    }
    await clear();
  }, [clear]);

  const value = useMemo(() => ({ ready, server, token, me, signIn, signOut, refreshMe }), [ready, server, token, me, signIn, signOut, refreshMe]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}
