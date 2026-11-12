import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { pushStatus } from "../push";
import { route } from "../router";
import { UPLOAD_DIR, all, get, run, tx } from "../db";
import { bad, body, forbidden, intId, notFound, zDate, zId, zReq, zStr } from "../http";
import { hashPassword, requireAdmin, requireUser, requireWorker, tempPassword, type User } from "../auth";
import { entryHours, round2 } from "../core";

// ---------------------------------------------------------------- roles

route("GET", "/admin/roles", async ({ req }) => {
  await requireAdmin(req);
  return all(
    `SELECT r.*, (SELECT COUNT(*) FROM worker_roles wr JOIN workers w ON w.id = wr.worker_id AND w.status = 'active'
                  WHERE wr.role_id = r.id) worker_count
       FROM roles r ORDER BY r.is_steward DESC, r.name`,
  );
});

route("POST", "/admin/roles", async ({ req }) => {
  await requireAdmin(req);
  const b = await body(req, z.object({ name: zReq(60), is_steward: z.boolean().default(false) }));
  const r = run("INSERT INTO roles (name, is_steward) VALUES (?, ?)", b.name, b.is_steward ? 1 : 0);
  return { id: r.lastInsertRowid };
});

route("PATCH", "/admin/roles/:id", async ({ req, p }) => {
  await requireAdmin(req);
  const b = await body(req, z.object({ name: zReq(60).optional(), active: z.boolean().optional(), is_steward: z.boolean().optional() }));
  const id = intId(p.id);
  if (b.name !== undefined) run("UPDATE roles SET name = ? WHERE id = ?", b.name, id);
  if (b.active !== undefined) run("UPDATE roles SET active = ? WHERE id = ?", b.active ? 1 : 0, id);
  if (b.is_steward !== undefined) run("UPDATE roles SET is_steward = ? WHERE id = ?", b.is_steward ? 1 : 0, id);
  return { ok: true };
});

// ---------------------------------------------------------------- workers

const workerSchema = z.object({
  first_name: zReq(60),
  last_name: zReq(60),
  email: z.string().trim().email("must be a valid email"),
  phone: zStr(40).default(""),
  notes: zStr(2000).default(""),
  role_ids: z.array(zId).min(1, "pick at least one role"),
});

route("GET", "/admin/workers", async ({ req, q }) => {
  await requireAdmin(req);
  const status = q.get("status") || "active";
  const workers = all<Record<string, unknown> & { id: number }>(
    `SELECT w.*,
            (SELECT GROUP_CONCAT(r.name, ', ') FROM worker_roles wr JOIN roles r ON r.id = wr.role_id WHERE wr.worker_id = w.id) roles,
            (SELECT GROUP_CONCAT(wr.role_id) FROM worker_roles wr WHERE wr.worker_id = w.id) role_ids,
            (SELECT COUNT(*) FROM worker_documents d WHERE d.worker_id = w.id AND d.expires_on IS NOT NULL AND d.expires_on < date('now','localtime')) expired_docs,
            (SELECT COUNT(*) FROM worker_documents d WHERE d.worker_id = w.id AND d.expires_on IS NOT NULL
                AND d.expires_on >= date('now','localtime') AND d.expires_on <= date('now','localtime','+30 days')) expiring_docs,
            (SELECT COUNT(*) FROM worker_documents d WHERE d.worker_id = w.id) doc_count
       FROM workers w
      WHERE (? = 'all' OR w.status = ?)
      ORDER BY w.last_name, w.first_name`,
    status,
    status,
  );
  return workers.map((w) => ({ ...w, role_ids: String(w.role_ids ?? "").split(",").filter(Boolean).map(Number) }));
});

