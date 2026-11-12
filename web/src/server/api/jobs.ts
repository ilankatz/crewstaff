import { z } from "zod";
import { route } from "../router";
import { all, get, run, tx, nowIso } from "../db";
import { bad, body, conflict, intId, notFound, zDate, zId, zReq, zStr, zTime } from "../http";
import { requireAdmin, requireUser } from "../auth";
import {
  approveCall, assertCanRun, audit, callLabel, clockIn, clockOut, editEntry, endCall, getCall, positionCounts,
  promoteStandby, qualifiedWorkers, reopenCall, roster, round2, sendOffers, signOff, startCall, stewardWorkerIds,
} from "../core";
import { notifyWorkers } from "../push";

const positionInput = z.object({ role_id: zId, quantity: z.number().int().min(1).max(500) });
const callInput = z.object({
  name: zReq(80),
  call_date: zDate,
  start_time: zTime,
  end_time: zTime.nullable().optional(),
  notes: zStr(2000).default(""),
  positions: z.array(positionInput).default([]),
});
const rateInput = z.object({ role_id: zId, pay_rate: z.number().min(0).max(10000) });

function ensureRates(jobId: number, roleIds: number[]) {
  const have = new Set(all<{ role_id: number }>("SELECT role_id FROM job_rates WHERE job_id = ?", jobId).map((r) => r.role_id));
  const missing = roleIds.filter((r) => !have.has(r));
  if (missing.length) {
    const names = all<{ name: string }>(`SELECT name FROM roles WHERE id IN (${missing.map(() => "?").join(",")})`, ...missing).map((r) => r.name);
    throw bad(`Set a pay rate for ${names.join(", ")} on this job first`);
  }
}

function insertCall(jobId: number, c: z.infer<typeof callInput>) {
  const r = run(
    "INSERT INTO calls (job_id, name, call_date, start_time, end_time, notes) VALUES (?, ?, ?, ?, ?, ?)",
    jobId, c.name, c.call_date, c.start_time, c.end_time ?? null, c.notes,
  );
  const callId = Number(r.lastInsertRowid);
  const merged = new Map<number, number>();
  for (const p of c.positions) merged.set(p.role_id, (merged.get(p.role_id) ?? 0) + p.quantity);
  ensureRates(jobId, [...merged.keys()]);
  for (const [role, qty] of merged) run("INSERT INTO positions (call_id, role_id, quantity) VALUES (?, ?, ?)", callId, role, qty);
  return callId;
}

// ---------------------------------------------------------------- jobs

route("GET", "/admin/jobs", async ({ req, q }) => {
  await requireAdmin(req);
  const status = q.get("status") || "active";
  return all(
    `SELECT j.id, j.name, j.status, j.created_at, c.name client_name, v.name venue_name,
            MIN(cl.call_date) first_date, MAX(cl.call_date) last_date,
            COUNT(DISTINCT cl.id) call_count,
            (SELECT COALESCE(SUM(p.quantity),0) FROM positions p JOIN calls c2 ON c2.id = p.call_id WHERE c2.job_id = j.id AND c2.status != 'cancelled') needed,
            (SELECT COUNT(*) FROM assignments a JOIN calls c2 ON c2.id = a.call_id WHERE c2.job_id = j.id AND a.status = 'accepted' AND c2.status != 'cancelled') filled,
            SUM(cl.status = 'signed_off') awaiting_approval,
            SUM(cl.status = 'in_progress') live_calls,
            i.status invoice_status, i.id invoice_id
       FROM jobs j
       JOIN clients c ON c.id = j.client_id
       LEFT JOIN venues v ON v.id = j.venue_id
       LEFT JOIN calls cl ON cl.job_id = j.id
       LEFT JOIN invoices i ON i.job_id = j.id
      WHERE (? = 'all' OR j.status = ?)
      GROUP BY j.id
      ORDER BY first_date IS NULL, first_date ${status === "active" ? "ASC" : "DESC"}`,
    status,
    status,
  );
});

