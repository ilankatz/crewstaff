"use client";

import Link from "next/link";
import { useData } from "@/lib/api";
import { fmtDate, money } from "@/lib/format";
import { Badge, Card, Empty, Loading, PageHeader, td, th } from "@/components/ui";

type Inv = { id: number; number: string; status: string; issue_date: string; due_date: string; total: number; labor_cost: number; markup_pct: number; job_id: number; job_name: string; client_name: string };
const INV_TONE = { draft: "slate", sent: "amber", paid: "violet" } as const;

export default function InvoicesPage() {
  const { data } = useData<Inv[]>("/admin/invoices");
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="Invoices" subtitle="One invoice per job. Create them from a job's Billing tab once every call is approved." />
      {!data ? <Loading /> : data.length === 0 ? <Empty>No invoices yet.</Empty> : (
        <Card pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line bg-paper/60">
                <tr>
                  <th className={th}>Invoice</th>
                  <th className={th}>Client / job</th>
                  <th className={th}>Issued</th>
                  <th className={th}>Due</th>
                  <th className={`${th} text-right`}>Markup</th>
                  <th className={`${th} text-right`}>Total</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.map((i) => (
                  <tr key={i.id} className="hover:bg-paper/60">
                    <td className={td}><Link href={`/invoices/${i.id}`} className="font-medium hover:text-accent">{i.number}</Link></td>
                    <td className={td}>{i.client_name}<div className="text-xs text-ink/50">{i.job_name}</div></td>
                    <td className={`${td} whitespace-nowrap`}>{fmtDate(i.issue_date)}</td>
                    <td className={`${td} whitespace-nowrap`}>{fmtDate(i.due_date)}</td>
                    <td className={`${td} text-right tabular-nums`}>{i.markup_pct}%</td>
                    <td className={`${td} text-right font-medium tabular-nums`}>{money(i.total)}</td>
                    <td className={td}>
                      <Badge tone={INV_TONE[i.status as keyof typeof INV_TONE] ?? "slate"}>{i.status}</Badge>
                      {i.status === "sent" && i.due_date < today && <> <Badge tone="red">overdue</Badge></>}
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