route("POST", "/admin/workers", async ({ req }) => {
  await requireAdmin(req);
  const b = await body(req, workerSchema.extend({ password: z.string().min(8).optional() }));
  if (get("SELECT 1 FROM users WHERE email = ?", b.email)) throw bad("A login with that email already exists");
  const password = b.password || tempPassword();
  const id = tx(() => {
    const r = run(
      "INSERT INTO workers (first_name, last_name, email, phone, notes) VALUES (?, ?, ?, ?, ?)",
      b.first_name, b.last_name, b.email, b.phone, b.notes,
    );
    const wid = Number(r.lastInsertRowid);
    for (const rid of new Set(b.role_ids)) run("INSERT INTO worker_roles (worker_id, role_id) VALUES (?, ?)", wid, rid);
    run("INSERT INTO users (email, password_hash, name, worker_id) VALUES (?, ?, ?, ?)", b.email, hashPassword(password), `${b.first_name} ${b.last_name}`, wid);
    return wid;
  });
  return { id, email: b.email, temp_password: password };
});

route("GET", "/admin/workers/:id", async ({ req, p }) => {
  await requireAdmin(req);
  const id = intId(p.id);
  const w = get("SELECT * FROM workers WHERE id = ?", id);
  if (!w) throw notFound("Worker not found");
  const role_ids = all<{ role_id: number }>("SELECT role_id FROM worker_roles WHERE worker_id = ?", id).map((r) => r.role_id);
  const documents = all("SELECT * FROM worker_documents WHERE worker_id = ? ORDER BY created_at DESC", id);
  const flags = all(
    "SELECT f.client_id, f.flag, c.name client_name FROM client_worker_flags f JOIN clients c ON c.id = f.client_id WHERE f.worker_id = ? ORDER BY c.name",
    id,
  );
  const history = workerHistory(id);
  const login = get<{ email: string }>("SELECT email FROM users WHERE worker_id = ?", id);
  return { ...w, role_ids, documents, flags, history, login_email: login?.email ?? null };
});

route("PATCH", "/admin/workers/:id", async ({ req, p }) => {
  await requireAdmin(req);
  const id = intId(p.id);
  const b = await body(req, workerSchema.partial().extend({ status: z.enum(["active", "inactive"]).optional() }));
  tx(() => {
    for (const k of ["first_name", "last_name", "email", "phone", "notes", "status"] as const) {
      if (b[k] !== undefined) run(`UPDATE workers SET ${k} = ? WHERE id = ?`, b[k], id);
    }
    if (b.email !== undefined) run("UPDATE users SET email = ? WHERE worker_id = ?", b.email, id);
    if (b.first_name !== undefined || b.last_name !== undefined) {
      run("UPDATE users SET name = (SELECT first_name || ' ' || last_name FROM workers WHERE id = ?) WHERE worker_id = ?", id, id);
    }
    if (b.role_ids) {
      run("DELETE FROM worker_roles WHERE worker_id = ?", id);
      for (const rid of new Set(b.role_ids)) run("INSERT INTO worker_roles (worker_id, role_id) VALUES (?, ?)", id, rid);
    }
  });
  return { ok: true };
});

route("POST", "/admin/workers/:id/reset-password", async ({ req, p }) => {
  await requireAdmin(req);
  const id = intId(p.id);
  const password = tempPassword();
  const r = run("UPDATE users SET password_hash = ? WHERE worker_id = ?", hashPassword(password), id);
  if (!r.changes) throw notFound("Worker login not found");
  return { temp_password: password };
});

function workerHistory(workerId: number) {
  return all<{
    call_id: number; job_id: number; job: string; call: string; call_date: string; start_time: string; role: string;
    status: string; call_status: string; clock_in: string | null; clock_out: string | null; no_show: number | null; pay_rate: number | null;
  }>(
    `SELECT a.call_id, j.id job_id, j.name job, c.name call, c.call_date, c.start_time, r.name role, a.status, c.status call_status,
            e.clock_in, e.clock_out, e.no_show, jr.pay_rate
       FROM assignments a
       JOIN calls c ON c.id = a.call_id JOIN jobs j ON j.id = c.job_id
       JOIN positions p ON p.id = a.position_id JOIN roles r ON r.id = p.role_id
       LEFT JOIN job_rates jr ON jr.job_id = j.id AND jr.role_id = p.role_id
       LEFT JOIN time_entries e ON e.call_id = a.call_id AND e.worker_id = a.worker_id
      WHERE a.worker_id = ?
      ORDER BY c.call_date DESC, c.start_time DESC LIMIT 200`,
    workerId,
  ).map((h) => {
    const hours = entryHours({ clock_in: h.clock_in, clock_out: h.clock_out, no_show: h.no_show ?? 0 });
    return { ...h, hours, pay: round2(hours * (h.pay_rate ?? 0)) };
  });
}