route("POST", "/admin/jobs", async ({ req }) => {
  const u = await requireAdmin(req);
  const b = await body(
    req,
    z.object({
      name: zReq(120),
      client_id: zId,
      venue_id: zId.nullable().optional(),
      new_venue: z.object({ name: zReq(120), address: zStr(300).default("") }).optional(),
      contact_id: zId.nullable().optional(),
      notes: zStr(4000).default(""),
      rates: z.array(rateInput).min(1, "add at least one role with a pay rate"),
      calls: z.array(callInput).min(1, "add at least one call"),
    }),
  );
  const id = tx(() => {
    let venueId = b.venue_id ?? null;
    if (b.new_venue) {
      venueId = Number(run("INSERT INTO venues (client_id, name, address) VALUES (?, ?, ?)", b.client_id, b.new_venue.name, b.new_venue.address).lastInsertRowid);
    }
    const jobId = Number(
      run("INSERT INTO jobs (name, client_id, venue_id, contact_id, notes) VALUES (?, ?, ?, ?, ?)", b.name, b.client_id, venueId, b.contact_id ?? null, b.notes)
        .lastInsertRowid,
    );
    for (const r of b.rates) run("INSERT OR REPLACE INTO job_rates (job_id, role_id, pay_rate) VALUES (?, ?, ?)", jobId, r.role_id, r.pay_rate);
    for (const c of b.calls) insertCall(jobId, c);
    return jobId;
  });
  audit(null, null, u.id, "job_created", `${id}`);
  return { id };
});

route("GET", "/admin/jobs/:id", async ({ req, p }) => {
  await requireAdmin(req);
  const id = intId(p.id);
  const job = get<Record<string, unknown> & { client_id: number }>(
    `SELECT j.*, c.name client_name, c.payment_terms client_terms, v.name venue_name, v.address venue_address,
            cc.name contact_name, cc.email contact_email, cc.phone contact_phone
       FROM jobs j JOIN clients c ON c.id = j.client_id
       LEFT JOIN venues v ON v.id = j.venue_id LEFT JOIN client_contacts cc ON cc.id = j.contact_id
      WHERE j.id = ?`,
    id,
  );
  if (!job) throw notFound("Job not found");
  const rates = all("SELECT jr.role_id, jr.pay_rate, r.name role FROM job_rates jr JOIN roles r ON r.id = jr.role_id WHERE jr.job_id = ? ORDER BY r.is_steward DESC, r.name", id);
  const calls = all<Record<string, unknown> & { id: number }>("SELECT * FROM calls WHERE job_id = ? ORDER BY call_date, start_time", id).map((c) => ({
    ...c,
    positions: callPositions(c.id),
  }));
  const invoice = get("SELECT id, number, status, total FROM invoices WHERE job_id = ?", id) ?? null;
  return { ...job, rates, calls, invoice };
});

route("PATCH", "/admin/jobs/:id", async ({ req, p }) => {
  await requireAdmin(req);
  const id = intId(p.id);
  const b = await body(
    req,
    z.object({
      name: zReq(120).optional(),
      venue_id: zId.nullable().optional(),
      contact_id: zId.nullable().optional(),
      notes: zStr(4000).optional(),
      status: z.enum(["active", "completed", "cancelled"]).optional(),
    }),
  );
  for (const [k, v] of Object.entries(b)) if (v !== undefined) run(`UPDATE jobs SET ${k} = ? WHERE id = ?`, v, id);
  return { ok: true };
});

route("PUT", "/admin/jobs/:id/rates", async ({ req, p }) => {
  await requireAdmin(req);
  const id = intId(p.id);
  const b = await body(req, z.object({ rates: z.array(rateInput) }));
  const inv = get<{ status: string }>("SELECT status FROM invoices WHERE job_id = ? AND status != 'void'", id);
  if (inv && inv.status !== "draft") throw conflict("This job has been invoiced. Void the invoice to change rates.");
  tx(() => {
    const used = all<{ role_id: number }>("SELECT DISTINCT p.role_id FROM positions p JOIN calls c ON c.id = p.call_id WHERE c.job_id = ?", id).map((r) => r.role_id);
    const keep = new Set(b.rates.map((r) => r.role_id));
    const dropped = used.filter((r) => !keep.has(r));
    if (dropped.length) throw bad("A role that has positions on this job needs a pay rate");
    run("DELETE FROM job_rates WHERE job_id = ?", id);
    for (const r of b.rates) run("INSERT INTO job_rates (job_id, role_id, pay_rate) VALUES (?, ?, ?)", id, r.role_id, r.pay_rate);
  });
  return { ok: true };
});

