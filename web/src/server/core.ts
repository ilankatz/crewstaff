import { all, get, run, nowIso } from "./db";
import { bad, conflict, forbidden, notFound } from "./http";
import type { User } from "./auth";
import { notifyWorkers } from "./push";

export type Call = {
  id: number;
  job_id: number;
  name: string;
  call_date: string;
  start_time: string;
  end_time: string | null;
  notes: string;
  status: "scheduled" | "in_progress" | "ended" | "signed_off" | "approved" | "cancelled";
  started_at: string | null;
  ended_at: string | null;
  signed_off_at: string | null;
  signed_off_by: number | null;
  approved_at: string | null;
  approved_by: number | null;
};

export type Entry = {
  id: number;
  call_id: number;
  worker_id: number;
  clock_in: string | null;
  clock_out: string | null;
  no_show: number;
  edited: number;
};

export function getCall(id: number): Call {
  const c = get<Call>("SELECT * FROM calls WHERE id = ?", id);
  if (!c) throw notFound("Call not found");
  return c;
}

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Worked hours for an entry (exact minutes; overtime rules come later). */
export function entryHours(e: Pick<Entry, "clock_in" | "clock_out" | "no_show"> | null | undefined): number {
  if (!e || e.no_show || !e.clock_in || !e.clock_out) return 0;
  const ms = new Date(e.clock_out).getTime() - new Date(e.clock_in).getTime();
  return ms > 0 ? round2(ms / 3_600_000) : 0;
}

/** Scheduled start as a Date in the server's local time zone. */
export function scheduledStart(c: Pick<Call, "call_date" | "start_time">) {
  return new Date(`${c.call_date}T${c.start_time}:00`);
}

export function isLate(c: Pick<Call, "call_date" | "start_time">, clockIn: string | null) {
  return !!clockIn && new Date(clockIn).getTime() > scheduledStart(c).getTime() + 60_000;
}

/** Worker ids holding an accepted Steward position on this call. */
export function stewardWorkerIds(callId: number): number[] {
  return all<{ worker_id: number }>(
    `SELECT a.worker_id FROM assignments a
       JOIN positions p ON p.id = a.position_id
       JOIN roles r ON r.id = p.role_id
      WHERE a.call_id = ? AND a.status = 'accepted' AND r.is_steward = 1`,
    callId,
  ).map((r) => r.worker_id);
}

export function isStewardOf(user: User, callId: number) {
  return !!user.worker_id && stewardWorkerIds(callId).includes(user.worker_id);
}

/** Admins and the call's Steward(s) can run a call. */
export function assertCanRun(user: User, callId: number) {
  if (user.is_admin) return;
  if (!isStewardOf(user, callId)) throw forbidden("Only the Steward for this call can do that");
}

export function isOnCall(workerId: number, callId: number) {
  return !!get("SELECT 1 FROM assignments WHERE call_id = ? AND worker_id = ? AND status = 'accepted'", callId, workerId);
}

export function audit(callId: number | null, workerId: number | null, userId: number | null, action: string, details = "") {
  run("INSERT INTO audit_log (call_id, worker_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)", callId, workerId, userId, action, details);
}

export function callLabel(callId: number) {
  const r = get<{ job: string; call: string; call_date: string; start_time: string }>(
    `SELECT j.name job, c.name call, c.call_date, c.start_time FROM calls c JOIN jobs j ON j.id = c.job_id WHERE c.id = ?`,
    callId,
  );
  if (!r) return "";
  return `${r.job} – ${r.call}, ${fmtDate(r.call_date)} ${fmtTime(r.start_time)}`;
}

