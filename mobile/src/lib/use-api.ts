import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./session";

type State<T> = { path: string | null; data: T | null; error: string | null };

/** GET a path when the screen is focused, then re-poll every `pollMs` while it stays focused. */
export function useApi<T>(path: string | null, pollMs?: number) {
  const [state, setState] = useState<State<T>>({ path: null, data: null, error: null });
  const [refreshing, setRefreshing] = useState(false);
  const pathRef = useRef(path);
  useEffect(() => {
    pathRef.current = path;
  }, [path]);

  const load = useCallback(async () => {
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

  useFocusEffect(
    useCallback(() => {
      if (!path) return;
      void load();
      if (!pollMs) return;
      const t = setInterval(() => void load(), pollMs);
      return () => clearInterval(t);
    }, [load, pollMs, path]),
  );

  const current = state.path === path;
  const data = current ? state.data : null;
  const error = current ? state.error : null;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return { data, error, reload: load, refresh, refreshing };
}
