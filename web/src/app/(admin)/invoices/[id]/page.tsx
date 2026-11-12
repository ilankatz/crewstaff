"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { api, useData } from "@/lib/api";
import { fmtDate, money } from "@/lib/format";
import { Badge, Button, ErrorNote, Field, Input, Loading, Select, Textarea, cx } from "@/components/ui";

type Line = { id: number; description: string; hours: number; pay_rate: number; bill_rate: number; amount: number };
type Invoice = {
  id: number; number: string; status: "draft" | "sent" | "paid"; markup_pct: number; issue_date: string; due_date: string; terms: string; notes: string;
  labor_cost: number; total: number; job_id: number; job_name: string; client_id: number; client_name: string; billing_address: string;
  client_email: string; client_phone: string; venue_name: string | null; venue_address: string | null; contact_name: string | null; contact_email: string | null;
  lines: Line[];
};
const TONE = { draft: "slate", sent: "amber", paid: "violet" } as const;

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: inv, reload } = useData<Invoice>(`/admin/invoices/${id}`);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (!inv) return <Loading />;
  const draft = inv.status === "draft";

  async function patch(key: string, body: Record<string, unknown>) {
    setBusy(key);
    setError(null);
    try {
      await api("PATCH", `/admin/invoices/${inv!.id}`, body);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-6">
        <Link href="/invoices" className="mb-2 inline-block text-xs font-medium text-ink/50 hover:text-ink">← Invoices</Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-3 text-2xl font-semibold">{inv.number} <Badge tone={TONE[inv.status]}>{inv.status}</Badge></h1>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => window.print()}>Print / Save PDF</Button>
            <a href={`/api/admin/invoices/${inv.id}/quickbooks.iif`} className="rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-medium shadow-sm hover:bg-paper" title="QuickBooks Desktop import file (File → Utilities → Import → IIF Files)">
              ⇩ QuickBooks (.iif)
            </a>
            {inv.status === "draft" && <Button busy={busy === "sent"} onClick={() => patch("sent", { status: "sent" })}>Mark as sent</Button>}
            {inv.status === "sent" && (
              <>
                <Button variant="secondary" busy={busy === "draft"} onClick={() => patch("draft", { status: "draft" })}>Back to draft</Button>
                <Button variant="success" busy={busy === "paid"} onClick={() => patch("paid", { status: "paid" })}>Mark as paid</Button>
              </>
            )}
            {inv.status === "paid" && <Button variant="secondary" busy={busy === "unpaid"} onClick={() => patch("unpaid", { status: "sent" })}>Mark unpaid</Button>}
          </div>
        </div>
        {draft && (
          <DraftEditor
            key={`${inv.markup_pct}|${inv.terms}|${inv.issue_date}|${inv.notes}`}
            inv={inv}
            busy={busy === "save"}
            onSave={(body) => patch("save", body)}
            onDelete={async () => {
              if (!confirm("Delete this draft invoice?")) return;
              await api("DELETE", `/admin/invoices/${inv.id}`);
              router.push(`/jobs/${inv.job_id}?tab=billing`);
            }}
          />
        )}
        <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>
      </div>
      <InvoiceDocument inv={inv} />
    </div>
  );
}