route("DELETE", "/admin/jobs/:id", async ({ req, p }) => {
  await requireAdmin(req);
  const id = intId(p.id);
  const started = get("SELECT 1 FROM calls WHERE job_id = ? AND status NOT IN ('scheduled','cancelled')", id);
  if (started) throw conflict("This job has calls that already ran. Mark it cancelled or completed instead.");
  run("DELETE FROM jobs WHERE id = ?", id);
  return { ok: true };
});

// ---------------------------------------------------------------- calls & positions

function callPositions(callId: number) {
  return all<{ id: number; role_id: number; role: string; is_steward: number; quantity: number; pay_rate: number | null }>(
    `SELECT p.id, p.role_id, r.name role, r.is_steward, p.quantity, jr.pay_rate
       FROM positions p JOIN roles r ON r.id = p.role_id JOIN calls c ON c.id = p.call_id
       LEFT JOIN job_rates jr ON jr.job_id = c.job_id AND jr.role_id = p.role_id
      WHERE p.call_id = ? ORDER BY r.is_steward DESC, r.name`,
    callId,
  ).map((p) => {
    const counts = positionCounts(p.id);
    return { ...p, accepted: counts.accepted || 0, standby: counts.standby || 0, offered: counts.offered || 0 };
  });
}

route("POST", "/admin/jobs/:id/calls", async ({ req, p }) => {
  await requireAdmin(req);
  const jobId = intId(p.id);
  const b = await body(req, callInput);
  return { id: tx(() => insertCall(jobId, b)) };
});

route("GET", "/admin/calls/:id", async ({ req, p }) => {
  await requireAdmin(req);
  const id = intId(p.id);
  const call = getCall(id);
  const job = get<Record<string, unknown>>(
    `SELECT j.id, j.name, j.client_id, c.name client_name, v.name venue_name, v.address venue_address
       FROM jobs j JOIN clients c ON c.id = j.client_id LEFT JOIN venues v ON v.id = j.venue_id WHERE j.id = ?`,
    call.job_id,
  );
  const assignments = all(
    `SELECT a.id, a.position_id, a.worker_id, a.status, a.offered_at, a.responded_at, w.first_name, w.last_name, w.phone
       FROM assignments a JOIN workers w ON w.id = a.worker_id WHERE a.call_id = ?
      ORDER BY CASE a.status WHEN 'accepted' THEN 0 WHEN 'standby' THEN 1 WHEN 'offered' THEN 2 ELSE 3 END, a.responded_at, w.last_name`,
    id,
  );
  const log = all(
    `SELECT l.*, u.name user_name, w.first_name || ' ' || w.last_name worker_name
       FROM audit_log l LEFT JOIN users u ON u.id = l.user_id LEFT JOIN workers w ON w.id = l.worker_id
      WHERE l.call_id = ? ORDER BY l.id DESC LIMIT 300`,
    id,
  );
  const stewards = stewardWorkerIds(id);
  const people = (uid: number | null) => (uid ? get<{ name: string }>("SELECT name FROM users WHERE id = ?", uid)?.name ?? null : null);
  return {
    call: { ...call, signed_off_by_name: people(call.signed_off_by), approved_by_name: people(call.approved_by) },
    job,
    positions: callPositions(id),
    assignments,
    roster: roster(id),
    stewards,
    log,
  };
});

route("PATCH", "/admin/calls/:id", async ({ req, p }) => {
  await requireAdmin(req);
  const id = intId(p.id);
  const b = await body(req, callInput.omit({ positions: true }).partial());
  const c = getCall(id);
  if (c.status !== "scheduled" && (b.call_date || b.start_time)) throw conflict("The call has started; its date and start time are locked");
  for (const [k, v] of Object.entries(b)) if (v !== undefined) run(`UPDATE calls SET ${k} = ? WHERE id = ?`, v, id);
  if (c.status === "scheduled" && (b.call_date || b.start_time)) {
    const crew = all<{ worker_id: number }>("SELECT worker_id FROM assignments WHERE call_id = ? AND status IN ('accepted','standby','offered')", id);
    notifyWorkers(crew.map((r) => r.worker_id), "Call time changed", callLabel(id), { type: "shift", callId: id });
  }
  return { ok: true };
});