// ---------------------------------------------------------------- documents

async function saveUpload(req: Request, workerId: number, user: User) {
  const form = await req.formData().catch(() => null);
  if (!form) throw bad("Upload must be multipart/form-data");
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw bad("Choose a file to upload");
  if (file.size > 15 * 1024 * 1024) throw bad("File is larger than 15 MB");
  const kind = String(form.get("kind") || "document");
  if (!["certification", "document"].includes(kind)) throw bad("kind must be certification or document");
  const title = String(form.get("title") || "").trim() || file.name;
  const expires = String(form.get("expires_on") || "").trim() || null;
  if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) throw bad("Expiry date must be YYYY-MM-DD");
  const ext = path.extname(file.name).slice(0, 10).replace(/[^.\w]/g, "");
  const stored = `${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), Buffer.from(await file.arrayBuffer()));
  const r = run(
    `INSERT INTO worker_documents (worker_id, kind, title, file_name, stored_name, mime, size, expires_on, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    workerId, kind, title.slice(0, 200), file.name.slice(0, 200), stored, file.type || "application/octet-stream", file.size, expires, user.id,
  );
  return { id: Number(r.lastInsertRowid) };
}

route("POST", "/admin/workers/:id/documents", async ({ req, p }) => {
  const u = await requireAdmin(req);
  const id = intId(p.id);
  if (!get("SELECT 1 FROM workers WHERE id = ?", id)) throw notFound("Worker not found");
  return saveUpload(req, id, u);
});

route("PATCH", "/admin/documents/:id", async ({ req, p }) => {
  await requireAdmin(req);
  const b = await body(req, z.object({ title: zReq().optional(), expires_on: zDate.nullable().optional(), kind: z.enum(["certification", "document"]).optional() }));
  const id = intId(p.id);
  if (b.title !== undefined) run("UPDATE worker_documents SET title = ? WHERE id = ?", b.title, id);
  if (b.expires_on !== undefined) run("UPDATE worker_documents SET expires_on = ? WHERE id = ?", b.expires_on, id);
  if (b.kind !== undefined) run("UPDATE worker_documents SET kind = ? WHERE id = ?", b.kind, id);
  return { ok: true };
});

route("DELETE", "/admin/documents/:id", async ({ req, p }) => {
  await requireAdmin(req);
  const d = get<{ stored_name: string }>("SELECT stored_name FROM worker_documents WHERE id = ?", intId(p.id));
  if (!d) throw notFound();
  run("DELETE FROM worker_documents WHERE id = ?", intId(p.id));
  fs.rmSync(path.join(UPLOAD_DIR, d.stored_name), { force: true });
  return { ok: true };
});

route("GET", "/documents/:id/file", async ({ req, p }) => {
  const u = await requireUser(req);
  const d = get<{ worker_id: number; stored_name: string; mime: string; file_name: string }>(
    "SELECT worker_id, stored_name, mime, file_name FROM worker_documents WHERE id = ?",
    intId(p.id),
  );
  if (!d) throw notFound();
  if (!u.is_admin && u.worker_id !== d.worker_id) throw forbidden();
  const buf = fs.readFileSync(path.join(UPLOAD_DIR, d.stored_name));
  return new Response(buf, {
    headers: {
      "content-type": d.mime,
      "content-disposition": `inline; filename="${d.file_name.replace(/"/g, "")}"`,
      "cache-control": "private, no-store",
    },
  });
});

