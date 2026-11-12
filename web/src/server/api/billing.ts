import { z } from "zod";
import { route } from "../router";
import { all, get, run, tx } from "../db";
import { bad, body, conflict, csv, intId, notFound, zDate, zId, zStr } from "../http";
import { requireAdmin } from "../auth";
import { entryHours, fmtDate, getCall, round2 } from "../core";

const TERMS = ["Due on receipt", "Net 10", "Net 15", "Net 30", "Net 45", "Net 60"] as const;

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function termDays(terms: string) {
  const m = terms.match(/Net (\d+)/);
  return m ? Number(m[1]) : 0;
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function localStamp(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { month: "2-digit", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" });
}

type WorkRow = {
  call_id: number; call_name: string; call_date: string; call_status: string; role_id: number; role: string; pay_rate: number | null;
  worker_id: number; first_name: string; last_name: string; email: string; phone: string;
  clock_in: string | null; clock_out: string | null; no_show: number; edited: number; job_id: number; job_name: string; client_name: string;
};

/** Every time entry on a set of calls, joined with the role/rate it was worked under. */
function workRows(where: string, ...args: unknown[]): (WorkRow & { hours: number; pay: number })[] {
  return all<WorkRow>(
    `SELECT c.id call_id, c.name call_name, c.call_date, c.status call_status, p.role_id, r.name role, jr.pay_rate,
            w.id worker_id, w.first_name, w.last_name, w.email, w.phone,
            e.clock_in, e.clock_out, e.no_show, e.edited, j.id job_id, j.name job_name, cl.name client_name
       FROM time_entries e
       JOIN calls c ON c.id = e.call_id JOIN jobs j ON j.id = c.job_id JOIN clients cl ON cl.id = j.client_id
       JOIN workers w ON w.id = e.worker_id
       JOIN assignments a ON a.call_id = e.call_id AND a.worker_id = e.worker_id
       JOIN positions p ON p.id = a.position_id JOIN roles r ON r.id = p.role_id
       LEFT JOIN job_rates jr ON jr.job_id = j.id AND jr.role_id = p.role_id
      WHERE ${where}
      ORDER BY c.call_date, c.start_time, r.is_steward DESC, r.name, w.last_name, w.first_name`,
    ...args,
  ).map((r) => {
    const hours = entryHours(r);
    return { ...r, hours, pay: round2(hours * (r.pay_rate ?? 0)) };
  });
}

// ---------------------------------------------------------------- invoices

function buildLines(jobId: number, markupPct: number) {
  const rows = workRows("c.job_id = ? AND c.status = 'approved'", jobId);
  const groups = new Map<string, { call_id: number; role_id: number; desc: string; hours: number; pay_rate: number; heads: number; sort: number }>();
  let sort = 0;
  for (const r of rows) {
    if (r.no_show || r.hours === 0) continue;
    const key = `${r.call_id}:${r.role_id}`;
    const g = groups.get(key) ?? {
      call_id: r.call_id,
      role_id: r.role_id,
      desc: `${r.call_name} (${fmtDate(r.call_date)}) — ${r.role}`,
      hours: 0,
      pay_rate: r.pay_rate ?? 0,
      heads: 0,
      sort: sort++,
    };
    g.hours = round2(g.hours + r.hours);
    g.heads++;
    groups.set(key, g);
  }
  const m = 1 + markupPct / 100;
  const lines = [...groups.values()].map((g) => {
    const bill_rate = round2(g.pay_rate * m);
    return {
      call_id: g.call_id,
      role_id: g.role_id,
      description: `${g.desc} × ${g.heads}`,
      hours: g.hours,
      pay_rate: g.pay_rate,
      bill_rate,
      amount: round2(g.hours * bill_rate),
      sort: g.sort,
    };
  });
  return {
    lines,
    labor_cost: round2(lines.reduce((s, l) => s + l.hours * l.pay_rate, 0)),
    total: round2(lines.reduce((s, l) => s + l.amount, 0)),
  };
}

function writeLines(invoiceId: number, jobId: number, markupPct: number) {
  const built = buildLines(jobId, markupPct);
  run("DELETE FROM invoice_lines WHERE invoice_id = ?", invoiceId);
  for (const l of built.lines) {
    run(
      `INSERT INTO invoice_lines (invoice_id, call_id, role_id, description, hours, pay_rate, bill_rate, amount, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      invoiceId, l.call_id, l.role_id, l.description, l.hours, l.pay_rate, l.bill_rate, l.amount, l.sort,
    );
  }
  run("UPDATE invoices SET labor_cost = ?, total = ?, markup_pct = ? WHERE id = ?", built.labor_cost, built.total, markupPct, invoiceId);
}

function billingReadiness(jobId: number) {
  const calls = all<{ id: number; name: string; call_date: string; status: string }>(
    "SELECT id, name, call_date, status FROM calls WHERE job_id = ? AND status != 'cancelled' ORDER BY call_date, start_time",
    jobId,
  );
  const notApproved = calls.filter((c) => c.status !== "approved");
  return { ready: calls.length > 0 && notApproved.length === 0, calls, notApproved };
}

route("GET", "/admin/jobs/:id/billing-preview", async ({ req, p, q }) => {
  await requireAdmin(req);
  const jobId = intId(p.id);
  const markup = Number(q.get("markup") ?? 0);
  return { ...billingReadiness(jobId), ...buildLines(jobId, Number.isFinite(markup) ? markup : 0) };
});

route("POST", "/admin/jobs/:id/invoice", async ({ req, p }) => {
  await requireAdmin(req);
  const jobId = intId(p.id);
  const b = await body(
    req,
    z.object({
      markup_pct: z.number().min(0).max(1000),
      terms: z.enum(TERMS).optional(),
      issue_date: zDate.optional(),
      bill_to_contact_id: zId.nullable().optional(),
      notes: zStr(2000).default(""),
    }),
  );
  const job = get<{ id: number; client_terms: string; contact_id: number | null }>(
    "SELECT j.id, c.payment_terms client_terms, j.contact_id FROM jobs j JOIN clients c ON c.id = j.client_id WHERE j.id = ?",
    jobId,
  );
  if (!job) throw notFound("Job not found");
  if (get("SELECT 1 FROM invoices WHERE job_id = ?", jobId)) throw conflict("This job already has an invoice");
  const ready = billingReadiness(jobId);
  if (!ready.ready) {
    throw conflict(
      ready.calls.length
        ? `Approve every call's timesheet first. Waiting on: ${ready.notApproved.map((c) => c.name).join(", ")}`
        : "This job has no calls to bill",
    );
  }
  const terms = b.terms ?? (job.client_terms as (typeof TERMS)[number]);
  const issue = b.issue_date ?? today();
  const id = tx(() => {
    const next = get<{ n: number }>("SELECT COALESCE(MAX(CAST(SUBSTR(number, 5) AS INTEGER)), 1000) + 1 n FROM invoices")!.n;
    const r = run(
      `INSERT INTO invoices (job_id, number, markup_pct, issue_date, due_date, terms, bill_to_contact_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      jobId, `INV-${next}`, b.markup_pct, issue, addDays(issue, termDays(terms)), terms, b.bill_to_contact_id ?? job.contact_id, b.notes,
    );
    const invId = Number(r.lastInsertRowid);
    writeLines(invId, jobId, b.markup_pct);
    return invId;
  });
  run("UPDATE jobs SET status = 'completed' WHERE id = ? AND status = 'active'", jobId);
  return { id };
});

route("GET", "/admin/invoices", async ({ req }) => {
  await requireAdmin(req);
  return all(
    `SELECT i.id, i.number, i.status, i.issue_date, i.due_date, i.total, i.labor_cost, i.markup_pct,
            j.id job_id, j.name job_name, c.name client_name
       FROM invoices i JOIN jobs j ON j.id = i.job_id JOIN clients c ON c.id = j.client_id
      ORDER BY i.issue_date DESC, i.id DESC`,
  );
});

function loadInvoice(id: number) {
  const inv = get<Record<string, unknown> & { job_id: number; status: string; markup_pct: number }>(
    `SELECT i.*, j.name job_name, j.client_id, c.name client_name, c.billing_address, c.email client_email, c.phone client_phone,
            v.name venue_name, v.address venue_address, cc.name contact_name, cc.email contact_email
       FROM invoices i JOIN jobs j ON j.id = i.job_id JOIN clients c ON c.id = j.client_id
       LEFT JOIN venues v ON v.id = j.venue_id LEFT JOIN client_contacts cc ON cc.id = i.bill_to_contact_id
      WHERE i.id = ?`,
    id,
  );
  if (!inv) throw notFound("Invoice not found");
  return inv;
}

route("GET", "/admin/invoices/:id", async ({ req, p }) => {
  await requireAdmin(req);
  const id = intId(p.id);
  let inv = loadInvoice(id);
  // Drafts always reflect the latest approved hours; sent/paid invoices are frozen.
  if (inv.status === "draft") {
    writeLines(id, inv.job_id, inv.markup_pct);
    inv = loadInvoice(id);
  }
  const lines = all("SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort, id", id);
  return { ...inv, lines };
});

route("PATCH", "/admin/invoices/:id", async ({ req, p }) => {
  await requireAdmin(req);
  const id = intId(p.id);
  const b = await body(
    req,
    z.object({
      markup_pct: z.number().min(0).max(1000).optional(),
      terms: z.enum(TERMS).optional(),
      issue_date: zDate.optional(),
      notes: zStr(2000).optional(),
      bill_to_contact_id: zId.nullable().optional(),
      status: z.enum(["draft", "sent", "paid"]).optional(),
    }),
  );
  const inv = loadInvoice(id);
  const editingContent = b.markup_pct !== undefined || b.terms !== undefined || b.issue_date !== undefined || b.bill_to_contact_id !== undefined;
  if (editingContent && inv.status !== "draft" && b.status !== "draft") throw conflict("Move the invoice back to draft to change it");
  tx(() => {
    if (b.status) run("UPDATE invoices SET status = ? WHERE id = ?", b.status, id);
    if (b.notes !== undefined) run("UPDATE invoices SET notes = ? WHERE id = ?", b.notes, id);
    if (b.bill_to_contact_id !== undefined) run("UPDATE invoices SET bill_to_contact_id = ? WHERE id = ?", b.bill_to_contact_id, id);
    if (b.terms !== undefined || b.issue_date !== undefined) {
      const terms = b.terms ?? String(inv.terms);
      const issue = b.issue_date ?? String(inv.issue_date);
      run("UPDATE invoices SET terms = ?, issue_date = ?, due_date = ? WHERE id = ?", terms, issue, addDays(issue, termDays(terms)), id);
    }
    if (b.markup_pct !== undefined) writeLines(id, inv.job_id, b.markup_pct);
  });
  return { ok: true };
});

route("DELETE", "/admin/invoices/:id", async ({ req, p }) => {
  await requireAdmin(req);
  const inv = loadInvoice(intId(p.id));
  if (inv.status !== "draft") throw conflict("Only draft invoices can be deleted");
  run("DELETE FROM invoices WHERE id = ?", intId(p.id));
  return { ok: true };
});

/** QuickBooks Desktop import file (.IIF): one invoice transaction, one split line per role/call. */
route("GET", "/admin/invoices/:id/quickbooks.iif", async ({ req, p }) => {
  await requireAdmin(req);
  const id = intId(p.id);
  const inv = loadInvoice(id);
  const lines = all<{ description: string; hours: number; bill_rate: number; amount: number; role_id: number }>(
    "SELECT l.*, r.name role FROM invoice_lines l LEFT JOIN roles r ON r.id = l.role_id WHERE invoice_id = ? ORDER BY sort, id",
    id,
  ) as unknown as { description: string; hours: number; bill_rate: number; amount: number; role: string }[];
  const qbDate = (d: string) => {
    const [y, m, dd] = d.split("-");
    return `${m}/${dd}/${y}`;
  };
  const clean = (s: unknown) => String(s ?? "").replace(/[\t\r\n]+/g, " ");
  const date = qbDate(String(inv.issue_date));
  const rows = [
    ["!TRNS", "TRNSTYPE", "DATE", "ACCNT", "NAME", "AMOUNT", "DOCNUM", "MEMO", "TERMS", "DUEDATE"],
    ["!SPL", "TRNSTYPE", "DATE", "ACCNT", "NAME", "AMOUNT", "DOCNUM", "MEMO", "PRICE", "QNTY", "INVITEM"],
    ["!ENDTRNS"],
    ["TRNS", "INVOICE", date, "Accounts Receivable", clean(inv.client_name), Number(inv.total).toFixed(2), clean(inv.number), clean(inv.job_name), clean(inv.terms), qbDate(String(inv.due_date))],
    ...lines.map((l) => [
      "SPL", "INVOICE", date, "Labor Income", clean(inv.client_name), (-l.amount).toFixed(2), clean(inv.number), clean(l.description),
      l.bill_rate.toFixed(2), (-l.hours).toFixed(2), clean(`Labor:${l.role ?? "Labor"}`),
    ]),
    ["ENDTRNS"],
  ];
  return new Response(rows.map((r) => r.join("\t")).join("\r\n") + "\r\n", {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${clean(inv.number)}.iif"`,
      "cache-control": "no-store",
    },
  });
});

// ---------------------------------------------------------------- timesheets & payroll exports

const timesheetHeader = ["Date", "Job", "Call", "Worker", "Email", "Phone", "Role", "Clock In", "Clock Out", "No Show", "Edited", "Hours", "Pay Rate", "Pay"];
function timesheetRow(r: WorkRow & { hours: number; pay: number }) {
  return [
    r.call_date, r.job_name, r.call_name, `${r.first_name} ${r.last_name}`, r.email, r.phone, r.role,
    localStamp(r.clock_in), localStamp(r.clock_out), r.no_show ? "Yes" : "", r.edited ? "Yes" : "",
    r.hours.toFixed(2), (r.pay_rate ?? 0).toFixed(2), r.pay.toFixed(2),
  ];
}
const slug = (s: string) => s.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase();

route("GET", "/admin/calls/:id/timesheet.csv", async ({ req, p }) => {
  await requireAdmin(req);
  const id = intId(p.id);
  const c = getCall(id);
  const rows = workRows("c.id = ?", id);
  return csv(`timesheet-${c.call_date}-${slug(c.name)}.csv`, [timesheetHeader, ...rows.map(timesheetRow)]);
});

route("GET", "/admin/jobs/:id/timesheet.csv", async ({ req, p }) => {
  await requireAdmin(req);
  const id = intId(p.id);
  const job = get<{ name: string }>("SELECT name FROM jobs WHERE id = ?", id);
  if (!job) throw notFound();
  const rows = workRows("c.job_id = ?", id);
  return csv(`timesheet-${slug(job.name)}.csv`, [timesheetHeader, ...rows.map(timesheetRow)]);
});

function weekStart(date: string) {
  const d = new Date(`${date}T12:00:00`);
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - dow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function payroll(from: string, to: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw bad("from and to must be YYYY-MM-DD");
  const rows = workRows("c.status = 'approved' AND c.call_date BETWEEN ? AND ?", from, to).filter((r) => !r.no_show && r.hours > 0);
  const summary = new Map<string, { week_start: string; worker_id: number; name: string; email: string; phone: string; shifts: number; hours: number; gross: number }>();
  for (const r of rows) {
    const wk = weekStart(r.call_date);
    const key = `${wk}:${r.worker_id}`;
    const s = summary.get(key) ?? { week_start: wk, worker_id: r.worker_id, name: `${r.last_name}, ${r.first_name}`, email: r.email, phone: r.phone, shifts: 0, hours: 0, gross: 0 };
    s.shifts++;
    s.hours = round2(s.hours + r.hours);
    s.gross = round2(s.gross + r.pay);
    summary.set(key, s);
  }
  const pending = get<{ n: number }>(
    "SELECT COUNT(*) n FROM calls WHERE status IN ('in_progress','ended','signed_off') AND call_date BETWEEN ? AND ?",
    from,
    to,
  )!.n;
  return {
    summary: [...summary.values()].sort((a, b) => a.week_start.localeCompare(b.week_start) || a.name.localeCompare(b.name)),
    detail: rows,
    totals: { hours: round2(rows.reduce((s, r) => s + r.hours, 0)), gross: round2(rows.reduce((s, r) => s + r.pay, 0)) },
    unapproved_calls: pending,
  };
}

route("GET", "/admin/payroll", async ({ req, q }) => {
  await requireAdmin(req);
  return payroll(q.get("from") || "", q.get("to") || "");
});

route("GET", "/admin/payroll.csv", async ({ req, q }) => {
  await requireAdmin(req);
  const from = q.get("from") || "", to = q.get("to") || "";
  const data = payroll(from, to);
  if (q.get("detail") === "1") {
    return csv(`payroll-detail-${from}-to-${to}.csv`, [timesheetHeader, ...data.detail.map(timesheetRow)]);
  }
  return csv(`payroll-${from}-to-${to}.csv`, [
    ["Week Starting (Mon)", "Worker", "Email", "Phone", "Shifts", "Hours", "Gross Pay"],
    ...data.summary.map((s) => [s.week_start, s.name, s.email, s.phone, s.shifts, s.hours.toFixed(2), s.gross.toFixed(2)]),
  ]);
});