route("POST", "/admin/calls/:id/cancel", async ({ req, p }) => {
  const u = await requireAdmin(req);
  const id = intId(p.id);
  const c = getCall(id);
  if (c.status !== "scheduled") throw conflict("Only calls that haven't started can be cancelled");
  const crew = all<{ worker_id: number }>("SELECT worker_id FROM assignments WHERE call_id = ? AND status IN ('accepted','standby','offered')", id);
  const label = callLabel(id);
  run("UPDATE calls SET status = 'cancelled' WHERE id = ?", id);
  audit(id, null, u.id, "call_cancelled");
  notifyWorkers(crew.map((r) => r.worker_id), "Call cancelled", label, { type: "shift", callId: id });
  return { ok: true };
});

route("DELETE", "/admin/calls/:id", async ({ req, p }) => {
  await requireAdmin(req);
  const id = intId(p.id);
  const c = getCall(id);
  if (!["scheduled", "cancelled"].includes(c.status)) throw conflict("This call already ran and can't be deleted");
  if (get("SELECT 1 FROM assignments WHERE call_id = ? AND status IN ('accepted','standby','offered')", id))
    throw conflict("Workers are booked or offered on this call. Cancel it instead so they're notified.");
  run("DELETE FROM calls WHERE id = ?", id);
  return { ok: true };
});

route("POST", "/admin/calls/:id/positions", async ({ req, p }) => {
  await requireAdmin(req);
  const callId = intId(p.id);
  const b = await body(req, positionInput.extend({ pay_rate: z.number().min(0).optional() }));
  const c = getCall(callId);
  if (["signed_off", "approved", "cancelled"].includes(c.status)) throw conflict("This call is closed");
  tx(() => {
    if (b.pay_rate !== undefined) run("INSERT OR REPLACE INTO job_rates (job_id, role_id, pay_rate) VALUES (?, ?, ?)", c.job_id, b.role_id, b.pay_rate);
    ensureRates(c.job_id, [b.role_id]);
    run(
      `INSERT INTO positions (call_id, role_id, quantity) VALUES (?, ?, ?)
       ON CONFLICT (call_id, role_id) DO UPDATE SET quantity = positions.quantity + excluded.quantity`,
      callId, b.role_id, b.quantity,
    );
  });
  const pos = get<{ id: number }>("SELECT id FROM positions WHERE call_id = ? AND role_id = ?", callId, b.role_id)!;
  promoteStandby(pos.id);
  return { id: pos.id };
});

route("PATCH", "/admin/positions/:id", async ({ req, p }) => {
  await requireAdmin(req);
  const id = intId(p.id);
  const b = await body(req, z.object({ quantity: z.number().int().min(0).max(500) }));
  const counts = positionCounts(id);
  if (b.quantity < (counts.accepted || 0)) throw conflict(`${counts.accepted} workers are booked. Remove some before lowering the count.`);
  run("UPDATE positions SET quantity = ? WHERE id = ?", b.quantity, id);
  promoteStandby(id);
  return { ok: true };
});

route("DELETE", "/admin/positions/:id", async ({ req, p }) => {
  await requireAdmin(req);
  const id = intId(p.id);
  if (get("SELECT 1 FROM assignments WHERE position_id = ? AND status IN ('accepted','standby')", id))
    throw conflict("Workers are booked on this position. Remove them first.");
  run("DELETE FROM positions WHERE id = ?", id);
  return { ok: true };
});