export function fmtDate(d: string) {
  const dt = new Date(`${d}T12:00:00`);
  return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
export function fmtTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${ap}`;
}

// ---------------------------------------------------------------- staffing

export function positionCounts(positionId: number) {
  return get<{ accepted: number; standby: number; offered: number }>(
    `SELECT
       SUM(status = 'accepted') accepted,
       SUM(status = 'standby')  standby,
       SUM(status = 'offered')  offered
     FROM assignments WHERE position_id = ?`,
    positionId,
  ) ?? { accepted: 0, standby: 0, offered: 0 };
}

/** Fill open spots from the standby list, earliest acceptance first. */
export function promoteStandby(positionId: number) {
  const pos = get<{ quantity: number; call_id: number }>("SELECT quantity, call_id FROM positions WHERE id = ?", positionId);
  if (!pos) return;
  let open = pos.quantity - (positionCounts(positionId).accepted || 0);
  if (open <= 0) return;
  const standby = all<{ id: number; worker_id: number }>(
    "SELECT id, worker_id FROM assignments WHERE position_id = ? AND status = 'standby' ORDER BY responded_at, id",
    positionId,
  );
  for (const s of standby) {
    if (open-- <= 0) break;
    run("UPDATE assignments SET status = 'accepted', responded_at = ? WHERE id = ?", nowIso(), s.id);
    audit(pos.call_id, s.worker_id, null, "promoted_from_standby");
    notifyWorkers([s.worker_id], "You're on the crew", `A spot opened up: ${callLabel(pos.call_id)}`, {
      type: "shift",
      callId: pos.call_id,
    });
  }
}

/** Workers eligible for a position: active, has the role, not banned by the client, not already on the call. */
export function qualifiedWorkers(positionId: number) {
  return all<{ id: number; first_name: string; last_name: string; phone: string; email: string; preferred: number; current_status: string | null }>(
    `SELECT w.id, w.first_name, w.last_name, w.phone, w.email,
            (f.flag = 'preferred') preferred,
            a.status current_status
       FROM positions p
       JOIN calls c ON c.id = p.call_id
       JOIN jobs j ON j.id = c.job_id
       JOIN worker_roles wr ON wr.role_id = p.role_id
       JOIN workers w ON w.id = wr.worker_id AND w.status = 'active'
       LEFT JOIN client_worker_flags f ON f.client_id = j.client_id AND f.worker_id = w.id
       LEFT JOIN assignments a ON a.call_id = c.id AND a.worker_id = w.id
      WHERE p.id = ? AND (f.flag IS NULL OR f.flag != 'banned')
      ORDER BY preferred DESC, w.last_name, w.first_name`,
    positionId,
  );
}

export function sendOffers(positionId: number, workerIds: number[], userId: number, direct = false) {
  const pos = get<{ id: number; call_id: number; quantity: number; role: string; status: string; pay_rate: number | null }>(
    `SELECT p.id, p.call_id, p.quantity, r.name role, c.status, jr.pay_rate
       FROM positions p JOIN roles r ON r.id = p.role_id JOIN calls c ON c.id = p.call_id
       LEFT JOIN job_rates jr ON jr.job_id = c.job_id AND jr.role_id = p.role_id
      WHERE p.id = ?`,
    positionId,
  );
  if (!pos) throw notFound("Position not found");
  if (["signed_off", "approved", "cancelled"].includes(pos.status)) throw conflict("This call is closed");
  const eligible = new Map(qualifiedWorkers(positionId).map((w) => [w.id, w]));
  const sent: number[] = [];
  const skipped: { worker_id: number; reason: string }[] = [];
  let openSpots = pos.quantity - (positionCounts(positionId).accepted || 0);
  for (const wid of workerIds) {
    const w = eligible.get(wid);
    if (!w) {
      skipped.push({ worker_id: wid, reason: "Not qualified, inactive, or banned by this client" });
      continue;
    }
    if (w.current_status && ["offered", "accepted", "standby"].includes(w.current_status)) {
      skipped.push({ worker_id: wid, reason: `Already ${w.current_status} on this call` });
      continue;
    }
    let status = "offered";
    if (direct) {
      if (openSpots <= 0) {
        skipped.push({ worker_id: wid, reason: "Position is full" });
        continue;
      }
      status = "accepted";
      openSpots--;
    }
    run(
      `INSERT INTO assignments (position_id, call_id, worker_id, status, offered_at, responded_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (call_id, worker_id) DO UPDATE SET
         position_id = excluded.position_id, status = excluded.status,
         offered_at = excluded.offered_at, responded_at = excluded.responded_at`,
      positionId, pos.call_id, wid, status, nowIso(), direct ? nowIso() : null,
    );
    audit(pos.call_id, wid, userId, direct ? "assigned" : "offered", pos.role);
    sent.push(wid);
  }
  if (sent.length) {
    const label = callLabel(pos.call_id);
    if (direct) {
      notifyWorkers(sent, "You've been booked", `${pos.role}: ${label}`, { type: "shift", callId: pos.call_id });
    } else {
      const rate = pos.pay_rate != null ? ` · $${pos.pay_rate.toFixed(2)}/hr` : "";
      notifyWorkers(sent, "New job offer", `${pos.role}: ${label}${rate}. First come, first served.`, {
        type: "offer",
        callId: pos.call_id,
      });
    }
  }
  return { sent: sent.length, skipped };
}

export function respondToOffer(workerId: number, assignmentId: number, action: "accept" | "decline" | "cancel") {
  const a = get<{ id: number; position_id: number; call_id: number; status: string; call_status: string }>(
    `SELECT a.id, a.position_id, a.call_id, a.status, c.status call_status
       FROM assignments a JOIN calls c ON c.id = a.call_id WHERE a.id = ? AND a.worker_id = ?`,
    assignmentId,
    workerId,
  );
  if (!a) throw notFound("Offer not found");
  if (["signed_off", "approved", "cancelled", "ended"].includes(a.call_status)) throw conflict("This call is closed");

  if (action === "accept") {
    if (a.status !== "offered") throw conflict(`This offer is ${a.status}`);
    const pos = get<{ quantity: number }>("SELECT quantity FROM positions WHERE id = ?", a.position_id)!;
    const accepted = positionCounts(a.position_id).accepted || 0;
    const status = accepted < pos.quantity ? "accepted" : "standby";
    run("UPDATE assignments SET status = ?, responded_at = ? WHERE id = ?", status, nowIso(), a.id);
    audit(a.call_id, workerId, null, status === "accepted" ? "accepted" : "standby");
    return { status };
  }
  if (action === "decline") {
    if (!["offered", "standby"].includes(a.status)) throw conflict(`This offer is ${a.status}`);
    run("UPDATE assignments SET status = 'declined', responded_at = ? WHERE id = ?", nowIso(), a.id);
    audit(a.call_id, workerId, null, "declined");
    return { status: "declined" };
  }
  // cancel an accepted shift
  if (a.status !== "accepted") throw conflict("You are not booked on this call");
  if (a.call_status !== "scheduled") throw conflict("This call has already started. Message the Steward instead.");
  run("UPDATE assignments SET status = 'cancelled', responded_at = ? WHERE id = ?", nowIso(), a.id);
  audit(a.call_id, workerId, null, "cancelled_by_worker");
  promoteStandby(a.position_id);
  return { status: "cancelled" };
}

// ---------------------------------------------------------------- time & attendance

function entryFor(callId: number, workerId: number): Entry | undefined {
  return get<Entry>("SELECT * FROM time_entries WHERE call_id = ? AND worker_id = ?", callId, workerId);
}

function ensureEntry(callId: number, workerId: number): Entry {
  run("INSERT OR IGNORE INTO time_entries (call_id, worker_id) VALUES (?, ?)", callId, workerId);
  return entryFor(callId, workerId)!;
}

export function clockIn(callId: number, workerId: number, user: User, at?: string) {
  const c = getCall(callId);
  if (c.status !== "in_progress") throw conflict(c.status === "scheduled" ? "The Steward hasn't started this call yet" : "This call is no longer open for clock-in");
  if (!isOnCall(workerId, callId)) throw forbidden("Worker is not booked on this call");
  const e = ensureEntry(callId, workerId);
  if (e.clock_in && !e.no_show) throw conflict("Already clocked in");
  const t = at || nowIso();
  run("UPDATE time_entries SET clock_in = ?, clock_in_by = ?, no_show = 0, clock_out = NULL WHERE id = ?", t, user.id, e.id);
  audit(callId, workerId, user.id, user.worker_id === workerId ? "clock_in" : "clock_in_on_behalf", t);
  return entryFor(callId, workerId);
}

export function clockOut(callId: number, workerId: number, user: User, at?: string) {
  const c = getCall(callId);
  if (!["in_progress"].includes(c.status)) throw conflict("This call is not in progress");
  const e = entryFor(callId, workerId);
  if (!e?.clock_in) throw conflict("Not clocked in");
  if (e.clock_out) throw conflict("Already clocked out");
  const t = at || nowIso();
  if (new Date(t) < new Date(e.clock_in)) throw bad("Clock-out can't be before clock-in");
  run("UPDATE time_entries SET clock_out = ?, clock_out_by = ? WHERE id = ?", t, user.id, e.id);
  audit(callId, workerId, user.id, user.worker_id === workerId ? "clock_out" : "clock_out_on_behalf", t);
  return entryFor(callId, workerId);
}

/** Steward/admin correction of a worker's times or no-show flag. Always logged. */
export function editEntry(
  callId: number,
  workerId: number,
  user: User,
  patch: { clock_in?: string | null; clock_out?: string | null; no_show?: boolean },
) {
  const c = getCall(callId);
  if (c.status === "approved") throw conflict("This timesheet is approved and locked. Reopen it first.");
  if (c.status === "cancelled") throw conflict("This call is cancelled");
  if (!user.is_admin && !["in_progress", "ended"].includes(c.status)) throw conflict("The timesheet is signed off; only an admin can change it now");
  if (c.status === "scheduled") throw conflict("The call hasn't started");
  if (!get("SELECT 1 FROM assignments WHERE call_id = ? AND worker_id = ? AND status = 'accepted'", callId, workerId))
    throw bad("Worker is not booked on this call");
  const e = ensureEntry(callId, workerId);
  const next = {
    clock_in: patch.clock_in !== undefined ? patch.clock_in : e.clock_in,
    clock_out: patch.clock_out !== undefined ? patch.clock_out : e.clock_out,
    no_show: patch.no_show !== undefined ? (patch.no_show ? 1 : 0) : e.no_show,
  };
  if (next.no_show) {
    next.clock_in = null;
    next.clock_out = null;
  }
  if (next.clock_out && !next.clock_in) throw bad("Clock-in is required when there is a clock-out");
  if (next.clock_in && next.clock_out && new Date(next.clock_out) <= new Date(next.clock_in)) throw bad("Clock-out must be after clock-in");
  if (c.status !== "in_progress" && next.clock_in && !next.clock_out && !next.no_show) throw bad("Clock-out is required once the call has ended");
  run("UPDATE time_entries SET clock_in = ?, clock_out = ?, no_show = ?, edited = 1 WHERE id = ?", next.clock_in, next.clock_out, next.no_show, e.id);
  const changes: string[] = [];
  if (e.clock_in !== next.clock_in) changes.push(`in: ${e.clock_in ?? "—"} → ${next.clock_in ?? "—"}`);
  if (e.clock_out !== next.clock_out) changes.push(`out: ${e.clock_out ?? "—"} → ${next.clock_out ?? "—"}`);
  if (e.no_show !== next.no_show) changes.push(next.no_show ? "marked no-show" : "no-show cleared");
  audit(callId, workerId, user.id, "time_edited", changes.join("; "));
  return entryFor(callId, workerId);
}

export function startCall(callId: number, user: User) {
  assertCanRun(user, callId);
  const c = getCall(callId);
  if (c.status !== "scheduled") throw conflict(`Call is ${c.status.replace("_", " ")}`);
  run("UPDATE calls SET status = 'in_progress', started_at = ?, started_by = ? WHERE id = ?", nowIso(), user.id, callId);
  audit(callId, null, user.id, "call_started");
  const crew = all<{ worker_id: number }>("SELECT worker_id FROM assignments WHERE call_id = ? AND status = 'accepted'", callId)
    .map((r) => r.worker_id)
    .filter((id) => id !== user.worker_id);
  notifyWorkers(crew, "Call started — clock in", callLabel(callId), { type: "shift", callId });
  return getCall(callId);
}

export function endCall(callId: number, user: User, clockOutRemaining: boolean) {
  assertCanRun(user, callId);
  const c = getCall(callId);
  if (c.status !== "in_progress") throw conflict("Call is not in progress");
  const crew = all<{ worker_id: number; name: string }>(
    `SELECT a.worker_id, w.first_name || ' ' || w.last_name name FROM assignments a JOIN workers w ON w.id = a.worker_id
      WHERE a.call_id = ? AND a.status = 'accepted'`,
    callId,
  );
  const stillIn = crew.filter((w) => {
    const e = entryFor(callId, w.worker_id);
    return e?.clock_in && !e.clock_out && !e.no_show;
  });
  if (stillIn.length && !clockOutRemaining) {
    throw conflict(`Still clocked in: ${stillIn.map((w) => w.name).join(", ")}`);
  }
  const t = nowIso();
  for (const w of stillIn) clockOut(callId, w.worker_id, user, t);
  // Anyone who never clocked in is marked no-show (the Steward can still correct it).
  for (const w of crew) {
    const e = ensureEntry(callId, w.worker_id);
    if (!e.clock_in && !e.no_show) {
      run("UPDATE time_entries SET no_show = 1 WHERE id = ?", e.id);
      audit(callId, w.worker_id, user.id, "auto_no_show", "Never clocked in");
    }
  }
  run("UPDATE calls SET status = 'ended', ended_at = ?, ended_by = ? WHERE id = ?", t, user.id, callId);
  audit(callId, null, user.id, "call_ended");
  return getCall(callId);
}

export function signOff(callId: number, user: User) {
  assertCanRun(user, callId);
  const c = getCall(callId);
  if (c.status !== "ended") throw conflict(c.status === "in_progress" ? "End the call first" : `Call is ${c.status.replace("_", " ")}`);
  run("UPDATE calls SET status = 'signed_off', signed_off_at = ?, signed_off_by = ? WHERE id = ?", nowIso(), user.id, callId);
  audit(callId, null, user.id, "signed_off");
  return getCall(callId);
}

export function approveCall(callId: number, user: User) {
  if (!user.is_admin) throw forbidden();
  const c = getCall(callId);
  if (!["signed_off", "ended"].includes(c.status)) throw conflict("The Steward must end the call before it can be approved");
  run("UPDATE calls SET status = 'approved', approved_at = ?, approved_by = ? WHERE id = ?", nowIso(), user.id, callId);
  audit(callId, null, user.id, "approved");
  return getCall(callId);
}

export function reopenCall(callId: number, user: User) {
  if (!user.is_admin) throw forbidden();
  const c = getCall(callId);
  if (!["signed_off", "approved"].includes(c.status)) throw conflict("Only signed-off or approved timesheets can be reopened");
  const inv = get<{ status: string }>("SELECT status FROM invoices WHERE job_id = ? AND status != 'void'", c.job_id);
  if (inv && inv.status !== "draft") throw conflict("This job's invoice has been sent. Move the invoice back to draft first.");
  run("UPDATE calls SET status = 'ended', signed_off_at = NULL, signed_off_by = NULL, approved_at = NULL, approved_by = NULL WHERE id = ?", callId);
  audit(callId, null, user.id, "reopened");
  return getCall(callId);
}

/** Crew list for a call with time entries, used by the Steward app and admin timesheet. */
export function roster(callId: number) {
  const c = getCall(callId);
  const rows = all<{
    worker_id: number; first_name: string; last_name: string; phone: string; role: string; role_id: number; is_steward: number;
    pay_rate: number | null; clock_in: string | null; clock_out: string | null; no_show: number | null; edited: number | null;
  }>(
    `SELECT a.worker_id, w.first_name, w.last_name, w.phone, r.name role, r.id role_id, r.is_steward, jr.pay_rate,
            e.clock_in, e.clock_out, e.no_show, e.edited
       FROM assignments a
       JOIN workers w ON w.id = a.worker_id
       JOIN positions p ON p.id = a.position_id
       JOIN roles r ON r.id = p.role_id
       JOIN calls c ON c.id = a.call_id
       LEFT JOIN job_rates jr ON jr.job_id = c.job_id AND jr.role_id = p.role_id
       LEFT JOIN time_entries e ON e.call_id = a.call_id AND e.worker_id = a.worker_id
      WHERE a.call_id = ? AND a.status = 'accepted'
      ORDER BY r.is_steward DESC, r.name, w.last_name, w.first_name`,
    callId,
  );
  return rows.map((r) => {
    const hours = entryHours({ clock_in: r.clock_in, clock_out: r.clock_out, no_show: r.no_show ?? 0 });
    const state = r.no_show ? "no_show" : r.clock_out ? "out" : r.clock_in ? "in" : "not_in";
    return {
      ...r,
      no_show: !!r.no_show,
      edited: !!r.edited,
      is_steward: !!r.is_steward,
      state,
      late: isLate(c, r.clock_in),
      hours,
      pay: r.pay_rate != null ? round2(hours * r.pay_rate) : 0,
      missing_rate: r.pay_rate == null,
    };
  });
}
