"use client";

import { useState } from "react";
import { api, useData } from "@/lib/api";
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader, SecretBox } from "@/components/ui";

type Role = { id: number; name: string; is_steward: number; active: number; worker_count: number };
type Admin = { id: number; email: string; name: string };
type System = { push: { firebaseKeyPresent: boolean; enabled: boolean }; server_urls: string[] };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Roles />
        <div className="space-y-6">
          <PhoneApp />
          <Admins />
          <MyPassword />
        </div>
      </div>
    </>
  );
}

function Roles() {
  const { data, reload } = useData<Role[]>("/admin/roles");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Card title="Roles" pad={false}>
      <p className="px-4 pt-3 text-xs text-ink/55">
        Roles are the jobs people can fill. Anyone booked in a <b>Steward</b>-type role runs that call from the app (starts it, manages clock-ins, signs off).
      </p>
      <ul className="mt-2 divide-y divide-line">
        {(data ?? []).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className={r.active ? "font-medium" : "text-ink/40 line-through"}>{r.name}</span>
              {r.is_steward ? <Badge tone="amber">Steward</Badge> : null}
              <span className="text-xs text-ink/45">{r.worker_count} workers</span>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => {
                const n = prompt("Rename role", r.name);
                if (n && n !== r.name) void run(() => api("PATCH", `/admin/roles/${r.id}`, { name: n }));
              }}>Rename</Button>
              <Button size="sm" variant="ghost" onClick={() => run(() => api("PATCH", `/admin/roles/${r.id}`, { active: !r.active }))}>
                {r.active ? "Hide" : "Restore"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2 border-t border-line p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void run(async () => { await api("POST", "/admin/roles", { name }); setName(""); });
        }}
      >
        <Input placeholder="New role, e.g. Spotlight Operator" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit">Add</Button>
      </form>
      <div className="px-4 pb-4"><ErrorNote>{error}</ErrorNote></div>
    </Card>
  );
}

function PhoneApp() {
  const { data } = useData<System>("/admin/system");
  return (
    <Card title="Phone app connection">
      <p className="text-sm text-ink/70">In the CrewStaff app&apos;s sign-in screen, set the server address to one of these (the phone must be on the same Wi-Fi):</p>
      <ul className="mt-2 space-y-1">
        {(data?.server_urls ?? []).map((u) => <li key={u}><code className="rounded bg-paper px-2 py-0.5 text-sm">{u}</code></li>)}
      </ul>
      <div className="mt-4 flex items-center gap-2 text-sm">
        Push notifications:
        {data?.push.firebaseKeyPresent ? <Badge tone="green">Firebase key installed</Badge> : <Badge tone="amber">Not set up — app falls back to checking every few seconds while open</Badge>}
      </div>
      {!data?.push.firebaseKeyPresent && (
        <p className="mt-2 text-xs text-ink/55">To enable real push, put the Firebase service-account key at <code>web/data/firebase-service-account.json</code> and restart. See the README.</p>
      )}
    </Card>
  );
}

function Admins() {
  const { data, reload } = useData<Admin[]>("/admin/admins");
  const [f, setF] = useState({ name: "", email: "" });
  const [pw, setPw] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card title="Office admins">
      <ul className="mb-3 space-y-1 text-sm">
        {(data ?? []).map((a) => (
          <li key={a.id} className="flex items-center justify-between">
            <span>{a.name} <span className="text-ink/45">· {a.email}</span></span>
            <button className="text-xs text-ink/40 hover:text-red-700" onClick={async () => {
              if (!confirm(`Remove ${a.name}'s admin login?`)) return;
              try { await api("DELETE", `/admin/admins/${a.id}`); void reload(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
            }}>Remove</button>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      </div>
      <div className="mt-2 flex justify-end">
        <Button size="sm" onClick={async () => {
          setError(null);
          try {
            const r = await api<{ temp_password: string }>("POST", "/admin/admins", f);
            setPw(r.temp_password);
            setF({ name: "", email: "" });
            void reload();
          } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        }}>Add admin</Button>
      </div>
      {pw && <div className="mt-3"><SecretBox label="Their temporary password" value={pw} /></div>}
      <div className="mt-2"><ErrorNote>{error}</ErrorNote></div>
    </Card>
  );
}

function MyPassword() {
  const [f, setF] = useState({ current: "", next: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card title="Change my password">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Current"><Input type="password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
        <Field label="New (8+ characters)"><Input type="password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
      </div>
      <div className="mt-3 flex items-center justify-end gap-3">
        {msg && <span className="text-sm text-emerald-700">{msg}</span>}
        <Button size="sm" onClick={async () => {
          setError(null);
          setMsg(null);
          try {
            await api("POST", "/me/password", f);
            setF({ current: "", next: "" });
            setMsg("Password changed");
          } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        }}>Change password</Button>
      </div>
      <div className="mt-2"><ErrorNote>{error}</ErrorNote></div>
    </Card>
  );
}