route("GET", "/admin/positions/:id/candidates", async ({ req, p }) => {
  await requireAdmin(req);
  const id = intId(p.id);
  const pos = get<{ call_id: number }>("SELECT call_id FROM positions WHERE id = ?", id);
  if (!pos) throw notFound();
  const call = getCall(pos.call_id);
  // Other bookings the same day, so the admin can spot double-booking.
  const sameDay = all<{ worker_id: number; label: string }>(
    `SELECT a.worker_id, j.name || ' – ' || c.name || ' ' || c.start_time label
       FROM assignments a JOIN calls c ON c.id = a.call_id JOIN jobs j ON j.id = c.job_id
      WHERE c.call_date = ? AND c.id != ? AND a.status = 'accepted' AND c.status != 'cancelled'`,
    call.call_date,
    call.id,
  );
  const conflicts = new Map<number, string[]>();
  for (const s of sameDay) conflicts.set(s.worker_id, [...(conflicts.get(s.worker_id) ?? []), s.label]);
  return qualifiedWorkers(id).map((w) => ({ ...w, preferred: !!w.preferred, same_day: conflicts.get(w.id) ?? [] }));
});

route("POST", "/admin/positions/:id/offers", async ({ req, p }) => {
  const u = await requireAdmin(req);
  const id = intId(p.id);
  const b = await body(req, z.object({ worker_ids: z.array(zId).default([]), all: z.boolean().default(false), direct: z.boolean().default(false) }));
  let ids = b.worker_ids;
  if (b.all) {
    ids = qualifiedWorkers(id)
      .filter((w) => !w.current_status || !["offered", "accepted", "standby", "declined"].includes(w.current_status))
      .map((w) => w.id);
  }
  if (!ids.length) throw bad("No eligible workers selected");
  return sendOffers(id, ids, u.id, b.direct);
});

route("POST", "/admin/assignments/:id/remove", async ({ req, p }) => {
  const u = await requireAdmin(req);
  const a = get<{ id: number; position_id: number; call_id: number; worker_id: number; status: string }>(
    "SELECT * FROM assignments WHERE id = ?",
    intId(p.id),
  );
  if (!a) throw notFound();
  const c = getCall(a.call_id);
  if (["signed_off", "approved"].includes(c.status)) throw conflict("This call is closed");
  if (get("SELECT 1 FROM time_entries WHERE call_id = ? AND worker_id = ? AND clock_in IS NOT NULL", a.call_id, a.worker_id))
    throw conflict("This worker has clocked time on this call. Edit or no-show their time instead.");
  const label = callLabel(a.call_id);
  tx(() => {
    run("UPDATE assignments SET status = 'removed', responded_at = ? WHERE id = ?", nowIso(), a.id);
    run("DELETE FROM time_entries WHERE call_id = ? AND worker_id = ?", a.call_id, a.worker_id);
    audit(a.call_id, a.worker_id, u.id, a.status === "offered" ? "offer_withdrawn" : "removed");
    if (a.status === "accepted") promoteStandby(a.position_id);
  });
  if (a.status === "accepted" || a.status === "standby") {
    notifyWorkers([a.worker_id], "Removed from call", `You're no longer booked on ${label}`, { type: "shift", callId: a.call_id });
  }
  return { ok: true };
});

// ---------------------------------------------------------------- running a call (Steward or admin)

const atSchema = z.object({ at: z.string().datetime({ offset: true }).optional() });

route("GET", "/calls/:id/roster", async ({ req, p }) => {
  const u = await requireUser(req);
  const id = intId(p.id);
  assertCanRun(u, id);
  return { call: getCall(id), roster: roster(id) };
});

route("POST", "/calls/:id/start", async ({ req, p }) => startCall(intId(p.id), await requireUser(req)));

route("POST", "/calls/:id/end", async ({ req, p }) => {
  const u = await requireUser(req);
  const b = await body(req, z.object({ clock_out_remaining: z.boolean().default(false) }));
  return endCall(intId(p.id), u, b.clock_out_remaining);
});

route("POST", "/calls/:id/sign-off", async ({ req, p }) => signOff(intId(p.id), await requireUser(req)));

route("POST", "/calls/:id/workers/:wid/clock-in", async ({ req, p }) => {
  const u = await requireUser(req);
  const id = intId(p.id);
  assertCanRun(u, id);
  const b = await body(req, atSchema);
  return clockIn(id, intId(p.wid), u, b.at);
});

