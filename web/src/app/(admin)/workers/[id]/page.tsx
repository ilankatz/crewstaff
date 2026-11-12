"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api, useData } from "@/lib/api";
import { CALL_STATUS, clock, fmtDate, money, todayYmd } from "@/lib/format";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, SecretBox, Select, Textarea, cx, td, th } from "@/components/ui";
import type { Role } from "../page";

type Doc = { id: number; kind: string; title: string; file_name: string; mime: string; size: number; expires_on: string | null; created_at: string };
type Detail = {
  id: number; first_name: string; last_name: string; email: string; phone: string; status: string; notes: string; created_at: string;
  role_ids: number[]; documents: Doc[]; flags: { client_id: number; flag: string; client_name: string }[]; login_email: string | null;
  history: { call_id: number; job_id: number; job: string; call: string; call_date: string; role: string; status: string; call_status: string; clock_in: string | null; clock_out: string | null; no_show: number | null; hours: number; pay: number }[];
};

export default function WorkerPage() {
  const { id } = useParams<{ id: string }>();
  const { data: w, reload } = useData<Detail>(`/admin/workers/${id}`);
  const { data: roles } = useData<Role[]>("/admin/roles");
  if (!w) return <Loading />;
  const worked = w.history.filter((h) => h.hours > 0);
  return (
    <>
      <PageHeader
        back={{ href: "/workers", label: "Labor pool" }}
        title={<span className="flex items-center gap-2">{w.first_name} {w.last_name} {w.status !== "active" && <Badge>inactive</Badge>}</span>}
        subtitle={<>{w.phone} · {w.email} · {worked.length} shifts worked · {worked.reduce((s, h) => s + h.hours, 0).toFixed(1)} h total</>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-1">
          <Profile w={w} roles={roles ?? []} onSaved={reload} />
          {w.flags.length > 0 && (
            <Card title="Client preferences">
              <ul className="space-y-1 text-sm">
                {w.flags.map((f) => (
                  <li key={f.client_id} className="flex justify-between">
                    <Link href={`/clients/${f.client_id}`} className="hover:text-accent">{f.client_name}</Link>
                    <Badge tone={f.flag === "banned" ? "red" : "violet"}>{f.flag}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Documents workerId={w.id} docs={w.documents} onChanged={reload} />
          <Card title="Work history" pad={false}>
            {w.history.length === 0 ? (
              <div className="p-4"><Empty>No jobs yet.</Empty></div>
            ) : (
              <div className="max-h-[480px] overflow-auto">
                <table className="w-full">
                  <thead className="sticky top-0 border-b border-line bg-paper">
                    <tr>
                      <th className={th}>Date</th>
                      <th className={th}>Job</th>
                      <th className={th}>Role</th>
                      <th className={th}>Time</th>
                      <th className={cx(th, "text-right")}>Pay</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {w.history.map((h) => (
                      <tr key={h.call_id}>
                        <td className={cx(td, "whitespace-nowrap")}>{fmtDate(h.call_date)}</td>
                        <td className={td}>
                          <Link href={`/calls/${h.call_id}`} className="hover:text-accent">{h.job}</Link>
                          <div className="text-xs text-ink/50">{h.call}</div>
                        </td>
                        <td className={td}>{h.role}</td>
                        <td className={cx(td, "whitespace-nowrap text-xs")}>
                          {h.status !== "accepted" ? (
                            <Badge>{h.status}</Badge>
                          ) : h.no_show ? (
                            <Badge tone="red">No-show</Badge>
                          ) : h.clock_in ? (
                            <>{clock(h.clock_in)} – {clock(h.clock_out)} · {h.hours.toFixed(2)} h</>
                          ) : (
                            <Badge tone={CALL_STATUS[h.call_status].tone}>{CALL_STATUS[h.call_status].label}</Badge>
                          )}
                        </td>
                        <td className={cx(td, "text-right tabular-nums")}>{h.pay ? money(h.pay) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function Profile({ w, roles, onSaved }: { w: Detail; roles: Role[]; onSaved: () => void }) {
  const [f, setF] = useState({ first_name: w.first_name, last_name: w.last_name, email: w.email, phone: w.phone, notes: w.notes, status: w.status });
  const [roleIds, setRoleIds] = useState(w.role_ids);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pw, setPw] = useState<string | null>(null);
  return (
    <Card title="Profile">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="First"><Input value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} /></Field>
          <Field label="Last"><Input value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} /></Field>
        </div>
        <Field label="Email / app login"><Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink/60">Roles</div>
          <div className="flex flex-wrap gap-1.5">
            {roles.filter((r) => r.active || roleIds.includes(r.id)).map((r) => {
              const on = roleIds.includes(r.id);
              return (
                <button key={r.id} type="button" onClick={() => setRoleIds(on ? roleIds.filter((x) => x !== r.id) : [...roleIds, r.id])}
                  className={cx("rounded-full border px-2.5 py-0.5 text-xs", on ? "border-ink bg-ink text-white" : "border-line hover:border-ink/40")}>
                  {r.name}
                </button>
              );
            })}
          </div>
        </div>
        <Field label="Status">
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="active">Active</option>
            <option value="inactive">Inactive (can&apos;t log in or get offers)</option>
          </Select>
        </Field>
        <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <ErrorNote>{error}</ErrorNote>
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={async () => {
            if (!confirm("Reset this worker's app password?")) return;
            const r = await api<{ temp_password: string }>("POST", `/admin/workers/${w.id}/reset-password`);
            setPw(r.temp_password);
          }}>Reset password</Button>
          <div className="flex items-center gap-2">
            {saved && <span className="text-sm text-emerald-700">Saved</span>}
            <Button onClick={async () => {
              setError(null);
              try {
                await api("PATCH", `/admin/workers/${w.id}`, { ...f, role_ids: roleIds });
                setSaved(true);
                setTimeout(() => setSaved(false), 2500);
                onSaved();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}>Save</Button>
          </div>
        </div>
        {pw && <SecretBox label="New temporary password" value={pw} />}
      </div>
    </Card>
  );
}

function Documents({ workerId, docs, onChanged }: { workerId: number; docs: Doc[]; onChanged: () => void }) {
  const [upload, setUpload] = useState(false);
  const today = todayYmd();
  const soon = todayYmd(30);
  return (
    <Card title="Documents & certifications" actions={<Button size="sm" onClick={() => setUpload(true)}>＋ Upload</Button>} pad={false}>
      {docs.length === 0 ? (
        <div className="p-4"><Empty>Nothing on file. Upload forklift certs, ID, W-9, etc.</Empty></div>
      ) : (
        <ul className="divide-y divide-line">
          {docs.map((d) => {
            const expired = d.expires_on && d.expires_on < today;
            const expiring = d.expires_on && !expired && d.expires_on <= soon;
            return (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <a href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer" className="font-medium hover:text-accent">{d.title}</a>
                  <div className="text-xs text-ink/50">
                    {d.kind === "certification" ? "Certification" : "Document"} · {d.file_name} · {(d.size / 1024).toFixed(0)} KB
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {d.expires_on ? (
                    <ExpiryEditor doc={d} tone={expired ? "red" : expiring ? "amber" : "slate"} onChanged={onChanged} />
                  ) : (
                    <ExpiryEditor doc={d} tone="slate" onChanged={onChanged} />
                  )}
                  <button className="rounded px-1.5 text-ink/30 hover:bg-red-50 hover:text-red-700" title="Delete"
                    onClick={async () => {
                      if (!confirm(`Delete ${d.title}?`)) return;
                      await api("DELETE", `/admin/documents/${d.id}`);
                      onChanged();
                    }}>✕</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {upload && <UploadModal workerId={workerId} onClose={() => setUpload(false)} onDone={() => { setUpload(false); onChanged(); }} />}
    </Card>
  );
}

function ExpiryEditor({ doc, tone, onChanged }: { doc: Doc; tone: "red" | "amber" | "slate"; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(doc.expires_on ?? "");
  if (editing)
    return (
      <span className="flex items-center gap-1">
        <input type="date" value={v} onChange={(e) => setV(e.target.value)} className="rounded border border-line px-2 py-0.5 text-xs" />
        <Button size="sm" onClick={async () => { await api("PATCH", `/admin/documents/${doc.id}`, { expires_on: v || null }); setEditing(false); onChanged(); }}>Save</Button>
      </span>
    );
  return (
    <button onClick={() => setEditing(true)} title="Change expiry date">
      {doc.expires_on ? (
        <Badge tone={tone}>{tone === "red" ? "Expired" : "Expires"} {fmtDate(doc.expires_on, true)}</Badge>
      ) : (
        <span className="text-xs text-ink/40 hover:text-ink">No expiry</span>
      )}
    </button>
  );
}

function UploadModal({ workerId, onClose, onDone }: { workerId: number; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("certification");
  const [expires, setExpires] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="Upload document">
      <div className="space-y-3">
        <Field label="File (PDF or photo, up to 15 MB)">
          <input type="file" accept="image/*,application/pdf,.doc,.docx" onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ""));
          }} className="block w-full text-sm" />
        </Field>
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="OSHA forklift certification" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="certification">Certification</option>
              <option value="document">Document (ID, W-9…)</option>
            </Select>
          </Field>
          <Field label="Expires (optional)"><Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></Field>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <div className="flex justify-end">
          <Button busy={busy} disabled={!file} onClick={async () => {
            if (!file) return;
            setBusy(true);
            setError(null);
            const fd = new FormData();
            fd.append("file", file);
            fd.append("title", title);
            fd.append("kind", kind);
            fd.append("expires_on", expires);
            try {
              await api("POST", `/admin/workers/${workerId}/documents`, fd);
              onDone();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
              setBusy(false);
            }
          }}>Upload</Button>
        </div>
      </div>
    </Modal>
  );
}