route("GET", "/me/documents", async ({ req }) => {
  const u = await requireWorker(req);
  return all("SELECT id, kind, title, file_name, expires_on, created_at FROM worker_documents WHERE worker_id = ? ORDER BY created_at DESC", u.worker_id);
});

route("POST", "/me/documents", async ({ req }) => {
  const u = await requireWorker(req);
  return saveUpload(req, u.worker_id, u);
});

// ---------------------------------------------------------------- clients, contacts, venues

const clientSchema = z.object({
  name: zReq(120),
  phone: zStr(40).default(""),
  email: zStr(120).default(""),
  billing_address: zStr(500).default(""),
  payment_terms: z.enum(["Due on receipt", "Net 10", "Net 15", "Net 30", "Net 45", "Net 60"]).default("Net 30"),
  notes: zStr(2000).default(""),
});

route("GET", "/admin/clients", async ({ req }) => {
  await requireAdmin(req);
  return all(
    `SELECT c.*,
            (SELECT COUNT(*) FROM jobs j WHERE j.client_id = c.id) job_count,
            (SELECT COUNT(*) FROM client_contacts cc WHERE cc.client_id = c.id) contact_count,
            (SELECT COUNT(*) FROM venues v WHERE v.client_id = c.id) venue_count
       FROM clients c ORDER BY c.status, c.name`,
  );
});

route("POST", "/admin/clients", async ({ req }) => {
  await requireAdmin(req);
  const b = await body(req, clientSchema);
  const r = run(
    "INSERT INTO clients (name, phone, email, billing_address, payment_terms, notes) VALUES (?, ?, ?, ?, ?, ?)",
    b.name, b.phone, b.email, b.billing_address, b.payment_terms, b.notes,
  );
  return { id: Number(r.lastInsertRowid) };
});

route("GET", "/admin/clients/:id", async ({ req, p }) => {
  await requireAdmin(req);
  const id = intId(p.id);
  const c = get("SELECT * FROM clients WHERE id = ?", id);
  if (!c) throw notFound("Client not found");
  return {
    ...c,
    contacts: all("SELECT * FROM client_contacts WHERE client_id = ? ORDER BY is_billing DESC, name", id),
    venues: all("SELECT * FROM venues WHERE client_id = ? ORDER BY name", id),
    flags: all(
      `SELECT f.worker_id, f.flag, w.first_name, w.last_name FROM client_worker_flags f JOIN workers w ON w.id = f.worker_id
        WHERE f.client_id = ? ORDER BY f.flag DESC, w.last_name`,
      id,
    ),
    jobs: all(
      `SELECT j.id, j.name, j.status, MIN(c.call_date) first_date, MAX(c.call_date) last_date
         FROM jobs j LEFT JOIN calls c ON c.job_id = j.id WHERE j.client_id = ? GROUP BY j.id ORDER BY first_date DESC`,
      id,
    ),
  };
});

route("PATCH", "/admin/clients/:id", async ({ req, p }) => {
  await requireAdmin(req);
  const id = intId(p.id);
  const b = await body(req, clientSchema.partial().extend({ status: z.enum(["active", "inactive"]).optional() }));
  for (const [k, v] of Object.entries(b)) {
    if (v !== undefined) run(`UPDATE clients SET ${k} = ? WHERE id = ?`, v, id);
  }
  return { ok: true };
});

const contactSchema = z.object({
  name: zReq(120),
  title: zStr(120).default(""),
  email: zStr(120).default(""),
  phone: zStr(40).default(""),
  is_billing: z.boolean().default(false),
});

route("POST", "/admin/clients/:id/contacts", async ({ req, p }) => {
  await requireAdmin(req);
  const b = await body(req, contactSchema);
  const r = run(
    "INSERT INTO client_contacts (client_id, name, title, email, phone, is_billing) VALUES (?, ?, ?, ?, ?, ?)",
    intId(p.id), b.name, b.title, b.email, b.phone, b.is_billing ? 1 : 0,
  );
  return { id: Number(r.lastInsertRowid) };
});