route("POST", "/calls/:id/workers/:wid/clock-out", async ({ req, p }) => {
  const u = await requireUser(req);
  const id = intId(p.id);
  assertCanRun(u, id);
  const b = await body(req, atSchema);
  return clockOut(id, intId(p.wid), u, b.at);
});

route("PATCH", "/calls/:id/workers/:wid", async ({ req, p }) => {
  const u = await requireUser(req);
  const id = intId(p.id);
  assertCanRun(u, id);
  const iso = z.string().datetime({ offset: true });
  const b = await body(req, z.object({ clock_in: iso.nullable().optional(), clock_out: iso.nullable().optional(), no_show: z.boolean().optional() }));
  return editEntry(id, intId(p.wid), u, b);
});

route("POST", "/admin/calls/:id/approve", async ({ req, p }) => approveCall(intId(p.id), await requireAdmin(req)));
route("POST", "/admin/calls/:id/reopen", async ({ req, p }) => reopenCall(intId(p.id), await requireAdmin(req)));

// ---------------------------------------------------------------- dashboard

route("GET", "/admin/dashboard", async ({ req }) => {
  await requireAdmin(req);
  const callCols = `c.id, c.name, c.call_date, c.start_time, c.end_time, c.status, j.id job_id, j.name job_name, cl.name client_name, v.name venue_name,
       (SELECT COALESCE(SUM(quantity),0) FROM positions WHERE call_id = c.id) needed,
       (SELECT COUNT(*) FROM assignments WHERE call_id = c.id AND status = 'accepted') filled,
       (SELECT COUNT(*) FROM assignments WHERE call_id = c.id AND status = 'offered') pending_offers`;
  const from = `FROM calls c JOIN jobs j ON j.id = c.job_id JOIN clients cl ON cl.id = j.client_id LEFT JOIN venues v ON v.id = j.venue_id`;
  const live = all(`SELECT ${callCols},
       (SELECT COUNT(*) FROM time_entries e WHERE e.call_id = c.id AND e.clock_in IS NOT NULL AND e.clock_out IS NULL AND e.no_show = 0) on_clock
       ${from} WHERE c.status IN ('in_progress','ended') ORDER BY c.call_date, c.start_time`);
  const upcoming = all(
    `SELECT ${callCols} ${from} WHERE c.status = 'scheduled' AND c.call_date >= date('now','localtime','-1 day')
      AND c.call_date <= date('now','localtime','+14 days') ORDER BY c.call_date, c.start_time LIMIT 50`,
  );
  const awaiting = all(`SELECT ${callCols} ${from} WHERE c.status = 'signed_off' ORDER BY c.call_date, c.start_time`);
  const docs = all(
    `SELECT d.id, d.title, d.expires_on, w.id worker_id, w.first_name, w.last_name FROM worker_documents d
       JOIN workers w ON w.id = d.worker_id AND w.status = 'active'
      WHERE d.expires_on IS NOT NULL AND d.expires_on <= date('now','localtime','+30 days') ORDER BY d.expires_on LIMIT 30`,
  );
  const readyToBill = all(
    `SELECT j.id, j.name, cl.name client_name FROM jobs j JOIN clients cl ON cl.id = j.client_id
      WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.job_id = j.id)
        AND EXISTS (SELECT 1 FROM calls c WHERE c.job_id = j.id AND c.status = 'approved')
        AND NOT EXISTS (SELECT 1 FROM calls c WHERE c.job_id = j.id AND c.status NOT IN ('approved','cancelled'))`,
  );
  const counts = get<Record<string, number>>(
    `SELECT (SELECT COUNT(*) FROM workers WHERE status = 'active') workers,
            (SELECT COUNT(*) FROM jobs WHERE status = 'active') jobs,
            (SELECT COUNT(*) FROM invoices WHERE status = 'sent') unpaid_invoices,
            (SELECT COALESCE(SUM(total),0) FROM invoices WHERE status = 'sent') unpaid_total`,
  );
  return { live, upcoming, awaiting, docs, readyToBill, counts: { ...counts, unpaid_total: round2(counts?.unpaid_total ?? 0) } };
});
