"use client";

import Link from "next/link";
import { useData } from "@/lib/api";
import { CALL_STATUS, fmtDate, fmtTime, money } from "@/lib/format";
import { Badge, Card, Empty, LinkButton, Loading, PageHeader, Stat, cx } from "@/components/ui";

type CallRow = {
  id: number; name: string; call_date: string; start_time: string; end_time: string | null; status: string;
  job_id: number; job_name: string; client_name: string; venue_name: string | null;
  needed: number; filled: number; pending_offers: number; on_clock?: number;
};
type Dash = {
  live: CallRow[]; upcoming: CallRow[]; awaiting: CallRow[];
  docs: { id: number; title: string; expires_on: string; worker_id: number; first_name: string; last_name: string }[];
  readyToBill: { id: number; name: string; client_name: string }[];
  counts: { workers: number; jobs: number; unpaid_invoices: number; unpaid_total: number };
};

function Fill({ filled, needed }: { filled: number; needed: number }) {
  const pct = needed ? Math.min(100, Math.round((filled / needed) * 100)) : 0;
  const full = filled >= needed && needed > 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-ink/10">
        <div className={cx("h-full rounded-full", full ? "bg-emerald-500" : "bg-accent")} style={{ width: `${pct}%` }} />
      </div>
      <span className={cx("text-xs tabular-nums", full ? "text-emerald-700" : "text-ink/70")}>
        {filled}/{needed}
      </span>
    </div>
  );
}

function CallList({ rows, live }: { rows: CallRow[]; live?: boolean }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((c) => (
        <li key={c.id}>
          <Link href={`/calls/${c.id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-paper">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">
                {c.job_name} <span className="text-ink/50">· {c.name}</span>
              </div>
              <div className="text-xs text-ink/55">
                {fmtDate(c.call_date)} {fmtTime(c.start_time)} · {c.client_name}
                {c.venue_name ? ` · ${c.venue_name}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {live ? (
                <Badge tone={c.status === "in_progress" ? "green" : "amber"} dot={c.status === "in_progress"}>
                  {c.status === "in_progress" ? `${c.on_clock} on the clock` : "Ended"}
                </Badge>
              ) : (
                <>
                  {c.pending_offers > 0 && <span className="text-xs text-ink/50">{c.pending_offers} offers out</span>}
                  <Fill filled={c.filled} needed={c.needed} />
                </>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function Dashboard() {
  const { data } = useData<Dash>("/admin/dashboard", 10000);
  if (!data) return <Loading />;
  const short = data.upcoming.filter((c) => c.filled < c.needed).length;
  return (
    <>
      <PageHeader title="Dashboard" subtitle="What's happening now and next" actions={<LinkButton href="/jobs/new">+ New job</LinkButton>} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Live calls" value={data.live.filter((c) => c.status === "in_progress").length} />
        <Stat label="Short-staffed (14 days)" value={short} tone={short ? "warn" : undefined} />
        <Stat label="Need approval" value={data.awaiting.length} tone={data.awaiting.length ? "warn" : undefined} />
        <Stat label="Unpaid invoices" value={money(data.counts.unpaid_total)} href="/invoices" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {data.live.length > 0 && (
            <Card title="On site now" pad={false}>
              <CallList rows={data.live} live />
            </Card>
          )}
          <Card title="Upcoming calls · next 14 days" pad={false} actions={<Link href="/jobs" className="text-xs text-ink/50 hover:text-ink">All jobs →</Link>}>
            {data.upcoming.length ? <CallList rows={data.upcoming} /> : <div className="p-4"><Empty>No calls scheduled in the next two weeks.</Empty></div>}
          </Card>
        </div>
        <div className="min-w-0 space-y-6">
          <Card title="Timesheets to approve" pad={false}>
            {data.awaiting.length ? (
              <ul className="divide-y divide-line">
                {data.awaiting.map((c) => (
                  <li key={c.id}>
                    <Link href={`/calls/${c.id}`} className="block px-4 py-3 hover:bg-paper">
                      <div className="text-sm font-medium">{c.job_name}</div>
                      <div className="text-xs text-ink/55">
                        {c.name} · {fmtDate(c.call_date)} · <Badge tone={CALL_STATUS.signed_off.tone}>Signed off</Badge>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-4 text-sm text-ink/50">Nothing waiting. Signed-off timesheets show up here.</div>
            )}
          </Card>
          <Card title="Ready to bill" pad={false}>
            {data.readyToBill.length ? (
              <ul className="divide-y divide-line">
                {data.readyToBill.map((j) => (
                  <li key={j.id}>
                    <Link href={`/jobs/${j.id}?tab=billing`} className="block px-4 py-3 hover:bg-paper">
                      <div className="text-sm font-medium">{j.name}</div>
                      <div className="text-xs text-ink/55">{j.client_name} · all timesheets approved</div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-4 text-sm text-ink/50">Jobs appear here once every call is approved.</div>
            )}
          </Card>
          <Card title="Documents expiring" pad={false}>
            {data.docs.length ? (
              <ul className="divide-y divide-line">
                {data.docs.map((d) => {
                  const expired = d.expires_on < new Date().toISOString().slice(0, 10);
                  return (
                    <li key={d.id}>
                      <Link href={`/workers/${d.worker_id}`} className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-paper">
                        <div className="min-w-0">
                          <div className="truncate text-sm">{d.first_name} {d.last_name}</div>
                          <div className="truncate text-xs text-ink/55">{d.title}</div>
                        </div>
                        <Badge tone={expired ? "red" : "amber"}>{expired ? "Expired" : "Expires"} {fmtDate(d.expires_on)}</Badge>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="p-4 text-sm text-ink/50">No certifications expiring in the next 30 days.</div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
