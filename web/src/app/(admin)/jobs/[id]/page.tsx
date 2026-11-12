"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { api, useData } from "@/lib/api";
import { CALL_STATUS, fmtDate, fmtTime, money, todayYmd } from "@/lib/format";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, LinkButton, Loading, Modal, PageHeader, Select, Textarea, cx, td, th } from "@/components/ui";

type Position = { id: number; role_id: number; role: string; quantity: number; accepted: number; standby: number; offered: number; pay_rate: number | null };
type Call = { id: number; name: string; call_date: string; start_time: string; end_time: string | null; status: string; positions: Position[] };
type Job = {
  id: number; name: string; status: string; notes: string; client_id: number; client_name: string; client_terms: string;
  venue_id: number | null; venue_name: string | null; venue_address: string | null; contact_id: number | null; contact_name: string | null;
  rates: { role_id: number; pay_rate: number; role: string }[];
  calls: Call[];
  invoice: { id: number; number: string; status: string; total: number } | null;
};
type Role = { id: number; name: string; active: number };

const TABS = ["calls", "rates", "billing", "details"] as const;

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  // Initial tab from ?tab=… (e.g. links to the Billing tab). Read once in the browser.
  const [tab, setTab] = useState<(typeof TABS)[number]>(() => {
    const t = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab");
    return (TABS as readonly string[]).includes(t ?? "") ? (t as (typeof TABS)[number]) : "calls";
  });
  const { data: job, reload, error } = useData<Job>(`/admin/jobs/${id}`, 10000);
  const [addCall, setAddCall] = useState(false);

  if (error && !job) return <ErrorNote>{error}</ErrorNote>;
  if (!job) return <Loading />;

  const needed = job.calls.filter((c) => c.status !== "cancelled").reduce((s, c) => s + c.positions.reduce((a, p) => a + p.quantity, 0), 0);
  const filled = job.calls.filter((c) => c.status !== "cancelled").reduce((s, c) => s + c.positions.reduce((a, p) => a + p.accepted, 0), 0);

  return (
    <>
      <PageHeader
        back={{ href: "/jobs", label: "Jobs" }}
        title={job.name}
        subtitle={
          <>
            <Link href={`/clients/${job.client_id}`} className="hover:text-accent">{job.client_name}</Link>
            {job.venue_name && <> · {job.venue_name}</>}
            {job.venue_address && <span className="text-ink/40"> — {job.venue_address}</span>}
            {job.status !== "active" && <> · <Badge>{job.status}</Badge></>}
          </>
        }
        actions={
          <>
            <a href={`/api/admin/jobs/${job.id}/timesheet.csv`} className="rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-medium shadow-sm hover:bg-paper">
              ⇩ Timesheet CSV
            </a>
            <Button variant="secondary" onClick={() => setAddCall(true)}>＋ Add call</Button>
          </>
        }
      />

      <div className="mb-5 flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cx("-mb-px border-b-2 px-4 py-2 text-sm font-medium capitalize", tab === t ? "border-accent text-ink" : "border-transparent text-ink/50 hover:text-ink")}
          >
            {t === "rates" ? "Pay rates" : t}
            {t === "calls" && <span className="ml-1.5 text-xs text-ink/40">{filled}/{needed}</span>}
          </button>
        ))}
      </div>

      {tab === "calls" && <CallsTab job={job} />}
      {tab === "rates" && <RatesTab job={job} onSaved={reload} />}
      {tab === "billing" && <BillingTab job={job} onCreated={reload} />}
      {tab === "details" && <DetailsTab job={job} onSaved={reload} />}

      <AddCallModal open={addCall} onClose={() => setAddCall(false)} job={job} onSaved={() => { setAddCall(false); void reload(); }} />
    </>
  );
}

