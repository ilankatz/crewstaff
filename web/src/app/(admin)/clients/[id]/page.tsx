"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api, useData } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Textarea } from "@/components/ui";
import { ClientForm } from "@/components/client-form";

type Contact = { id: number; name: string; title: string; email: string; phone: string; is_billing: number };
type Venue = { id: number; name: string; address: string; notes: string };
type Detail = {
  id: number; name: string; phone: string; email: string; billing_address: string; payment_terms: string; notes: string; status: string;
  job_count: number; contact_count: number; venue_count: number;
  contacts: Contact[]; venues: Venue[];
  flags: { worker_id: number; flag: string; first_name: string; last_name: string }[];
  jobs: { id: number; name: string; status: string; first_date: string | null; last_date: string | null }[];
};

export default function ClientPage() {
  const { id } = useParams<{ id: string }>();
  const { data: c, reload } = useData<Detail>(`/admin/clients/${id}`);
  const [editing, setEditing] = useState(false);
  const [contact, setContact] = useState<Contact | "new" | null>(null);
  const [venue, setVenue] = useState<Venue | "new" | null>(null);
  const [flagging, setFlagging] = useState<"preferred" | "banned" | null>(null);
  if (!c) return <Loading />;
  return (
    <>
      <PageHeader
        back={{ href: "/clients", label: "Clients" }}
        title={<span className="flex items-center gap-2">{c.name} {c.status !== "active" && <Badge>inactive</Badge>}</span>}
        subtitle={[c.phone, c.email, c.payment_terms].filter(Boolean).join(" · ")}
        actions={<Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Contacts" actions={<Button size="sm" variant="secondary" onClick={() => setContact("new")}>＋ Contact</Button>} pad={false}>
          {c.contacts.length === 0 ? <div className="p-4"><Empty>No contacts.</Empty></div> : (
            <ul className="divide-y divide-line">
              {c.contacts.map((x) => (
                <li key={x.id}>
                  <button className="block w-full px-4 py-2.5 text-left hover:bg-paper" onClick={() => setContact(x)}>
                    <div className="flex items-center gap-2 text-sm font-medium">{x.name} {x.is_billing ? <Badge tone="blue">Billing</Badge> : null}</div>
                    <div className="text-xs text-ink/55">{[x.title, x.email, x.phone].filter(Boolean).join(" · ")}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Venues" actions={<Button size="sm" variant="secondary" onClick={() => setVenue("new")}>＋ Venue</Button>} pad={false}>
          {c.venues.length === 0 ? <div className="p-4"><Empty>No saved venues.</Empty></div> : (
            <ul className="divide-y divide-line">
              {c.venues.map((v) => (
                <li key={v.id}>
                  <button className="block w-full px-4 py-2.5 text-left hover:bg-paper" onClick={() => setVenue(v)}>
                    <div className="text-sm font-medium">{v.name}</div>
                    <div className="text-xs text-ink/55">{v.address}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card
          title="Preferred & banned crew"
          actions={<>
            <Button size="sm" variant="secondary" onClick={() => setFlagging("preferred")}>＋ Preferred</Button>
            <Button size="sm" variant="danger" onClick={() => setFlagging("banned")}>＋ Banned</Button>
          </>}
          pad={false}
        >
          <p className="px-4 pt-3 text-xs text-ink/55">Preferred workers are listed first when offering this client&apos;s calls. Banned workers never appear.</p>
          {c.flags.length === 0 ? <div className="p-4"><Empty>None set.</Empty></div> : (
            <ul className="divide-y divide-line">
              {c.flags.map((f) => (
                <li key={f.worker_id} className="flex items-center justify-between px-4 py-2.5">
                  <Link href={`/workers/${f.worker_id}`} className="text-sm hover:text-accent">{f.first_name} {f.last_name}</Link>
                  <div className="flex items-center gap-2">
                    <Badge tone={f.flag === "banned" ? "red" : "violet"}>{f.flag === "banned" ? "Banned" : "★ Preferred"}</Badge>
                    <button className="text-ink/30 hover:text-red-700" title="Clear" onClick={async () => {
                      await api("PUT", `/admin/clients/${c.id}/flags/${f.worker_id}`, { flag: "none" });
                      void reload();
                    }}>✕</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Jobs" actions={<Link href="/jobs/new" className="text-xs text-ink/50 hover:text-ink">New job →</Link>} pad={false}>
          {c.jobs.length === 0 ? <div className="p-4"><Empty>No jobs yet.</Empty></div> : (
            <ul className="divide-y divide-line">
              {c.jobs.map((j) => (
                <li key={j.id}>
                  <Link href={`/jobs/${j.id}`} className="flex justify-between px-4 py-2.5 text-sm hover:bg-paper">
                    <span className="font-medium">{j.name}</span>
                    <span className="text-ink/55">{fmtDate(j.first_date)} {j.status !== "active" && <Badge>{j.status}</Badge>}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {c.billing_address && <p className="mt-6 whitespace-pre-line text-sm text-ink/60"><b>Billing address:</b> {c.billing_address}</p>}
      {c.notes && <p className="mt-2 whitespace-pre-line text-sm text-ink/60"><b>Notes:</b> {c.notes}</p>}

      {editing && <ClientForm client={c} onClose={() => setEditing(false)} onSaved={reload} />}
      {contact && <ContactModal clientId={c.id} contact={contact === "new" ? null : contact} onClose={() => setContact(null)} onSaved={() => { setContact(null); void reload(); }} />}
      {venue && <VenueModal clientId={c.id} venue={venue === "new" ? null : venue} onClose={() => setVenue(null)} onSaved={() => { setVenue(null); void reload(); }} />}
      {flagging && <FlagModal clientId={c.id} flag={flagging} onClose={() => setFlagging(null)} onSaved={() => { setFlagging(null); void reload(); }} />}
    </>
  );
}

function ContactModal({ clientId, contact, onClose, onSaved }: { clientId: number; contact: Contact | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: contact?.name ?? "", title: contact?.title ?? "", email: contact?.email ?? "", phone: contact?.phone ?? "", is_billing: !!contact?.is_billing });
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title={contact ? "Edit contact" : "New contact"}>
      <div className="space-y-3">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="Title / role"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Production manager" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email"><Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_billing} onChange={(e) => setF({ ...f, is_billing: e.target.checked })} /> Billing contact (invoices go to them)</label>
        <ErrorNote>{error}</ErrorNote>
        <div className="flex justify-between gap-2">
          {contact ? <Button variant="danger" onClick={async () => { if (confirm("Delete this contact?")) { await api("DELETE", `/admin/contacts/${contact.id}`); onSaved(); } }}>Delete</Button> : <span />}
          <Button onClick={async () => {
            try {
              if (contact) await api("PATCH", `/admin/contacts/${contact.id}`, f);
              else await api("POST", `/admin/clients/${clientId}/contacts`, f);
              onSaved();
            } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
          }}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}

function VenueModal({ clientId, venue, onClose, onSaved }: { clientId: number; venue: Venue | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: venue?.name ?? "", address: venue?.address ?? "", notes: venue?.notes ?? "" });
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title={venue ? "Edit venue" : "New venue"}>
      <div className="space-y-3">
        <Field label="Venue name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus placeholder="SoFi Stadium" /></Field>
        <Field label="Address"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label="Notes" hint="Parking, entrance, loading dock…"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <ErrorNote>{error}</ErrorNote>
        <div className="flex justify-between gap-2">
          {venue ? <Button variant="danger" onClick={async () => {
            if (!confirm("Delete this venue?")) return;
            try { await api("DELETE", `/admin/venues/${venue.id}`); onSaved(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
          }}>Delete</Button> : <span />}
          <Button onClick={async () => {
            try {
              if (venue) await api("PATCH", `/admin/venues/${venue.id}`, f);
              else await api("POST", "/admin/venues", { ...f, client_id: clientId });
              onSaved();
            } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
          }}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}

function FlagModal({ clientId, flag, onClose, onSaved }: { clientId: number; flag: "preferred" | "banned"; onClose: () => void; onSaved: () => void }) {
  const { data } = useData<{ id: number; first_name: string; last_name: string; roles: string | null }[]>("/admin/workers");
  const [q, setQ] = useState("");
  const rows = (data ?? []).filter((w) => !q || `${w.first_name} ${w.last_name}`.toLowerCase().includes(q.toLowerCase())).slice(0, 50);
  return (
    <Modal open onClose={onClose} title={flag === "banned" ? "Ban a worker from this client" : "Mark a preferred worker"}>
      <Input placeholder="Search workers…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <ul className="mt-3 max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line">
        {rows.map((w) => (
          <li key={w.id}>
            <button className="block w-full px-3 py-2 text-left hover:bg-paper" onClick={async () => {
              await api("PUT", `/admin/clients/${clientId}/flags/${w.id}`, { flag });
              onSaved();
            }}>
              <div className="text-sm font-medium">{w.first_name} {w.last_name}</div>
              <div className="text-xs text-ink/50">{w.roles}</div>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
