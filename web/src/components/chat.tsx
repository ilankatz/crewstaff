"use client";

import { useEffect, useRef, useState } from "react";
import { api, useData } from "@/lib/api";
import { stamp } from "@/lib/format";
import { Badge, Button, cx } from "./ui";

type Thread = { key: string; title: string; worker_id: number | null; unread: number; last: { body: string; created_at: string; sender: string } | null };
type Msg = { id: number; body: string; created_at: string; sender: string; mine: boolean; sender_role: string | null };

export function ChatPanel({ callId, height = 420 }: { callId: number; height?: number }) {
  const { data, reload } = useData<{ threads: Thread[] }>(`/calls/${callId}/threads`, 5000);
  const [thread, setThread] = useState("group");
  const threads = data?.threads ?? [];
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line md:h-[var(--chat-h)] md:flex-row" style={{ ["--chat-h" as string]: `${height}px` }}>
      <ul className="max-h-36 shrink-0 overflow-y-auto border-b border-line bg-paper/50 md:max-h-none md:w-56 md:border-b-0 md:border-r">
        {threads.map((t) => (
          <li key={t.key}>
            <button
              onClick={() => setThread(t.key)}
              className={cx("block w-full px-3 py-2.5 text-left", thread === t.key ? "bg-white" : "hover:bg-white/60")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={cx("truncate text-sm", t.unread ? "font-semibold" : "font-medium")}>
                  {t.key === "group" ? "📣 " : ""}
                  {t.title}
                </span>
                {t.unread > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">{t.unread}</span>}
              </div>
              <div className="truncate text-xs text-ink/50">{t.last ? `${t.last.sender}: ${t.last.body}` : "No messages"}</div>
            </button>
          </li>
        ))}
      </ul>
      <Conversation key={thread} callId={callId} thread={thread} onSent={reload} title={threads.find((t) => t.key === thread)?.title ?? ""} />
    </div>
  );
}

function Conversation({ callId, thread, onSent, title }: { callId: number; thread: string; onSent: () => void; title: string }) {
  const { data, reload } = useData<{ items: Msg[] }>(`/calls/${callId}/messages?thread=${thread}`, 4000);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const count = data?.items.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [count]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api("POST", `/calls/${callId}/messages?thread=${thread}`, { body: text });
      setText("");
      await reload();
      onSent();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-[380px] min-w-0 flex-1 flex-col bg-white md:h-auto">
      <div className="border-b border-line px-4 py-2 text-xs text-ink/55">
        {thread === "group" ? "Everyone booked on this call sees these messages." : `Private: ${title}, the Steward, and the office.`}
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {data?.items.length === 0 && <div className="py-8 text-center text-sm text-ink/40">No messages yet.</div>}
        {data?.items.map((m) => (
          <div key={m.id} className={cx("flex", m.mine ? "justify-end" : "justify-start")}>
            <div className={cx("max-w-[75%] rounded-2xl px-3 py-2", m.mine ? "bg-ink text-white" : "bg-paper")}>
              {!m.mine && (
                <div className="mb-0.5 flex items-center gap-1 text-xs font-semibold text-ink/70">
                  {m.sender} {m.sender_role && <Badge tone={m.sender_role === "Steward" ? "amber" : "blue"}>{m.sender_role}</Badge>}
                </div>
              )}
              <div className="whitespace-pre-wrap text-sm">{m.body}</div>
              <div className={cx("mt-0.5 text-[10px]", m.mine ? "text-white/50" : "text-ink/40")}>{stamp(m.created_at)}</div>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form onSubmit={send} className="flex gap-2 border-t border-line p-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={thread === "group" ? "Message the whole crew…" : "Write a message…"}
          className="flex-1 rounded-lg border border-line px-3 py-2 text-sm focus:border-accent focus:outline-none"
        />
        <Button type="submit" busy={busy}>Send</Button>
      </form>
    </div>
  );
}
