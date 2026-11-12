"use client";

import { useState } from "react";
import { useData } from "@/lib/api";
import { fmtDate, money, todayYmd } from "@/lib/format";
import { Card, Empty, Field, Input, Loading, PageHeader, td, th } from "@/components/ui";

type Payroll = {
  summary: { week_start: string; worker_id: number; name: string; email: string; phone: string; shifts: number; hours: number; gross: number }[];
  totals: { hours: number; gross: number };
  unapproved_calls: number;
};

function lastMonday() {
  const d = new Date();
  const dow = (d.getDay() + 6) % 7;
  return todayYmd(-dow - 7);
}

export default function PayrollPage() {
  const [from, setFrom] = useState(lastMonday());
  const [to, setTo] = useState(() => {
    const d = new Date(`${lastMonday()}T12:00:00`);
    d.setDate(d.getDate() + 6);
    return d.toISOString().slice(0, 10);
  });
  const { data } = useData<Payroll>(from && to ? `/admin/payroll?from=${from}&to=${to}` : null);
  const qs = `from=${from}&to=${to}`;
  return (
    <>
      <PageHeader
        title="Payroll export"
        subtitle="Approved hours × job pay rate, per worker per week (Mon–Sun). Download the CSV for your payroll provider."
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <a href={`/api/admin/payroll.csv?${qs}`} className="rounded-lg bg-ink px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-ink/90">⇩ Summary CSV</a>
        <a href={`/api/admin/payroll.csv?${qs}&detail=1`} className="rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-medium shadow-sm hover:bg-paper">⇩ Detail CSV (every shift)</a>
      </div>
      {data && data.unapproved_calls > 0 && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {data.unapproved_calls} call{data.unapproved_calls === 1 ? "" : "s"} in this range {data.unapproved_calls === 1 ? "is" : "are"} not approved yet and {data.unapproved_calls === 1 ? "isn't" : "aren't"} included.
        </div>
      )}
      {!data ? <Loading /> : data.summary.length === 0 ? <Empty>No approved hours in this date range.</Empty> : (
        <Card pad={false} title={`${data.summary.length} worker-weeks`} actions={<span className="text-sm tabular-nums">{data.totals.hours.toFixed(2)} h · <b>{money(data.totals.gross)}</b> gross</span>}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line bg-paper/60">
                <tr>
                  <th className={th}>Week of</th>
                  <th className={th}>Worker</th>
                  <th className={`${th} text-right`}>Shifts</th>
                  <th className={`${th} text-right`}>Hours</th>
                  <th className={`${th} text-right`}>Gross pay</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.summary.map((s) => (
                  <tr key={`${s.week_start}-${s.worker_id}`}>
                    <td className={td}>{fmtDate(s.week_start)}</td>
                    <td className={td}>{s.name}<div className="text-xs text-ink/50">{s.email}</div></td>
                    <td className={`${td} text-right tabular-nums`}>{s.shifts}</td>
                    <td className={`${td} text-right tabular-nums`}>{s.hours.toFixed(2)}</td>
                    <td className={`${td} text-right font-medium tabular-nums`}>{money(s.gross)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <p className="mt-4 text-xs text-ink/50">No overtime rules are applied yet; hours are straight time at each job&apos;s role rate.</p>
    </>
  );
}
