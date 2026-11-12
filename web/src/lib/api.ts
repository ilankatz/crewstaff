"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body && !isForm ? { "content-type": "application/json" } : undefined,
    body: body ? (isForm ? (body as FormData) : JSON.stringify(body)) : undefined,
  });
  if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    // Session expired: full reload to the login page so all client state is dropped.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error || `Request failed (${res.status})`);
  return data as T;
}

type State<T> = { path: string | null; data: T | null; error: string | null };

/** Load JSON from the API, optionally re-polling every `pollMs` while the tab is visible. */
export function useData<T>(path: string | null, pollMs?: number) {
  const [state, setState] = useState<State<T>>({ path: null, data: null, error: null });
  const pathRef = useRef(path);
  useEffect(() => {
    pathRef.current = path;
  }, [path]);

  const reload = useCallback(async () => {
    const p = pathRef.current;
    if (!p) return;
    try {
      const d = await api<T>("GET", p);
      if (pathRef.current === p) setState({ path: p, data: d, error: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (pathRef.current === p) setState((s) => ({ path: p, data: s.path === p ? s.data : null, error: msg }));
    }
  }, []);

  useEffect(() => {
    if (!path) return;
    void reload();
    if (!pollMs) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, pollMs);
    return () => clearInterval(t);
  }, [path, pollMs, reload]);

  const current = state.path === path;
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    loading: !!path && !(current && (state.data || state.error)),
    reload,
  };
}
