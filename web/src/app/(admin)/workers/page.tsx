"use client";

import Link from "next/link";
import { useState } from "react";
import { api, useData } from "@/lib/api";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, SecretBox, Select, Textarea, cx, td, th } from "@/components/ui";

type Worker = {
  id: number; first_name: string; last_name: string; email: string; phone: string; status: string;
  roles: string | null; role_ids: number[]; expired_docs: number; expiring_docs: number; doc_count: number;
};
export type Role = { id: number; name: string; is_steward: number; active: number; worker_count: number };

export default function WorkersPage() {
  const [status, setStatus] = useState("active");
  const { data, reload } = useData<Worker[]>(`/admin/workers?status=${status}`);
  const { data: roles } = useData<Role[]>("/admin/roles");
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [adding, setAdding] = useState(false);

  const rows = (data ?? []).filter(
    (w) =>
      (!q || `${w.first_name} ${w.last_name} ${w.email} ${w.phone}`.toLowerCase().includes(q.toLowerCase())) &&
      (!role || w.role_ids.includes(Number(role))),
  );

  return (
    <>
      <PageHeader title="Labor pool" subtitle={data ? `${data.length} ${status === "all" ? "" : status} workers` : undefined} actions={<Button onClick={() => setAdding(true)}>＋ Add worker</Button>} />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input placeholder="Search name, email, phone…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Select value={role} onChange={(e) => setRole(e.target.value)} className="max-w-[200px]">
          <option value="">All roles</option>
          {(roles ?? []).map((r) => <option key={r.id} value={r.id}>{r.name} ({r.worker_count})</option>)}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[160px]">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </Select>
      </div>
      {!data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>No workers match. Add your first worker to start building the labor pool.</Empty>
      ) : (
        <Card pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line bg-paper/60">
                <tr>
                  <th className={th}>Name</th>
                  <th className={th}>Roles</th>
                  <th className={th}>Phone</th>
                  <th className={th}>Documents</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((w) => (
                  <tr key={w.id} className="hover:bg-paper/60">
                    <td className={td}>
                      <Link href={`/workers/${w.id}`} className="font-medium hover:text-accent">{w.last_name}, {w.first_name}</Link>
                      <div className="text-xs text-ink/50">{w.email}</div>
                    </td>
                    <td className={cx(td, "text-ink/70")}>{w.roles}</td>
                    <td className={cx(td, "whitespace-nowrap text-ink/70")}>{w.phone}</td>
                    <td className={td}>
                      <div className="flex flex-wrap gap-1">
                        {w.expired_docs > 0 && <Badge tone="red">{w.expired_docs} expired</Badge>}
                        {w.expiring_docs > 0 && <Badge tone="amber">{w.expiring_docs} expiring</Badge>}
                        {!w.expired_docs && !w.expiring_docs && <span className="text-xs text-ink/45">{w.doc_count} on file</span>}
                        {w.status !== "active" && <Badge>inactive</Badge>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {adding && <AddWorker roles={roles ?? []} onClose={() => setAdding(false)} onCreated={reload} />}
    </>
  );
}

function AddWorker({ roles, onClose, onCreated }: { roles: Role[]; onClose: () => void; onCreated: () => void }) {
  const blank = { first_name: "", last_name: "", email: "", phone: "", notes: "" };
  const [f, setF] = useState(blank);
  const [roleIds, setRoleIds] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: number; email: string; temp_password: string } | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: number; email: string; temp_password: string }>("POST", "/admin/workers", { ...f, role_ids: roleIds });
      setCreated(r);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={created ? "Worker added" : "Add a worker"}>
      {created ? (
        <div className="space-y-4">
          <p className="text-sm">
            <b>{f.first_name} {f.last_name}</b> can now sign in to the CrewStaff app with <b>{created.email}</b> and this password:
          </p>
          <SecretBox label="Temporary password" value={created.temp_password} />
          <div className="flex justify-between gap-2">
            <Link href={`/workers/${created.id}`} className="text-sm font-medium text-accent">Upload their documents →</Link>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => { setCreated(null); setF(blank); setRoleIds([]); }}>Add another</Button>
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name"><Input value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} autoFocus /></Field>
            <Field label="Last name"><Input value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} /></Field>
          </div>
          <Field label="Email" hint="Also their app login."><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Phone"><Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink/60">Roles (at least one)</div>
            <div className="flex flex-wrap gap-2">
              {roles.filter((r) => r.active).map((r) => {
                const on = roleIds.includes(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setRoleIds(on ? roleIds.filter((x) => x !== r.id) : [...roleIds, r.id])}
                    className={cx("rounded-full border px-3 py-1 text-sm", on ? "border-ink bg-ink text-white" : "border-line bg-white hover:border-ink/40")}
                  >
                    {on ? "✓ " : ""}{r.name}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-ink/50">Pay rates are set per job, not per worker.</p>
          </div>
          <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <ErrorNote>{error}</ErrorNote>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={save} busy={busy}>Add worker</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
