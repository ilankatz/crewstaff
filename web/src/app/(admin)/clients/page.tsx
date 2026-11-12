"use client";

import Link from "next/link";
import { useState } from "react";
import { useData } from "@/lib/api";
import { ClientForm } from "@/components/client-form";
import { Badge, Button, Card, Empty, Loading, PageHeader, td, th } from "@/components/ui";

type Client = { id: number; name: string; phone: string; email: string; payment_terms: string; status: string; job_count: number; contact_count: number; venue_count: number };
type Venue = { id: number; name: string; address: string; client_name: string | null };

export default function ClientsPage() {
  const { data } = useData<Client[]>("/admin/clients");
  const { data: venues } = useData<Venue[]>("/admin/venues");
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHeader title="Clients & venues" actions={<Button onClick={() => setAdding(true)}>＋ Add client</Button>} />
      {!data ? (
        <Loading />
      ) : data.length === 0 ? (
        <Empty>No clients yet.</Empty>
      ) : (
        <Card pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line bg-paper/60">
                <tr>
                  <th className={th}>Client</th>
                  <th className={th}>Contact info</th>
                  <th className={th}>Terms</th>
                  <th className={th}>Jobs</th>
                  <th className={th}>Contacts / venues</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.map((c) => (
                  <tr key={c.id} className="hover:bg-paper/60">
                    <td className={td}>
                      <Link href={`/clients/${c.id}`} className="font-medium hover:text-accent">{c.name}</Link>{" "}
                      {c.status !== "active" && <Badge>inactive</Badge>}
                    </td>
                    <td className={`${td} text-ink/70`}>{[c.phone, c.email].filter(Boolean).join(" · ")}</td>
                    <td className={td}>{c.payment_terms}</td>
                    <td className={td}>{c.job_count}</td>
                    <td className={`${td} text-ink/70`}>{c.contact_count} / {c.venue_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <h2 className="mb-3 mt-8 text-lg font-semibold">All saved venues</h2>
      {venues && venues.length > 0 ? (
        <Card pad={false}>
          <ul className="divide-y divide-line">
            {venues.map((v) => (
              <li key={v.id} className="flex flex-wrap justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="font-medium">{v.name}</span>
                <span className="text-ink/55">{v.address}{v.client_name ? ` · ${v.client_name}` : ""}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Empty>Venues are saved from a client&apos;s page or when creating a job.</Empty>
      )}
      {adding && <ClientForm onClose={() => setAdding(false)} />}
    </>
  );
}