function DraftEditor({ inv, busy, onSave, onDelete }: { inv: Invoice; busy: boolean; onSave: (b: Record<string, unknown>) => void; onDelete: () => void }) {
  const [markup, setMarkup] = useState(String(inv.markup_pct));
  const [terms, setTerms] = useState(inv.terms);
  const [issue, setIssue] = useState(inv.issue_date);
  const [notes, setNotes] = useState(inv.notes);
  return (
          <div className="mt-4 rounded-xl border border-line bg-white p-4 shadow-sm">
            <div className="grid gap-3 md:grid-cols-5">
              <Field label="Markup %">
                <Input type="number" min="0" step="0.5" value={markup} onChange={(e) => setMarkup(e.target.value)} />
              </Field>
              <Field label="Terms">
                <Select value={terms} onChange={(e) => setTerms(e.target.value)}>
                  {["Due on receipt", "Net 10", "Net 15", "Net 30", "Net 45", "Net 60"].map((t) => <option key={t}>{t}</option>)}
                </Select>
              </Field>
              <Field label="Invoice date"><Input type="date" value={issue} onChange={(e) => setIssue(e.target.value)} /></Field>
              <Field label="Note on invoice" className="md:col-span-2"><Textarea rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <Button variant="danger" size="sm" onClick={onDelete}>Delete draft</Button>
              <div className="flex items-center gap-3">
                <span className="text-xs text-ink/50">Drafts update automatically if approved hours change.</span>
                <Button busy={busy} onClick={() => onSave({ markup_pct: Number(markup), terms, issue_date: issue, notes })}>Update invoice</Button>
              </div>
            </div>
          </div>
  );
}

function InvoiceDocument({ inv }: { inv: Invoice }) {
  return (
    <>
      <article className="print-area rounded-xl border border-line bg-white p-8 shadow-sm md:p-12">
        <header className="flex flex-wrap justify-between gap-6">
          <div>
            <div className="text-2xl font-bold tracking-tight">Crew<span className="text-accent">Staff</span></div>
            <div className="mt-1 text-sm text-ink/55">Event labor services</div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-light tracking-tight">INVOICE</div>
            <div className="mt-1 text-sm"><span className="text-ink/50">No.</span> <b>{inv.number}</b></div>
            <div className="text-sm"><span className="text-ink/50">Date</span> {fmtDate(inv.issue_date, true)}</div>
            <div className="text-sm"><span className="text-ink/50">Due</span> {fmtDate(inv.due_date, true)} · {inv.terms}</div>
          </div>
        </header>

        <section className="mt-10 grid gap-6 md:grid-cols-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-ink/45">Bill to</div>
            <div className="mt-1 font-semibold">{inv.client_name}</div>
            {inv.contact_name && <div className="text-sm">Attn: {inv.contact_name}</div>}
            {inv.billing_address && <div className="whitespace-pre-line text-sm text-ink/70">{inv.billing_address}</div>}
            <div className="text-sm text-ink/70">{inv.contact_email || inv.client_email}</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-ink/45">Job</div>
            <div className="mt-1 font-semibold">{inv.job_name}</div>
            {inv.venue_name && <div className="text-sm">{inv.venue_name}</div>}
            {inv.venue_address && <div className="text-sm text-ink/70">{inv.venue_address}</div>}
          </div>
        </section>

        <table className="mt-10 w-full text-sm">
          <thead>
            <tr className="border-b-2 border-ink">
              <th className="py-2 text-left font-semibold">Description</th>
              <th className="py-2 text-right font-semibold">Hours</th>
              <th className="py-2 text-right font-semibold">Rate</th>
              <th className="py-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.id} className="border-b border-line">
                <td className="py-2.5 pr-4">{l.description}</td>
                <td className="py-2.5 text-right tabular-nums">{l.hours.toFixed(2)}</td>
                <td className="py-2.5 text-right tabular-nums">{money(l.bill_rate)}</td>
                <td className="py-2.5 text-right tabular-nums">{money(l.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="pt-4 text-right font-semibold">Total due</td>
              <td className="pt-4 text-right text-xl font-semibold tabular-nums">{money(inv.total)}</td>
            </tr>
          </tfoot>
        </table>
        {inv.notes && <p className="mt-8 whitespace-pre-line text-sm text-ink/70">{inv.notes}</p>}
        <p className="mt-10 text-xs text-ink/45">Thank you for your business. Please reference {inv.number} with your payment.</p>
      </article>

      <div className={cx("no-print mt-4 rounded-lg bg-white px-4 py-3 text-sm ring-1 ring-line")}>
        <span className="text-ink/55">Internal only — </span>labor cost {money(inv.labor_cost)} · markup {inv.markup_pct}% · margin <b>{money(inv.total - inv.labor_cost)}</b>
      </div>
    </>
  );
}
