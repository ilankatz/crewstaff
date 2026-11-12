import { HttpError, json } from "./http";

export type Ctx = {
  req: Request;
  p: Record<string, string>;
  q: URLSearchParams;
};
type Handler = (ctx: Ctx) => Promise<Response | unknown> | Response | unknown;
type Route = { method: string; re: RegExp; keys: string[]; handler: Handler };

const routes: Route[] = [];

/** Register a route. Path params look like `/calls/:id`. Paths are relative to /api. */
export function route(method: string, path: string, handler: Handler) {
  const keys: string[] = [];
  const re = new RegExp(
    "^" +
      path.replace(/[.]/g, "\\.").replace(/:(\w+)/g, (_, k) => {
        keys.push(k);
        return "([^/]+)";
      }) +
      "/?$",
  );
  routes.push({ method, re, keys, handler });
}

export async function dispatch(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "") || "/";
  let pathMatched = false;
  for (const r of routes) {
    const m = path.match(r.re);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== req.method) continue;
    const p: Record<string, string> = {};
    r.keys.forEach((k, i) => (p[k] = decodeURIComponent(m[i + 1])));
    try {
      const out = await r.handler({ req, p, q: url.searchParams });
      return out instanceof Response ? out : json(out ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNIQUE constraint failed")) return json({ error: "That already exists" }, 409);
      if (msg.includes("FOREIGN KEY constraint failed")) return json({ error: "It's still in use, so it can't be removed" }, 409);
      console.error(`[crewstaff] ${req.method} ${path}`, e);
      return json({ error: "Something went wrong on the server" }, 500);
    }
  }
  return json({ error: pathMatched ? "Method not allowed" : "Not found" }, pathMatched ? 405 : 404);
}