function CallsTab({ job }: { job: Job }) {
  if (!job.calls.length) return <Empty>No calls yet.</Empty>;
  return (
    <div className="space-y-3">
      {job.calls.map((c) => {
        const st = CALL_STATUS[c.status];
        const need = c.positions.reduce((a, p) => a + p.quantity, 0);
        const have = c.positions.reduce((a, p) => a + p.accepted, 0);
        return (
          <Link key={c.id} href={`/calls/${c.id}`} className="block rounded-xl border border-line bg-white p-4 shadow-sm transition hover:border-ink/30">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-semibold">{c.name}</div>
                <div className="text-sm text-ink/60">
                  {fmtDate(c.call_date, true)} · {fmtTime(c.start_time)}
                  {c.end_time ? ` – ${fmtTime(c.end_time)}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={cx("text-sm font-medium tabular-nums", have >= need ? "text-emerald-700" : "text-accent")}>
                  {have}/{need} crew
                </span>
                <Badge tone={st.tone} dot={c.status === "in_progress"}>{st.label}</Badge>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {c.positions.map((p) => (
                <span key={p.id} className="rounded-md bg-paper px-2 py-1 text-xs">
                  <span className="font-medium">{p.role}</span>{" "}
                  <span className={p.accepted >= p.quantity ? "text-emerald-700" : "text-accent"}>
                    {p.accepted}/{p.quantity}
                  </span>
                  {p.standby > 0 && <span className="text-ink/50"> +{p.standby} standby</span>}
                  {p.offered > 0 && <span className="text-ink/50"> · {p.offered} offered</span>}
                </span>
              ))}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function RatesTab({ job, onSaved }: { job: Job; onSaved: () => void }) {
  const { data: roles } = useData<Role[]>("/admin/roles");
  const [rows, setRows] = useState(job.rates.map((r) => ({ role_id: r.role_id, pay_rate: String(r.pay_rate) })));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const name = (id: number) => roles?.find((r) => r.id === id)?.name ?? job.rates.find((r) => r.role_id === id)?.role ?? "";
  const unused = (roles ?? []).filter((r) => r.active && !rows.some((x) => x.role_id === r.id));
  return (
    <Card title="Hourly pay by role on this job" actions={<span className="text-xs text-ink/50">Applies to every call on this job</span>}>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.role_id} className="flex items-center gap-3">
            <div className="w-48 text-sm font-medium">{name(r.role_id)}</div>
            <div className="relative w-40">
              <span className="pointer-events-none absolute left-3 top-2 text-sm text-ink/40">$</span>
              <Input type="number" min="0" step="0.25" className="pl-6" value={r.pay_rate}
                onChange={(e) => { setSaved(false); setRows((rs) => rs.map((x, j) => (j === i ? { ...x, pay_rate: e.target.value } : x))); }} />
            </div>
            <span className="text-sm text-ink/50">/ hr</span>
            <Button variant="ghost" size="sm" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>Remove</Button>
          </div>
        ))}
        {unused.length > 0 && (
          <Select className="mt-2 w-60" value="" onChange={(e) => e.target.value && setRows((rs) => [...rs, { role_id: Number(e.target.value), pay_rate: "" }])}>
            <option value="">＋ Add a role…</option>
            {unused.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        )}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button
          onClick={async () => {
            setError(null);
            try {
              await api("PUT", `/admin/jobs/${job.id}/rates`, { rates: rows.map((r) => ({ role_id: r.role_id, pay_rate: Number(r.pay_rate) })) });
              setSaved(true);
                setTimeout(() => setSaved(false), 2500);
              onSaved();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Save rates
        </Button>
        {saved && <span className="text-sm text-emerald-700">Saved</span>}
      </div>
      <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>
    </Card>
  );
}

type Preview = {
  ready: boolean;
  notApproved: { id: number; name: string; call_date: string; status: string }[];
  lines: { description: string; hours: number; pay_rate: number; bill_rate: number; amount: number }[];
  labor_cost: number;
  total: number;
};

function BillingTab({ job, onCreated }: { job: Job; onCreated: () => void }) {
  const router = useRouter();
  const [markup, setMarkup] = useState("");
  const [terms, setTerms] = useState(job.client_terms);
  const [issue, setIssue] = useState(todayYmd());
  const m = Number(markup || 0);
  const { data: p } = useData<Preview>(`/admin/jobs/${job.id}/billing-preview?markup=${Number.isFinite(m) ? m : 0}`);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (job.invoice) {
    return (
      <Card title="Invoice">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-semibold">{job.invoice.number}</div>
            <div className="text-sm text-ink/60">{money(job.invoice.total)} · <Badge tone={job.invoice.status === "paid" ? "violet" : "amber"}>{job.invoice.status}</Badge></div>
          </div>
          <LinkButton href={`/invoices/${job.invoice.id}`}>Open invoice</LinkButton>
        </div>
      </Card>
    );
  }
  if (!p) return <Loading />;
  return (
    <div className="space-y-4">
      {!p.ready && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="font-semibold">Not ready to bill yet</div>
          Every call&apos;s timesheet must be approved first. Waiting on:{" "}
          {p.notApproved.map((c, i) => (
            <span key={c.id}>
              {i > 0 && ", "}
              <Link className="underline" href={`/calls/${c.id}`}>{c.name} ({fmtDate(c.call_date)})</Link> — {CALL_STATUS[c.status].label.toLowerCase()}
            </span>
          ))}
        </div>
      )}
      <Card title="Create the client invoice">
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="Markup on labor" hint="Bill rate = pay rate × (1 + markup)">
            <div className="relative">
              <Input type="number" min="0" step="0.5" value={markup} onChange={(e) => setMarkup(e.target.value)} placeholder="e.g. 35" autoFocus className="pr-8" />
              <span className="pointer-events-none absolute right-3 top-2 text-sm text-ink/40">%</span>
            </div>
          </Field>
          <Field label="Payment terms">
            <Select value={terms} onChange={(e) => setTerms(e.target.value)}>
              {["Due on receipt", "Net 10", "Net 15", "Net 30", "Net 45", "Net 60"].map((t) => <option key={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Invoice date">
            <Input type="date" value={issue} onChange={(e) => setIssue(e.target.value)} />
          </Field>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-line">
              <tr>
                <th className={th}>Line</th>
                <th className={cx(th, "text-right")}>Hours</th>
                <th className={cx(th, "text-right")}>Pay rate</th>
                <th className={cx(th, "text-right")}>Bill rate</th>
                <th className={cx(th, "text-right")}>Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {p.lines.map((l, i) => (
                <tr key={i}>
                  <td className={td}>{l.description}</td>
                  <td className={cx(td, "text-right tabular-nums")}>{l.hours.toFixed(2)}</td>
                  <td className={cx(td, "text-right tabular-nums text-ink/50")}>{money(l.pay_rate)}</td>
                  <td className={cx(td, "text-right tabular-nums")}>{money(l.bill_rate)}</td>
                  <td className={cx(td, "text-right tabular-nums font-medium")}>{money(l.amount)}</td>
                </tr>
              ))}
              {p.lines.length === 0 && (
                <tr><td colSpan={5} className={cx(td, "text-center text-ink/40")}>No approved hours yet.</td></tr>
              )}
            </tbody>
            <tfoot className="border-t-2 border-ink/20">
              <tr>
                <td className={cx(td, "text-ink/60")} colSpan={4}>Labor cost (what you pay crew)</td>
                <td className={cx(td, "text-right tabular-nums text-ink/60")}>{money(p.labor_cost)}</td>
              </tr>
              <tr>
                <td className={cx(td, "font-semibold")} colSpan={4}>Invoice total · margin {money(p.total - p.labor_cost)}</td>
                <td className={cx(td, "text-right text-lg font-semibold tabular-nums")}>{money(p.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>
        <div className="mt-4 flex justify-end">
          <Button
            disabled={!p.ready || markup === ""}
            busy={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const r = await api<{ id: number }>("POST", `/admin/jobs/${job.id}/invoice`, { markup_pct: m, terms, issue_date: issue });
                onCreated();
                router.push(`/invoices/${r.id}`);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
                setBusy(false);
              }
            }}
          >
            Create invoice
          </Button>
        </div>
      </Card>
    </div>
  );
}

function DetailsTab({ job, onSaved }: { job: Job; onSaved: () => void }) {
  const router = useRouter();
  const { data: client } = useData<{ contacts: { id: number; name: string }[]; venues: { id: number; name: string }[] }>(`/admin/clients/${job.client_id}`);
  const { data: venues } = useData<{ id: number; name: string }[]>("/admin/venues");
  const [f, setF] = useState({ name: job.name, notes: job.notes, venue_id: String(job.venue_id ?? ""), contact_id: String(job.contact_id ?? ""), status: job.status });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  return (
    <Card title="Job details">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Name" className="md:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Venue">
          <Select value={f.venue_id} onChange={(e) => setF({ ...f, venue_id: e.target.value })}>
            <option value="">None</option>
            {(venues ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </Select>
        </Field>
        <Field label="Client contact">
          <Select value={f.contact_id} onChange={(e) => setF({ ...f, contact_id: e.target.value })}>
            <option value="">None</option>
            {(client?.contacts ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </Field>
        <Field label="Notes for the crew" className="md:col-span-2"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>
      <div className="mt-4 flex items-center justify-between">
        <Button
          variant="danger"
          onClick={async () => {
            if (!confirm("Delete this job and all its calls? This can't be undone.")) return;
            try {
              await api("DELETE", `/admin/jobs/${job.id}`);
              router.push("/jobs");
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Delete job
        </Button>
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-emerald-700">Saved</span>}
          <Button
            onClick={async () => {
              setError(null);
              try {
                await api("PATCH", `/admin/jobs/${job.id}`, {
                  name: f.name, notes: f.notes, status: f.status,
                  venue_id: f.venue_id ? Number(f.venue_id) : null,
                  contact_id: f.contact_id ? Number(f.contact_id) : null,
                });
                setSaved(true);
                setTimeout(() => setSaved(false), 2500);
                onSaved();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </Card>
  );
}

function AddCallModal({ open, onClose, job, onSaved }: { open: boolean; onClose: () => void; job: Job; onSaved: () => void }) {
  const last = job.calls[job.calls.length - 1];
  const [f, setF] = useState({ name: "", call_date: last?.call_date ?? todayYmd(1), start_time: "08:00", end_time: "" });
  const [qty, setQty] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open={open} onClose={onClose} title="Add a call" wide>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Call name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Show" /></Field>
        <Field label="Date"><Input type="date" value={f.call_date} onChange={(e) => setF({ ...f, call_date: e.target.value })} /></Field>
        <Field label="Start"><Input type="time" value={f.start_time} onChange={(e) => setF({ ...f, start_time: e.target.value })} /></Field>
        <Field label="Est. end"><Input type="time" value={f.end_time} onChange={(e) => setF({ ...f, end_time: e.target.value })} /></Field>
      </div>
      <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink/60">Crew needed</div>
      <div className="mt-1 flex flex-wrap gap-3">
        {job.rates.map((r) => (
          <label key={r.role_id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5">
            <span className="text-sm">{r.role}</span>
            <input type="number" min="0" className="w-14 rounded border border-line px-2 py-1 text-sm" value={qty[r.role_id] ?? ""} placeholder="0"
              onChange={(e) => setQty({ ...qty, [r.role_id]: e.target.value })} />
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink/50">Need a role that isn&apos;t listed? Add it on the Pay rates tab first.</p>
      <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>
      <div className="mt-4 flex justify-end">
        <Button
          onClick={async () => {
            setError(null);
            try {
              await api("POST", `/admin/jobs/${job.id}/calls`, {
                ...f,
                end_time: f.end_time || null,
                positions: Object.entries(qty).map(([role_id, q]) => ({ role_id: Number(role_id), quantity: Number(q) })).filter((p) => p.quantity > 0),
              });
              setF({ ...f, name: "" });
              setQty({});
              onSaved();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Add call
        </Button>
      </div>
    </Modal>
  );
}
