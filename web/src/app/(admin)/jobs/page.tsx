"use client";

import Link from "next/link";
import { useState } from "react";
import { useData } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { Badge, Card, Empty, LinkButton, Loading, PageHeader, cx, td, th } from "@/components/ui";

type JobRow = {
  id: number; name: string; status: string; client_name: string; venue_name: string | null; first_date: string | null; last_date: string | null;
  call_count: number; needed: number; filled: number; awaiting_approval: number; live_calls: number; invoice_status: string | null; invoice_id: number | null;
};

const TABS = [
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
];

export default function JobsPage() {
  const [status, setStatus] = useState("active");
  const [q, setQ] = useState("");
  const { data } = useData<JobRow[]>(`/admin/jobs?status=${status}`, 15000);
  const rows = (data ?? []).filter((j) => !q || `${j.name} ${j.client_name} ${j.venue_name ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHeader title="Jobs" actions={<LinkButton href="/jobs/new">+ New job</LinkButton>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-line bg-white p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setStatus(t.key)}
              className={cx("rounded-md px-3 py-1.5 text-sm font-medium", status === t.key ? "bg-ink text-white" : "text-ink/60 hover:text-ink")}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search jobs, clients, venues…"
          className="w-full max-w-xs rounded-lg border border-line bg-white px-3 py-2 text-sm"
        />
      </div>
      {!data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>
          No jobs here yet. <Link className="font-medium text-accent" href="/jobs/new">Create a job</Link>
        </Empty>
      ) : (
        <Card pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line bg-paper/60">
                <tr>
                  <th className={th}>Job</th>
                  <th className={th}>Dates</th>
                  <th className={th}>Calls</th>
                  <th className={th}>Crew</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((j) => (
                  <tr key={j.id} className="hover:bg-paper/60">
                    <td className={td}>
                      <Link href={`/jobs/${j.id}`} className="font-medium hover:text-accent">
                        {j.name}
                      </Link>
                      <div className="text-xs text-ink/55">
                        {j.client_name}
                        {j.venue_name ? ` · ${j.venue_name}` : ""}
                      </div>
                    </td>
                    <td className={cx(td, "whitespace-nowrap")}>
                      {fmtDate(j.first_date)}
                      {j.last_date && j.last_date !== j.first_date ? ` – ${fmtDate(j.last_date)}` : ""}
                    </td>
                    <td className={td}>{j.call_count}</td>
                    <td className={cx(td, "tabular-nums")}>
                      <span className={j.filled >= j.needed ? "text-emerald-700" : "text-accent"}>{j.filled}</span>
                      <span className="text-ink/40"> / {j.needed}</span>
                    </td>
                    <td className={td}>
                      <div className="flex flex-wrap gap-1">
                        {j.live_calls > 0 && <Badge tone="green" dot>Live</Badge>}
                        {j.awaiting_approval > 0 && <Badge tone="blue">{j.awaiting_approval} to approve</Badge>}
                        {j.invoice_status && <Badge tone={j.invoice_status === "paid" ? "violet" : "amber"}>Invoice {j.invoice_status}</Badge>}
                        {j.status !== "active" && <Badge>{j.status}</Badge>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
