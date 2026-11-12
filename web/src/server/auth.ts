import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { authSecret, get } from "./db";
import { HttpError, forbidden } from "./http";

export const COOKIE = "cs_token";

export type User = {
  id: number;
  email: string;
  name: string;
  is_admin: number;
  worker_id: number | null;
};

export async function signToken(userId: number) {
  return new SignJWT({ sub: String(userId) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("180d")
    .sign(authSecret());
}

function tokenFrom(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (h?.startsWith("Bearer ")) return h.slice(7);
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (m) return decodeURIComponent(m[1]);
  // The phone app opens document files in the system viewer, which can't send headers.
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname.startsWith("/api/documents/")) return url.searchParams.get("token");
  return null;
}

export async function currentUser(req: Request): Promise<User | null> {
  const token = tokenFrom(req);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, authSecret());
    const user = get<User>("SELECT id, email, name, is_admin, worker_id FROM users WHERE id = ?", Number(payload.sub));
    if (!user) return null;
    if (user.worker_id) {
      const w = get<{ status: string }>("SELECT status FROM workers WHERE id = ?", user.worker_id);
      if (w?.status !== "active") return null;
    }
    return user;
  } catch {
    return null;
  }
}

export async function requireUser(req: Request): Promise<User> {
  const u = await currentUser(req);
  if (!u) throw new HttpError(401, "Please sign in");
  return u;
}

export async function requireAdmin(req: Request): Promise<User> {
  const u = await requireUser(req);
  if (!u.is_admin) throw forbidden("Admins only");
  return u;
}

export async function requireWorker(req: Request): Promise<User & { worker_id: number }> {
  const u = await requireUser(req);
  if (!u.worker_id) throw forbidden("This login is not linked to a worker profile");
  return u as User & { worker_id: number };
}

export function checkPassword(plain: string, hash: string) {
  return bcrypt.compareSync(plain, hash);
}
export function hashPassword(plain: string) {
  return bcrypt.hashSync(plain, 10);
}

/** Readable temporary password, e.g. "maple-river-42". */
export function tempPassword() {
  const words = ["amber", "cedar", "delta", "ember", "flint", "harbor", "indigo", "juniper", "maple", "nova", "orbit", "pine", "quartz", "river", "sierra", "timber", "vista", "willow"];
  const pick = () => words[Math.floor(Math.random() * words.length)];
  return `${pick()}-${pick()}-${10 + Math.floor(Math.random() * 90)}`;
}
