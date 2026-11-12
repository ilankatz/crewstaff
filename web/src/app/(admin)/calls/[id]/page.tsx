"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { api, useData } from "@/lib/api";
import { CALL_STATUS, clock, fmtDate, fmtTime, fromLocalInput, hrs, money, stamp, toLocalInput } from "@/lib/format";
import { ChatPanel } from "@/components/chat";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, cx, td, th } from "@/components/ui";

type Position = { id: number; role_id: number; role: string; is_steward: number; quantity: number; accepted: number; standby: number; offered: number; pay_rate: number | null };
type Assignment = { id: number; position_id: number; worker_id: number; status: string; offered_at: string; responded_at: string | null; first_name: string; last_name: string; phone: string };
type RosterRow = {
  worker_id: number; first_name: string; last_name: string; phone: string; role: string; is_steward: boolean; pay_rate: number | null;
  clock_in: string | null; clock_out: string | null; no_show: boolean; edited: boolean; state: "not_in" | "in" | "out" | "no_show"; late: boolean; hours: number; pay: number; missing_rate: boolean;
};
type Detail = {
  call: { id: number; job_id: number; name: string; call_date: string; start_time: string; end_time: string | null; notes: string; status: string; started_at: string | null; ended_at: string | null; signed_off_at: string | null; signed_off_by_name: string | null; approved_at: string | null; approved_by_name: string | null };
  job: { id: number; name: string; client_id: number; client_name: string; venue_name: string | null; venue_address: string | null };
  positions: Position[];
  assignments: Assignment[];
  roster: RosterRow[];
  stewards: number[];
  log: { id: number; action: string; details: string; created_at: string; user_name: string | null; worker_name: string | null }[];
};

const A_STATUS: Record<string, { label: string; tone: "green" | "amber" | "slate" | "red" | "blue" }> = {
  accepted: { label: "Booked", tone: "green" },
  standby: { label: "Standby", tone: "amber" },
  offered: { label: "Offer sent", tone: "blue" },
  declined: { label: "Declined", tone: "slate" },
  cancelled: { label: "Dropped", tone: "red" },
  removed: { label: "Removed", tone: "slate" },
};

