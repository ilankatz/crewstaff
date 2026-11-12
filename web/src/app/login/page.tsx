"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Button, ErrorNote, Field, Input } from "@/components/ui";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/auth/login", { email, password, web: true });
      const next = new URLSearchParams(location.search).get("next");
      location.href = next && next.startsWith("/") ? next : "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-white p-8 shadow-sm">
        <div>
          <div className="text-2xl font-bold tracking-tight">
            Crew<span className="text-accent">Staff</span>
          </div>
          <p className="mt-1 text-sm text-ink/60">Sign in to manage jobs, crew and billing.</p>
        </div>
        <Field label="Email">
          <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" busy={busy} className="w-full">
          Sign in
        </Button>
      </form>
    </main>
  );
}
