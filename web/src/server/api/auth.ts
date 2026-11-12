import { z } from "zod";
import { route } from "../router";
import { all, get, run, nowIso } from "../db";
import { body, bad, json, zReq } from "../http";
import { COOKIE, checkPassword, currentUser, hashPassword, requireUser, signToken } from "../auth";

route("POST", "/auth/login", async ({ req }) => {
  const b = await body(req, z.object({ email: zReq(), password: z.string().min(1), web: z.boolean().optional() }));
  const u = get<{ id: number; password_hash: string; is_admin: number; worker_id: number | null }>(
    "SELECT id, password_hash, is_admin, worker_id FROM users WHERE email = ?",
    b.email,
  );
  if (!u || !checkPassword(b.password, u.password_hash)) throw bad("Wrong email or password");
  if (u.worker_id) {
    const w = get<{ status: string }>("SELECT status FROM workers WHERE id = ?", u.worker_id);
    if (w?.status !== "active") throw bad("This account is inactive. Contact the office.");
  }
  if (b.web && !u.is_admin) throw bad("The web app is for admins. Crew members use the CrewStaff phone app.");
  const token = await signToken(u.id);
  const res = json({ token, user: await me(u.id) });
  if (b.web) {
    res.headers.append("set-cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${180 * 86400}`);
  }
  return res;
});

route("POST", "/auth/logout", async ({ req }) => {
  const u = await currentUser(req);
  const b = await req.json().catch(() => ({}));
  if (u && b?.push_token) run("DELETE FROM push_tokens WHERE token = ? AND user_id = ?", b.push_token, u.id);
  const res = json({ ok: true });
  res.headers.append("set-cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return res;
});

async function me(userId: number) {
  const u = get<{ id: number; email: string; name: string; is_admin: number; worker_id: number | null }>(
    "SELECT id, email, name, is_admin, worker_id FROM users WHERE id = ?",
    userId,
  )!;
  const worker = u.worker_id
    ? get<{ id: number; first_name: string; last_name: string; phone: string; email: string }>(
        "SELECT id, first_name, last_name, phone, email FROM workers WHERE id = ?",
        u.worker_id,
      )
    : null;
  const roles = u.worker_id
    ? all<{ id: number; name: string; is_steward: number }>(
        "SELECT r.id, r.name, r.is_steward FROM worker_roles wr JOIN roles r ON r.id = wr.role_id WHERE wr.worker_id = ? ORDER BY r.name",
        u.worker_id,
      )
    : [];
  return {
    id: u.id,
    email: u.email,
    name: worker ? `${worker.first_name} ${worker.last_name}` : u.name,
    is_admin: !!u.is_admin,
    worker,
    roles,
  };
}

route("GET", "/me", async ({ req }) => me((await requireUser(req)).id));

route("POST", "/me/password", async ({ req }) => {
  const u = await requireUser(req);
  const b = await body(req, z.object({ current: z.string(), next: z.string().min(8, "must be at least 8 characters") }));
  const row = get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", u.id)!;
  if (!checkPassword(b.current, row.password_hash)) throw bad("Current password is wrong");
  run("UPDATE users SET password_hash = ? WHERE id = ?", hashPassword(b.next), u.id);
  return { ok: true };
});

route("POST", "/me/push-token", async ({ req }) => {
  const u = await requireUser(req);
  const b = await body(req, z.object({ token: z.string().min(10), platform: z.string().default("android") }));
  run(
    `INSERT INTO push_tokens (token, user_id, platform, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (token) DO UPDATE SET user_id = excluded.user_id, updated_at = excluded.updated_at`,
    b.token, u.id, b.platform, nowIso(),
  );
  return { ok: true };
});

route("GET", "/me/notifications", async ({ req, q }) => {
  const u = await requireUser(req);
  const after = Number(q.get("after") || 0);
  const items = all<{ id: number; title: string; body: string; data: string; read_at: string | null; created_at: string }>(
    "SELECT id, title, body, data, read_at, created_at FROM notifications WHERE user_id = ? AND id > ? ORDER BY id DESC LIMIT 50",
    u.id,
    after,
  ).map((n) => ({ ...n, data: JSON.parse(n.data) }));
  const unread = get<{ n: number }>("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL", u.id)!.n;
  return { items, unread };
});

route("POST", "/me/notifications/read", async ({ req }) => {
  const u = await requireUser(req);
  run("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL", nowIso(), u.id);
  return { ok: true };
});