export default function CallPage() {
  const { id } = useParams<{ id: string }>();
  const { data, reload, error } = useData<Detail>(`/admin/calls/${id}`, 5000);
  const [offerFor, setOfferFor] = useState<Position | null>(null);
  const [addPos, setAddPos] = useState(false);
  const [editRow, setEditRow] = useState<RosterRow | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (error && !data) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Loading />;
  const { call, job } = data;
  const st = CALL_STATUS[call.status];
  const closed = ["signed_off", "approved", "cancelled"].includes(call.status);

  async function act(key: string, method: string, path: string, body?: unknown, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(key);
    setActionError(null);
    try {
      await api(method, path, body ?? {});
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const totalHours = data.roster.reduce((s, r) => s + r.hours, 0);
  const totalPay = data.roster.reduce((s, r) => s + r.pay, 0);
  const hasSteward = data.stewards.length > 0;

  return (
    <>
      <PageHeader
        back={{ href: `/jobs/${job.id}`, label: job.name }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {call.name} <Badge tone={st.tone} dot={call.status === "in_progress"}>{st.label}</Badge>
          </span>
        }
        subtitle={
          <>
            {fmtDate(call.call_date, true)} · {fmtTime(call.start_time)}
            {call.end_time ? ` – ${fmtTime(call.end_time)}` : ""} · {job.client_name}
            {job.venue_name ? ` · ${job.venue_name}` : ""}
          </>
        }
        actions={
          <>
            <a href={`/api/admin/calls/${call.id}/timesheet.csv`} className="rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-medium shadow-sm hover:bg-paper">
              ⇩ Timesheet CSV
            </a>
            {call.status === "scheduled" && (
              <>
                <Button variant="danger" busy={busy === "cancel"} onClick={() => act("cancel", "POST", `/admin/calls/${call.id}/cancel`, {}, "Cancel this call? Everyone booked or offered will be notified.")}>
                  Cancel call
                </Button>
                <Button variant="secondary" busy={busy === "start"} onClick={() => act("start", "POST", `/calls/${call.id}/start`, {}, "Start this call from the office? Normally the Steward starts it on site.")}>
                  Start call
                </Button>
              </>
            )}
            {call.status === "in_progress" && (
              <Button variant="secondary" busy={busy === "end"} onClick={() => act("end", "POST", `/calls/${call.id}/end`, { clock_out_remaining: true }, "End the call now? Anyone still on the clock is clocked out now; anyone who never clocked in is marked no-show.")}>
                End call
              </Button>
            )}
            {["ended", "signed_off"].includes(call.status) && (
              <Button variant="success" busy={busy === "approve"} onClick={() => act("approve", "POST", `/admin/calls/${call.id}/approve`, {}, call.status === "ended" ? "The Steward hasn't signed off yet. Approve anyway?" : undefined)}>
                ✓ Approve timesheet
              </Button>
            )}
            {["signed_off", "approved"].includes(call.status) && (
              <Button variant="secondary" busy={busy === "reopen"} onClick={() => act("reopen", "POST", `/admin/calls/${call.id}/reopen`, {}, "Reopen this timesheet for changes?")}>
                Reopen
              </Button>
            )}
          </>
        }
      />
      <ErrorNote>{actionError}</ErrorNote>
      {!hasSteward && call.status === "scheduled" && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No Steward is booked yet. Someone in the Steward role needs to be on this call to start it and run clock-ins from the app.
        </div>
      )}
      {call.notes && <div className="mb-4 rounded-lg bg-white px-4 py-3 text-sm text-ink/70 ring-1 ring-line">{call.notes}</div>}

      <div className="grid gap-6 xl:grid-cols-5">
        <div className="min-w-0 space-y-6 xl:col-span-3">
          <Card
            title={`Timesheet · ${data.roster.length} booked`}
            actions={<span className="text-xs tabular-nums text-ink/60">{hrs(totalHours)} · {money(totalPay)} labor</span>}
            pad={false}
          >
            {data.roster.length === 0 ? (
              <div className="p-4"><Empty>Nobody booked yet. Send offers from Staffing.</Empty></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-line bg-paper/60">
                    <tr>
                      <th className={th}>Worker</th>
                      <th className={th}>In</th>
                      <th className={th}>Out</th>
                      <th className={cx(th, "text-right")}>Hours</th>
                      <th className={cx(th, "text-right")}>Pay</th>
                      <th className={th}></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.roster.map((r) => (
                      <tr key={r.worker_id}>
                        <td className={td}>
                          <Link href={`/workers/${r.worker_id}`} className="font-medium hover:text-accent">{r.first_name} {r.last_name}</Link>
                          <div className="flex flex-wrap items-center gap-1 text-xs text-ink/55">
                            {r.role}
                            {r.is_steward && <Badge tone="amber">Steward</Badge>}
                            {r.state === "in" && <Badge tone="green" dot>On clock</Badge>}
                            {r.no_show && <Badge tone="red">No-show</Badge>}
                            {r.late && <Badge tone="amber">Late</Badge>}
                            {r.edited && <Badge>Edited</Badge>}
                            {r.missing_rate && <Badge tone="red">No pay rate</Badge>}
                          </div>
                        </td>
                        <td className={cx(td, "tabular-nums")}>{clock(r.clock_in)}</td>
                        <td className={cx(td, "tabular-nums")}>{clock(r.clock_out)}</td>
                        <td className={cx(td, "text-right tabular-nums")}>{r.hours.toFixed(2)}</td>
                        <td className={cx(td, "text-right tabular-nums")}>{money(r.pay)}</td>
                        <td className={cx(td, "text-right")}>
                          <div className="flex justify-end gap-1">
                            {call.status === "in_progress" && r.state === "not_in" && (
                              <Button size="sm" variant="secondary" busy={busy === `in${r.worker_id}`} onClick={() => act(`in${r.worker_id}`, "POST", `/calls/${call.id}/workers/${r.worker_id}/clock-in`)}>Clock in</Button>
                            )}
                            {call.status === "in_progress" && r.state === "in" && (
                              <Button size="sm" variant="secondary" busy={busy === `out${r.worker_id}`} onClick={() => act(`out${r.worker_id}`, "POST", `/calls/${call.id}/workers/${r.worker_id}/clock-out`)}>Clock out</Button>
                            )}
                            {call.status !== "scheduled" && call.status !== "approved" && call.status !== "cancelled" && (
                              <Button size="sm" variant="ghost" onClick={() => setEditRow(r)}>Edit</Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(call.signed_off_at || call.approved_at) && (
              <div className="border-t border-line px-4 py-2.5 text-xs text-ink/60">
                {call.signed_off_at && <>Signed off by {call.signed_off_by_name} {stamp(call.signed_off_at)}. </>}
                {call.approved_at && <>Approved by {call.approved_by_name} {stamp(call.approved_at)}.</>}
              </div>
            )}
          </Card>

          <Card title="Messages" pad={false}>
            <div className="p-3"><ChatPanel callId={call.id} /></div>
          </Card>
        </div>

        <div className="min-w-0 space-y-6 xl:col-span-2">
          <Card title="Staffing" actions={!closed && <Button size="sm" variant="secondary" onClick={() => setAddPos(true)}>＋ Position</Button>} pad={false}>
            <div className="divide-y divide-line">
              {data.positions.map((p) => (
                <PositionBlock
                  key={p.id}
                  p={p}
                  closed={closed}
                  assignments={data.assignments.filter((a) => a.position_id === p.id)}
                  onOffer={() => setOfferFor(p)}
                  onChanged={reload}
                  onError={setActionError}
                />
              ))}
              {data.positions.length === 0 && <div className="p-4"><Empty>No positions on this call.</Empty></div>}
            </div>
          </Card>

          <Card title="Activity" pad={false}>
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {data.log.map((l) => (
                <li key={l.id} className="px-4 py-2 text-xs">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{l.action.replace(/_/g, " ")}</span>
                    <span className="text-ink/40">{stamp(l.created_at)}</span>
                  </div>
                  <div className="text-ink/55">
                    {[l.worker_name, l.user_name && `by ${l.user_name}`, l.details.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, (m) => clock(m))].filter(Boolean).join(" · ")}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      {offerFor && <OfferModal position={offerFor} onClose={() => setOfferFor(null)} onSent={() => { setOfferFor(null); void reload(); }} />}
      <AddPositionModal open={addPos} callId={call.id} jobId={job.id} onClose={() => setAddPos(false)} onSaved={() => { setAddPos(false); void reload(); }} />
      {editRow && <EditTimeModal row={editRow} callId={call.id} live={call.status === "in_progress"} onClose={() => setEditRow(null)} onSaved={() => { setEditRow(null); void reload(); }} />}
    </>
  );
}

function PositionBlock({ p, assignments, closed, onOffer, onChanged, onError }: { p: Position; assignments: Assignment[]; closed: boolean; onOffer: () => void; onChanged: () => void; onError: (e: string | null) => void }) {
  const [showAll, setShowAll] = useState(false);
  const visible = assignments.filter((a) => showAll || ["accepted", "standby", "offered"].includes(a.status));
  const hidden = assignments.length - assignments.filter((a) => ["accepted", "standby", "offered"].includes(a.status)).length;
  const full = p.accepted >= p.quantity;
  return (
    <div className="p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 font-medium">
            {p.role} {p.is_steward ? <Badge tone="amber">runs the call</Badge> : null}
          </div>
          <div className="text-xs text-ink/55">{p.pay_rate != null ? `${money(p.pay_rate)}/hr` : "No pay rate"}</div>
        </div>
        <div className="flex items-center gap-2">
          <QtyEditor p={p} disabled={closed} onChanged={onChanged} onError={onError} />
          {!closed && <Button size="sm" onClick={onOffer}>{full ? "Offer standby" : "Offer / assign"}</Button>}
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/10">
        <div className={cx("h-full", full ? "bg-emerald-500" : "bg-accent")} style={{ width: `${p.quantity ? Math.min(100, (p.accepted / p.quantity) * 100) : 0}%` }} />
      </div>
      {visible.length > 0 && (
        <ul className="mt-3 space-y-1">
          {visible.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
              <Link href={`/workers/${a.worker_id}`} className="truncate hover:text-accent">{a.first_name} {a.last_name}</Link>
              <div className="flex items-center gap-1">
                <Badge tone={A_STATUS[a.status].tone}>{A_STATUS[a.status].label}</Badge>
                {!closed && ["accepted", "standby", "offered"].includes(a.status) && (
                  <button
                    title={a.status === "offered" ? "Withdraw offer" : "Remove from call"}
                    className="rounded px-1 text-ink/30 hover:bg-red-50 hover:text-red-700"
                    onClick={async () => {
                      if (!confirm(a.status === "offered" ? "Withdraw this offer?" : `Remove ${a.first_name} from this call? They'll be notified and the next standby moves up.`)) return;
                      try {
                        onError(null);
                        await api("POST", `/admin/assignments/${a.id}/remove`);
                        onChanged();
                      } catch (e) {
                        onError(e instanceof Error ? e.message : String(e));
                      }
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 && (
        <button className="mt-2 text-xs text-ink/45 hover:text-ink" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Hide" : "Show"} {hidden} declined/dropped
        </button>
      )}
    </div>
  );
}

function QtyEditor({ p, disabled, onChanged, onError }: { p: Position; disabled: boolean; onChanged: () => void; onError: (e: string | null) => void }) {
  const set = async (q: number) => {
    try {
      onError(null);
      await api("PATCH", `/admin/positions/${p.id}`, { quantity: q });
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="flex items-center rounded-lg border border-line text-sm">
      <button disabled={disabled || p.quantity <= 0} className="px-2 py-1 text-ink/50 hover:text-ink disabled:opacity-30" onClick={() => set(p.quantity - 1)}>−</button>
      <span className="min-w-12 text-center tabular-nums">
        <span className={p.accepted >= p.quantity ? "text-emerald-700" : "text-accent"}>{p.accepted}</span>/{p.quantity}
      </span>
      <button disabled={disabled} className="px-2 py-1 text-ink/50 hover:text-ink disabled:opacity-30" onClick={() => set(p.quantity + 1)}>+</button>
    </div>
  );
}

type Candidate = { id: number; first_name: string; last_name: string; phone: string; preferred: boolean; current_status: string | null; same_day: string[] };

function OfferModal({ position, onClose, onSent }: { position: Position; onClose: () => void; onSent: () => void }) {
  const { data } = useData<Candidate[]>(`/admin/positions/${position.id}/candidates`);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const open = Math.max(0, position.quantity - position.accepted);
  const available = useMemo(() => (data ?? []).filter((c) => !c.current_status || ["declined", "cancelled", "removed"].includes(c.current_status)), [data]);
  const shown = available.filter((c) => !q || `${c.first_name} ${c.last_name}`.toLowerCase().includes(q.toLowerCase()));
  const alreadyIn = (data ?? []).filter((c) => c.current_status && ["offered", "accepted", "standby"].includes(c.current_status)).length;
  const freshCount = available.filter((c) => c.current_status !== "declined").length;

  async function send(mode: "selected" | "all" | "direct") {
    setBusy(mode);
    setError(null);
    try {
      const r = await api<{ sent: number; skipped: { reason: string }[] }>("POST", `/admin/positions/${position.id}/offers`, {
        worker_ids: [...sel],
        all: mode === "all",
        direct: mode === "direct",
      });
      if (r.skipped.length) {
        setResult(`${mode === "direct" ? "Booked" : "Sent"} ${r.sent}. Skipped ${r.skipped.length}: ${r.skipped.map((s) => s.reason).join("; ")}`);
        setBusy(null);
      } else onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  return (
    <Modal open onClose={onClose} title={`${position.role} · ${open} open ${open === 1 ? "spot" : "spots"}`} wide>
      <p className="mb-3 text-sm text-ink/60">
        Offers go out as push notifications. First come, first served: once the spots fill, later acceptances go on standby and move up automatically if someone drops.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Button variant="secondary" size="sm" onClick={() => setSel(new Set(shown.map((c) => c.id)))}>Select all</Button>
        <Button variant="ghost" size="sm" onClick={() => setSel(new Set())}>Clear</Button>
        <span className="text-xs text-ink/50">{alreadyIn} already offered/booked</span>
      </div>
      {!data ? (
        <Loading />
      ) : shown.length === 0 ? (
        <Empty>No more qualified workers. Add the {position.role} role to more people in the labor pool.</Empty>
      ) : (
        <ul className="max-h-[45vh] divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {shown.map((c) => (
            <li key={c.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-paper">
                <input
                  type="checkbox"
                  checked={sel.has(c.id)}
                  onChange={(e) => {
                    const s = new Set(sel);
                    if (e.target.checked) s.add(c.id);
                    else s.delete(c.id);
                    setSel(s);
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    {c.first_name} {c.last_name}
                    {c.preferred && <Badge tone="violet">★ Preferred</Badge>}
                    {c.current_status === "declined" && <Badge>Declined before</Badge>}
                  </div>
                  {c.same_day.length > 0 && <div className="text-xs text-amber-700">Also booked today: {c.same_day.join(", ")}</div>}
                </div>
                <span className="text-xs text-ink/45">{c.phone}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {result && <div className="mt-3 rounded-lg bg-paper px-3 py-2 text-sm">{result}</div>}
      <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>
      <div className="mt-4 flex flex-wrap justify-between gap-2">
        <Button variant="secondary" busy={busy === "all"} disabled={freshCount === 0} onClick={() => send("all")}>
          Send to all {freshCount} qualified
        </Button>
        <div className="flex gap-2">
          <Button variant="secondary" busy={busy === "direct"} disabled={sel.size === 0 || sel.size > open} onClick={() => send("direct")} title="Book them without asking">
            Book directly
          </Button>
          <Button busy={busy === "selected"} disabled={sel.size === 0} onClick={() => send("selected")}>
            Send offer to {sel.size || ""} selected
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function AddPositionModal({ open, callId, jobId, onClose, onSaved }: { open: boolean; callId: number; jobId: number; onClose: () => void; onSaved: () => void }) {
  const { data: roles } = useData<{ id: number; name: string; active: number }[]>(open ? "/admin/roles" : null);
  const { data: job } = useData<{ rates: { role_id: number; pay_rate: number }[] }>(open ? `/admin/jobs/${jobId}` : null);
  const [roleId, setRoleId] = useState("");
  const [qty, setQty] = useState("1");
  const [rate, setRate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const existing = job?.rates.find((r) => r.role_id === Number(roleId));
  return (
    <Modal open={open} onClose={onClose} title="Add a position">
      <div className="space-y-3">
        <Field label="Role">
          <select className="w-full rounded-lg border border-line px-3 py-2 text-sm" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="">Select…</option>
            {(roles ?? []).filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <Field label="How many"><Input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        {roleId && !existing && (
          <Field label="Hourly pay for this role on this job" hint="This role doesn't have a rate on this job yet.">
            <Input type="number" min="0" step="0.25" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0.00" />
          </Field>
        )}
        {existing && <div className="text-sm text-ink/60">Pays {money(existing.pay_rate)}/hr on this job.</div>}
        <ErrorNote>{error}</ErrorNote>
        <div className="flex justify-end">
          <Button
            disabled={!roleId}
            onClick={async () => {
              try {
                setError(null);
                await api("POST", `/admin/calls/${callId}/positions`, { role_id: Number(roleId), quantity: Number(qty), ...(existing ? {} : { pay_rate: Number(rate) }) });
                setRoleId("");
                setRate("");
                onSaved();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Add position
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function EditTimeModal({ row, callId, live, onClose, onSaved }: { row: RosterRow; callId: number; live: boolean; onClose: () => void; onSaved: () => void }) {
  const [inV, setIn] = useState(toLocalInput(row.clock_in));
  const [outV, setOut] = useState(toLocalInput(row.clock_out));
  const [noShow, setNoShow] = useState(row.no_show);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title={`Edit time · ${row.first_name} ${row.last_name}`}>
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={noShow} onChange={(e) => setNoShow(e.target.checked)} /> No-show (didn&apos;t come to work)
        </label>
        {!noShow && (
          <>
            <Field label="Clock in"><Input type="datetime-local" value={inV} onChange={(e) => setIn(e.target.value)} /></Field>
            <Field label="Clock out" hint={live ? "Leave empty if they're still working." : undefined}>
              <Input type="datetime-local" value={outV} onChange={(e) => setOut(e.target.value)} />
            </Field>
          </>
        )}
        <p className="text-xs text-ink/50">Every change is recorded in the call&apos;s activity log.</p>
        <ErrorNote>{error}</ErrorNote>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={async () => {
              try {
                setError(null);
                await api("PATCH", `/calls/${callId}/workers/${row.worker_id}`, noShow ? { no_show: true } : { no_show: false, clock_in: fromLocalInput(inV), clock_out: fromLocalInput(outV) });
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
    </Modal>
  );
}
