"use client";

import Link from "next/link";
import { useState } from "react";
import { useData } from "@/lib/api";
import { ChatPanel } from "@/components/chat";
import { Card, Empty, Loading, PageHeader, cx } from "@/components/ui";

type Inbox = { call_id: number; label: string; threads: { unread: number; last: { created_at: string } | null }[] }[];

export default function MessagesPage() {
  const { data } = useData<Inbox>("/me/inbox", 8000);
  const [sel, setSel] = useState<number | null>(null);
  if (!data) return <Loading />;
  const calls = [...data].sort((a, b) => {
    const la = Math.max(0, ...a.threads.map((t) => (t.last ? Date.parse(t.last.created_at) : 0)));
    const lb = Math.max(0, ...b.threads.map((t) => (t.last ? Date.parse(t.last.created_at) : 0)));
    return lb - la;
  });
  const current = sel ?? calls[0]?.call_id ?? null;
  return (
    <>
      <PageHeader title="Messages" subtitle="Crew chat for recent and upcoming calls. You can read and join every thread." />
      {calls.length === 0 ? (
        <Empty>No active calls.</Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-4">
          <Card pad={false} className="lg:col-span-1">
            <ul className="max-h-[70vh] divide-y divide-line overflow-y-auto">
              {calls.map((c) => {
                const unread = c.threads.reduce((s, t) => s + t.unread, 0);
                return (
                  <li key={c.call_id}>
                    <button onClick={() => setSel(c.call_id)} className={cx("block w-full px-4 py-3 text-left text-sm", current === c.call_id ? "bg-paper" : "hover:bg-paper/60")}>
                      <div className="flex items-center justify-between gap-2">
                        <span className={unread ? "font-semibold" : ""}>{c.label}</span>
                        {unread > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">{unread}</span>}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
          <div className="lg:col-span-3">
            {current && (
              <>
                <div className="mb-2 text-right text-xs"><Link href={`/calls/${current}`} className="text-ink/50 hover:text-ink">Open call →</Link></div>
                <ChatPanel key={current} callId={current} height={560} />
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
