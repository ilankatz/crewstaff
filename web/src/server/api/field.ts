import { route } from "../router";
import { all, get } from "../db";
import { forbidden, intId, notFound } from "../http";
import { requireWorker } from "../auth";
import { clockIn, clockOut, entryHours, getCall, isLate, isStewardOf, respondToOffer, roster, round2, stewardWorkerIds } from "../core";

const shiftCols = `a.id assignment_id, a.status, a.call_id, c.name call_name, c.call_date, c.start_time, c.end_time, c.status call_status, c.notes call_notes,
  j.id job_id, j.name job_name, j.notes job_notes, cl.name client_name, v.name venue_name, v.address venue_address,
  r.name role, r.is_steward, jr.pay_rate, p.id position_id, p.quantity`;
const shiftFrom = `FROM assignments a
  JOIN calls c ON c.id = a.call_id JOIN jobs j ON j.id = c.job_id JOIN clients cl ON cl.id = j.client_id
  LEFT JOIN venues v ON v.id = j.venue_id
  JOIN positions p ON p.id = a.position_id JOIN roles r ON r.id = p.role_id
  LEFT JOIN job_rates jr ON jr.job_id = j.id AND jr.role_id = p.role_id`;

route("GET", "/me/offers", async ({ req }) => {
  const u = await requireWorker(req);
  return all<Record<string, unknown> & { position_id: number; quantity: number }>(
    `SELECT ${shiftCols},
            (SELECT COUNT(*) FROM assignments x WHERE x.position_id = p.id AND x.status = 'accepted') filled
       ${shiftFrom}
      WHERE a.worker_id = ? AND a.status IN ('offered','standby') AND c.status IN ('scheduled','in_progress')
      ORDER BY c.call_date, c.start_time`,
    u.worker_id,
  ).map((o) => ({ ...o, spots_left: Math.max(0, o.quantity - Number(o.filled)) }));
});

route("POST", "/me/assignments/:id/:action", async ({ req, p }) => {
  const u = await requireWorker(req);
  const action = p.action;
  if (action !== "accept" && action !== "decline" && action !== "cancel") throw notFound();
  return respondToOffer(u.worker_id, intId(p.id), action);
});

route("GET", "/me/shifts", async ({ req, q }) => {
  const u = await requireWorker(req);
  const past = q.get("scope") === "past";
  const rows = all<Record<string, unknown> & { call_id: number; call_date: string; start_time: string }>(
    `SELECT ${shiftCols}, e.clock_in, e.clock_out, e.no_show
       ${shiftFrom}
       LEFT JOIN time_entries e ON e.call_id = a.call_id AND e.worker_id = a.worker_id
      WHERE a.worker_id = ? AND a.status = 'accepted'
        AND ${past ? "c.status IN ('signed_off','approved')" : "c.status IN ('scheduled','in_progress','ended')"}
      ORDER BY c.call_date ${past ? "DESC" : "ASC"}, c.start_time ${past ? "DESC" : "ASC"} LIMIT 100`,
    u.worker_id,
  );
  return rows.map((r) => ({ ...r, is_steward: !!r.is_steward, no_show: !!r.no_show }));
});

route("GET", "/me/calls/:id", async ({ req, p }) => {
  const u = await requireWorker(req);
  const callId = intId(p.id);
  const shift = get<Record<string, unknown> & { is_steward: number; call_date: string; start_time: string }>(
    `SELECT ${shiftCols}, e.clock_in, e.clock_out, e.no_show, e.edited
       ${shiftFrom}
       LEFT JOIN time_entries e ON e.call_id = a.call_id AND e.worker_id = a.worker_id
      WHERE a.worker_id = ? AND a.call_id = ?`,
    u.worker_id,
    callId,
  );
  if (!shift) throw notFound("You're not on this call");
  const steward = isStewardOf(u, callId);
  const stewards = all<{ id: number; first_name: string; last_name: string; phone: string }>(
    `SELECT id, first_name, last_name, phone FROM workers WHERE id IN (${stewardWorkerIds(callId).join(",") || "0"})`,
  );
  const hours = entryHours({ clock_in: shift.clock_in as string | null, clock_out: shift.clock_out as string | null, no_show: Number(shift.no_show ?? 0) });
  return {
    ...shift,
    is_steward: steward,
    no_show: !!shift.no_show,
    late: isLate(shift, (shift.clock_in as string | null) ?? null),
    hours,
    stewards,
    roster: steward ? roster(callId) : undefined,
  };
});

route("POST", "/me/calls/:id/clock-in", async ({ req, p }) => {
  const u = await requireWorker(req);
  return clockIn(intId(p.id), u.worker_id, u);
});

route("POST", "/me/calls/:id/clock-out", async ({ req, p }) => {
  const u = await requireWorker(req);
  return clockOut(intId(p.id), u.worker_id, u);
});

/** The worker's own time history with estimated pay, newest first. */
route("GET", "/me/hours", async ({ req }) => {
  const u = await requireWorker(req);
  const rows = all<{
    call_id: number; job_name: string; call_name: string; call_date: string; role: string; pay_rate: number | null;
    clock_in: string | null; clock_out: string | null; no_show: number; call_status: string;
  }>(
    `SELECT e.call_id, j.name job_name, c.name call_name, c.call_date, r.name role, jr.pay_rate,
            e.clock_in, e.clock_out, e.no_show, c.status call_status
       FROM time_entries e
       JOIN calls c ON c.id = e.call_id JOIN jobs j ON j.id = c.job_id
       JOIN assignments a ON a.call_id = e.call_id AND a.worker_id = e.worker_id
       JOIN positions p ON p.id = a.position_id JOIN roles r ON r.id = p.role_id
       LEFT JOIN job_rates jr ON jr.job_id = j.id AND jr.role_id = p.role_id
      WHERE e.worker_id = ? AND (e.clock_in IS NOT NULL OR e.no_show = 1)
      ORDER BY c.call_date DESC, e.clock_in DESC LIMIT 300`,
    u.worker_id,
  );
  return rows.map((r) => {
    const hours = entryHours(r);
    return {
      ...r,
      no_show: !!r.no_show,
      hours,
      pay: round2(hours * (r.pay_rate ?? 0)),
      approval: r.call_status === "approved" ? "approved" : r.call_status === "signed_off" ? "signed_off" : "pending",
    };
  });
});

// Steward roster lives under /calls/:id/roster (shared with admins); this alias keeps the app's URLs under /me.
route("GET", "/me/calls/:id/roster", async ({ req, p }) => {
  const u = await requireWorker(req);
  const callId = intId(p.id);
  if (!isStewardOf(u, callId)) throw forbidden("Only the Steward can see the crew list");
  return { call: getCall(callId), roster: roster(callId) };
});
