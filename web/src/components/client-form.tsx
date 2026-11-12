"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button, ErrorNote, Field, Input, Modal, Select, Textarea } from "@/components/ui";

type Client = { id: number; name: string; phone: string; email: string; payment_terms: string; status: string };

export function ClientForm({ client, onClose, onSaved }: { client?: Client & { billing_address: string; notes: string }; onClose: () => void; onSaved?: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({
    name: client?.name ?? "", phone: client?.phone ?? "", email: client?.email ?? "", billing_address: client?.billing_address ?? "",
    payment_terms: client?.payment_terms ?? "Net 30", notes: client?.notes ?? "", status: client?.status ?? "active",
  });
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title={client ? "Edit client" : "New client"}>
      <div className="space-y-3">
        <Field label="Company name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Billing email"><Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        </div>
        <Field label="Billing address"><Textarea rows={2} value={f.billing_address} onChange={(e) => setF({ ...f, billing_address: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Default payment terms">
            <Select value={f.payment_terms} onChange={(e) => setF({ ...f, payment_terms: e.target.value })}>
              {["Due on receipt", "Net 10", "Net 15", "Net 30", "Net 45", "Net 60"].map((t) => <option key={t}>{t}</option>)}
            </Select>
          </Field>
          {client && (
            <Field label="Status">
              <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
            </Field>
          )}
        </div>
        <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <ErrorNote>{error}</ErrorNote>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={async () => {
              setError(null);
              try {
                if (client) {
                  await api("PATCH", `/admin/clients/${client.id}`, f);
                  onSaved?.();
                  onClose();
                } else {
                  const { status: _s, ...rest } = f;
                  void _s;
                  const r = await api<{ id: number }>("POST", "/admin/clients", rest);
                  router.push(`/clients/${r.id}`);
                }
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
