"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, useData } from "@/lib/api";
import { todayYmd } from "@/lib/format";
import { Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Select, Textarea } from "@/components/ui";

type Role = { id: number; name: string; is_steward: number; active: number };
type Client = { id: number; name: string; status: string };
type ClientDetail = { contacts: { id: number; name: string; is_billing: number }[]; venues: { id: number; name: string; address: string }[] };
type Venue = { id: number; name: string; address: string; client_id: number | null; client_name: string | null };

type RateRow = { role_id: number; pay_rate: string };
type CallDraft = { key: number; name: string; call_date: string; start_time: string; end_time: string; notes: string; qty: Record<number, string> };

let keySeq = 1;
const newCall = (date: string, name = "Load-in"): CallDraft => ({ key: keySeq++, name, call_date: date, start_time: "08:00", end_time: "", notes: "", qty: {} });

function nextDay(d: string) {
  const x = new Date(`${d}T12:00:00`);
  x.setDate(x.getDate() + 1);
  return x.toISOString().slice(0, 10);
}

export default function NewJobPage() {
  const router = useRouter();
  const { data: roles } = useData<Role[]>("/admin/roles");
  const { data: clients, reload: reloadClients } = useData<Client[]>("/admin/clients");
  const { data: allVenues } = useData<Venue[]>("/admin/venues");

  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const { data: client } = useData<ClientDetail>(clientId ? `/admin/clients/${clientId}` : null);
  const [venueChoice, setVenueChoice] = useState(""); // id | "new" | ""
  const [newVenue, setNewVenue] = useState({ name: "", address: "" });
  const [contactChoice, setContactId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [ratesState, setRatesState] = useState<RateRow[] | null>(null);
  const [calls, setCalls] = useState<CallDraft[]>([newCall(todayYmd(1))]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clientModal, setClientModal] = useState(false);

  const activeRoles = useMemo(() => (roles ?? []).filter((r) => r.active), [roles]);
  const roleName = (id: number) => roles?.find((r) => r.id === id)?.name ?? "";

  // Until edited, the rate table starts with the Steward role — every call needs one.
  const stewardRole = roles?.find((r) => r.is_steward);
  const defaultRates = useMemo<RateRow[]>(() => (stewardRole ? [{ role_id: stewardRole.id, pay_rate: "" }] : []), [stewardRole]);
  const rates = ratesState ?? defaultRates;
  const setRates = (fn: (rs: RateRow[]) => RateRow[]) => setRatesState((cur) => fn(cur ?? defaultRates));

  // Until chosen, the contact defaults to the client's billing contact.
  const contactId = contactChoice ?? String(client?.contacts.find((c) => c.is_billing)?.id ?? client?.contacts[0]?.id ?? "");

  const unusedRoles = activeRoles.filter((r) => !rates.some((x) => x.role_id === r.id));
  const venueOptions = useMemo(() => {
    const own = client?.venues ?? [];
    const others = (allVenues ?? []).filter((v) => !own.some((o) => o.id === v.id));
    return { own, others };
  }, [client, allVenues]);

  const updateCall = (key: number, patch: Partial<CallDraft>) => setCalls((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  async function submit() {
    setError(null);
    const rateBody = rates.map((r) => ({ role_id: r.role_id, pay_rate: Number(r.pay_rate) }));
    if (!name.trim()) return setError("Give the job a name.");
    if (!clientId) return setError("Pick a client.");
    if (!rateBody.length) return setError("Add at least one role with a pay rate.");
    const badRate = rates.find((r) => r.pay_rate === "" || !(Number(r.pay_rate) >= 0));
    if (badRate) return setError(`Enter an hourly pay rate for ${roleName(badRate.role_id)}.`);
    const callBody = calls.map((c) => ({
      name: c.name.trim(),
      call_date: c.call_date,
      start_time: c.start_time,
      end_time: c.end_time || null,
      notes: c.notes,
      positions: Object.entries(c.qty)
        .map(([role_id, q]) => ({ role_id: Number(role_id), quantity: Number(q) }))
        .filter((p) => p.quantity > 0 && rates.some((r) => r.role_id === p.role_id)),
    }));
    if (callBody.some((c) => !c.name || !c.call_date || !c.start_time)) return setError("Every call needs a name, date and start time.");
    if (callBody.some((c) => c.positions.length === 0)) return setError("Every call needs at least one position (set a crew count).");
    setBusy(true);
    try {
      const res = await api<{ id: number }>("POST", "/admin/jobs", {
        name,
        client_id: Number(clientId),
        venue_id: venueChoice && venueChoice !== "new" ? Number(venueChoice) : null,
        new_venue: venueChoice === "new" ? newVenue : undefined,
        contact_id: contactId ? Number(contactId) : null,
        notes,
        rates: rateBody,
        calls: callBody,
      });
      router.push(`/jobs/${res.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="New job" back={{ href: "/jobs", label: "Jobs" }} subtitle="Set up the job, what each role pays on it, and the calls with how many people you need." />
      <div className="space-y-6">
        <Card title="1 · Job details">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Job name" className="md:col-span-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bruce Springsteen at MSG" />
            </Field>
            <Field label="Client">
              <div className="flex gap-2">
                <Select value={clientId} onChange={(e) => { setClientId(e.target.value); setVenueChoice(""); setContactId(null); }}>
                  <option value="">Select a client…</option>
                  {(clients ?? []).filter((c) => c.status === "active").map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
                <Button variant="secondary" type="button" onClick={() => setClientModal(true)}>New</Button>
              </div>
            </Field>
            <Field label="Client contact">
              <Select value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={!client}>
                <option value="">{client?.contacts.length ? "None" : "No contacts saved"}</option>
                {client?.contacts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Venue / location">
              <Select value={venueChoice} onChange={(e) => setVenueChoice(e.target.value)}>
                <option value="">Select a venue…</option>
                {venueOptions.own.length > 0 && (
                  <optgroup label="This client's venues">
                    {venueOptions.own.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </optgroup>
                )}
                {venueOptions.others.length > 0 && (
                  <optgroup label="Other saved venues">
                    {venueOptions.others.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </optgroup>
                )}
                <option value="new">＋ Add a new venue…</option>
              </Select>
            </Field>
            {venueChoice === "new" && (
              <div className="grid gap-2 md:col-span-2 md:grid-cols-2">
                <Input placeholder="Venue name (e.g. Madison Square Garden)" value={newVenue.name} onChange={(e) => setNewVenue({ ...newVenue, name: e.target.value })} />
                <Input placeholder="Address" value={newVenue.address} onChange={(e) => setNewVenue({ ...newVenue, address: e.target.value })} />
              </div>
            )}
            <Field label="Notes for the crew" className="md:col-span-2" hint="Shown to workers in the app: dress code, parking, entrance, etc.">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Blacks required. Enter via loading dock on 33rd St." />
            </Field>
          </div>
        </Card>

        <Card title="2 · Roles & hourly pay for this job" actions={<span className="text-xs text-ink/50">Everyone in a role earns this rate on this job</span>}>
          <div className="space-y-2">
            {rates.map((r, i) => (
              <div key={r.role_id} className="flex items-center gap-3">
                <div className="w-48 text-sm font-medium">{roleName(r.role_id)}</div>
                <div className="relative w-40">
                  <span className="pointer-events-none absolute left-3 top-2 text-sm text-ink/40">$</span>
                  <Input
                    type="number" min="0" step="0.25" inputMode="decimal" className="pl-6"
                    placeholder="0.00"
                    value={r.pay_rate}
                    onChange={(e) => setRates((rs) => rs.map((x, j) => (j === i ? { ...x, pay_rate: e.target.value } : x)))}
                  />
                </div>
                <span className="text-sm text-ink/50">/ hr</span>
                <Button variant="ghost" size="sm" onClick={() => setRates((rs) => rs.filter((_, j) => j !== i))}>Remove</Button>
              </div>
            ))}
            {unusedRoles.length > 0 && (
              <Select
                className="mt-2 w-60"
                value=""
                onChange={(e) => e.target.value && setRates((rs) => [...rs, { role_id: Number(e.target.value), pay_rate: "" }])}
              >
                <option value="">＋ Add a role…</option>
                {unusedRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            )}
          </div>
        </Card>

        <Card
          title="3 · Calls"
          actions={
            <Button
              variant="secondary" size="sm"
              onClick={() => {
                const last = calls[calls.length - 1];
                setCalls([...calls, { ...newCall(last ? nextDay(last.call_date) : todayYmd(1), "Load-out"), qty: { ...(last?.qty ?? {}) } }]);
              }}
            >
              ＋ Add call
            </Button>
          }
        >
          <p className="mb-4 text-sm text-ink/60">A call is one shift: e.g. load-in, show, load-out. Each has its own date, time and crew count.</p>
          <div className="space-y-4">
            {calls.map((c, idx) => (
              <div key={c.key} className="rounded-lg border border-line bg-paper/50 p-4">
                <div className="grid gap-3 md:grid-cols-5">
                  <Field label="Call name">
                    <Input list="call-names" value={c.name} onChange={(e) => updateCall(c.key, { name: e.target.value })} />
                  </Field>
                  <Field label="Date">
                    <Input type="date" value={c.call_date} onChange={(e) => updateCall(c.key, { call_date: e.target.value })} />
                  </Field>
                  <Field label="Start">
                    <Input type="time" value={c.start_time} onChange={(e) => updateCall(c.key, { start_time: e.target.value })} />
                  </Field>
                  <Field label="Est. end">
                    <Input type="time" value={c.end_time} onChange={(e) => updateCall(c.key, { end_time: e.target.value })} />
                  </Field>
                  <div className="flex items-end justify-end">
                    {calls.length > 1 && (
                      <Button variant="ghost" size="sm" onClick={() => setCalls(calls.filter((x) => x.key !== c.key))}>Remove call {idx + 1}</Button>
                    )}
                  </div>
                </div>
                <div className="mt-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink/60">Crew needed</div>
                  {rates.length === 0 ? (
                    <div className="text-sm text-ink/50">Add roles above first.</div>
                  ) : (
                    <div className="flex flex-wrap gap-3">
                      {rates.map((r) => (
                        <label key={r.role_id} className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-1.5">
                          <span className="text-sm">{roleName(r.role_id)}</span>
                          <input
                            type="number" min="0" inputMode="numeric"
                            className="w-14 rounded border border-line px-2 py-1 text-sm"
                            value={c.qty[r.role_id] ?? ""}
                            placeholder="0"
                            onChange={(e) => updateCall(c.key, { qty: { ...c.qty, [r.role_id]: e.target.value } })}
                          />
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <datalist id="call-names">
            {["Load-in", "Show", "Load-out", "Rehearsal", "Changeover", "Build", "Strike"].map((n) => <option key={n} value={n} />)}
          </datalist>
        </Card>

        <ErrorNote>{error}</ErrorNote>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => router.push("/jobs")}>Cancel</Button>
          <Button onClick={submit} busy={busy}>Create job</Button>
        </div>
      </div>

      <QuickClient
        open={clientModal}
        onClose={() => setClientModal(false)}
        onCreated={async (id) => {
          await reloadClients();
          setClientId(String(id));
          setClientModal(false);
        }}
      />
    </>
  );
}

function QuickClient({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: number) => void }) {
  const [name, setName] = useState("");
  const [terms, setTerms] = useState("Net 30");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open={open} onClose={onClose} title="New client">
      <div className="space-y-3">
        <Field label="Company name"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Payment terms">
          <Select value={terms} onChange={(e) => setTerms(e.target.value)}>
            {["Due on receipt", "Net 10", "Net 15", "Net 30", "Net 45", "Net 60"].map((t) => <option key={t}>{t}</option>)}
          </Select>
        </Field>
        <p className="text-xs text-ink/50">Add contacts, venues and preferred/banned crew later from the client page.</p>
        <ErrorNote>{error}</ErrorNote>
        <div className="flex justify-end">
          <Button
            onClick={async () => {
              try {
                const r = await api<{ id: number }>("POST", "/admin/clients", { name, payment_terms: terms });
                setName("");
                onCreated(r.id);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Create client
          </Button>
        </div>
      </div>
    </Modal>
  );
}