route("PATCH", "/admin/contacts/:id", async ({ req, p }) => {
  await requireAdmin(req);
  const b = await body(req, contactSchema.partial());
  for (const [k, v] of Object.entries(b)) {
    if (v !== undefined) run(`UPDATE client_contacts SET ${k} = ? WHERE id = ?`, typeof v === "boolean" ? (v ? 1 : 0) : v, intId(p.id));
  }
  return { ok: true };
});

route("DELETE", "/admin/contacts/:id", async ({ req, p }) => {
  await requireAdmin(req);
  run("DELETE FROM client_contacts WHERE id = ?", intId(p.id));
  return { ok: true };
});

const venueSchema = z.object({ name: zReq(120), address: zStr(300).default(""), notes: zStr(1000).default(""), client_id: zId.nullable().optional() });

route("GET", "/admin/venues", async ({ req }) => {
  await requireAdmin(req);
  return all("SELECT v.*, c.name client_name FROM venues v LEFT JOIN clients c ON c.id = v.client_id ORDER BY v.name");
});

route("POST", "/admin/venues", async ({ req }) => {
  await requireAdmin(req);
  const b = await body(req, venueSchema);
  const r = run("INSERT INTO venues (client_id, name, address, notes) VALUES (?, ?, ?, ?)", b.client_id ?? null, b.name, b.address, b.notes);
  return { id: Number(r.lastInsertRowid) };
});

route("PATCH", "/admin/venues/:id", async ({ req, p }) => {
  await requireAdmin(req);
  const b = await body(req, venueSchema.partial());
  for (const [k, v] of Object.entries(b)) {
    if (v !== undefined) run(`UPDATE venues SET ${k} = ? WHERE id = ?`, v, intId(p.id));
  }
  return { ok: true };
});

route("DELETE", "/admin/venues/:id", async ({ req, p }) => {
  await requireAdmin(req);
  run("DELETE FROM venues WHERE id = ?", intId(p.id));
  return { ok: true };
});

route("PUT", "/admin/clients/:id/flags/:workerId", async ({ req, p }) => {
  await requireAdmin(req);
  const b = await body(req, z.object({ flag: z.enum(["preferred", "banned", "none"]) }));
  const cid = intId(p.id), wid = intId(p.workerId);
  if (b.flag === "none") run("DELETE FROM client_worker_flags WHERE client_id = ? AND worker_id = ?", cid, wid);
  else
    run(
      `INSERT INTO client_worker_flags (client_id, worker_id, flag) VALUES (?, ?, ?)
       ON CONFLICT (client_id, worker_id) DO UPDATE SET flag = excluded.flag`,
      cid, wid, b.flag,
    );
  return { ok: true };
});

// ---------------------------------------------------------------- system info (settings page)

route("GET", "/admin/system", async ({ req }) => {
  await requireAdmin(req);
  const host = req.headers.get("host") ?? "";
  const port = host.split(":")[1] || "3000";
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => `http://${i!.address}:${port}`);
  return { push: pushStatus(), server_urls: lan };
});

// ---------------------------------------------------------------- admin users

route("GET", "/admin/admins", async ({ req }) => {
  await requireAdmin(req);
  return all("SELECT id, email, name, created_at FROM users WHERE is_admin = 1 ORDER BY name");
});

route("POST", "/admin/admins", async ({ req }) => {
  await requireAdmin(req);
  const b = await body(req, z.object({ name: zReq(), email: z.string().trim().email() }));
  const password = tempPassword();
  run("INSERT INTO users (email, password_hash, name, is_admin) VALUES (?, ?, ?, 1)", b.email, hashPassword(password), b.name);
  return { temp_password: password };
});

route("DELETE", "/admin/admins/:id", async ({ req, p }) => {
  const u = await requireAdmin(req);
  const id = intId(p.id);
  if (id === u.id) throw bad("You can't remove your own login");
  run("DELETE FROM users WHERE id = ? AND is_admin = 1 AND worker_id IS NULL", id);
  return { ok: true };
});
