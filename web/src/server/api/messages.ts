import { z } from "zod";
import { route } from "../router";
import { all, get, run } from "../db";
import { body, forbidden, intId, zReq } from "../http";
import { requireUser, type User } from "../auth";
import { callLabel, getCall, isOnCall, isStewardOf, stewardWorkerIds } from "../core";
import { notifyUsers } from "../push";

/**
 * Each call has a group thread ("group") for everyone on the crew plus one private
 * thread per worker, shared between that worker, the Steward(s), and admins.
 */
type Thread = "group" | number;

function parseThread(v: string | null): Thread {
  if (!v || v === "group") return "group";
  return intId(v);
}

function canSee(user: User, callId: number, thread: Thread) {
  if (user.is_admin) return true;
  if (!user.worker_id) return false;
  if (isStewardOf(user, callId)) return true;
  if (!isOnCall(user.worker_id, callId)) return false;
  return thread === "group" || thread === user.worker_id;
}

function threadWhere(thread: Thread) {
  return thread === "group" ? "thread_worker_id IS NULL" : "thread_worker_id = ?";
}
function threadArgs(thread: Thread) {
  return thread === "group" ? [] : [thread];
}

function lastId(callId: number, thread: Thread) {
  return get<{ id: number | null }>(`SELECT MAX(id) id FROM messages WHERE call_id = ? AND ${threadWhere(thread)}`, callId, ...threadArgs(thread))?.id ?? 0;
}

function unread(userId: number, callId: number, thread: Thread) {
  const read = get<{ last_read_id: number }>(
    "SELECT last_read_id FROM message_reads WHERE user_id = ? AND call_id = ? AND thread_key = ?",
    userId, callId, String(thread),
  )?.last_read_id ?? 0;
  return get<{ n: number }>(
    `SELECT COUNT(*) n FROM messages WHERE call_id = ? AND ${threadWhere(thread)} AND id > ? AND sender_user_id != ?`,
    callId, ...threadArgs(thread), read, userId,
  )!.n;
}

function lastMessage(callId: number, thread: Thread) {
  return (
    get<{ body: string; created_at: string; sender: string }>(
      `SELECT m.body, m.created_at, u.name sender FROM messages m JOIN users u ON u.id = m.sender_user_id
        WHERE m.call_id = ? AND ${threadWhere(thread)} ORDER BY m.id DESC LIMIT 1`,
      callId, ...threadArgs(thread),
    ) ?? null
  );
}

/** Threads on one call that the user can see. */
function threadsFor(user: User, callId: number) {
  const fullView = user.is_admin || isStewardOf(user, callId);
  const threads: { key: string; title: string; worker_id: number | null }[] = [{ key: "group", title: "Everyone on this call", worker_id: null }];
  if (fullView) {
    const crew = all<{ worker_id: number; name: string }>(
      `SELECT DISTINCT w.id worker_id, w.first_name || ' ' || w.last_name name FROM workers w
        WHERE w.id IN (SELECT worker_id FROM assignments WHERE call_id = ? AND status = 'accepted')
           OR w.id IN (SELECT thread_worker_id FROM messages WHERE call_id = ? AND thread_worker_id IS NOT NULL)
        ORDER BY name`,
      callId,
      callId,
    );
    for (const c of crew) if (c.worker_id !== user.worker_id) threads.push({ key: String(c.worker_id), title: c.name, worker_id: c.worker_id });
  } else if (user.worker_id) {
    threads.push({ key: String(user.worker_id), title: "Steward (private)", worker_id: user.worker_id });
  }
  return threads.map((t) => {
    const th: Thread = t.key === "group" ? "group" : Number(t.key);
    return { ...t, unread: unread(user.id, callId, th), last: lastMessage(callId, th) };
  });
}

route("GET", "/calls/:id/threads", async ({ req, p }) => {
  const u = await requireUser(req);
  const callId = intId(p.id);
  if (!canSee(u, callId, "group")) throw forbidden();
  return { call: { id: callId, label: callLabel(callId), status: getCall(callId).status }, threads: threadsFor(u, callId) };
});

route("GET", "/calls/:id/messages", async ({ req, p, q }) => {
  const u = await requireUser(req);
  const callId = intId(p.id);
  const thread = parseThread(q.get("thread"));
  if (!canSee(u, callId, thread)) throw forbidden();
  const after = Number(q.get("after") || 0);
  const items = all(
    `SELECT m.id, m.body, m.created_at, m.sender_user_id, u.name sender, u.is_admin sender_is_admin, u.worker_id sender_worker_id
       FROM messages m JOIN users u ON u.id = m.sender_user_id
      WHERE m.call_id = ? AND ${threadWhere(thread)} AND m.id > ? ORDER BY m.id LIMIT 500`,
    callId, ...threadArgs(thread), after,
  );
  const stewards = new Set(stewardWorkerIds(callId));
  const top = lastId(callId, thread);
  if (top) {
    run(
      `INSERT INTO message_reads (user_id, call_id, thread_key, last_read_id) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, call_id, thread_key) DO UPDATE SET last_read_id = excluded.last_read_id`,
      u.id, callId, String(thread), top,
    );
  }
  return {
    items: items.map((m) => ({
      ...m,
      mine: m.sender_user_id === u.id,
      sender_role: m.sender_is_admin ? "Office" : stewards.has(Number(m.sender_worker_id)) ? "Steward" : null,
    })),
  };
});

route("POST", "/calls/:id/messages", async ({ req, p, q }) => {
  const u = await requireUser(req);
  const callId = intId(p.id);
  const thread = parseThread(q.get("thread"));
  if (!canSee(u, callId, thread)) throw forbidden();
  const b = await body(req, z.object({ body: zReq(2000) }));
  const r = run(
    "INSERT INTO messages (call_id, thread_worker_id, sender_user_id, body) VALUES (?, ?, ?, ?)",
    callId, thread === "group" ? null : thread, u.id, b.body,
  );
  // Who should hear about it: group → whole crew; private → the worker, or the Steward(s) when the worker wrote.
  let workerIds: number[];
  if (thread === "group") {
    workerIds = all<{ worker_id: number }>("SELECT worker_id FROM assignments WHERE call_id = ? AND status = 'accepted'", callId).map((x) => x.worker_id);
  } else if (thread === u.worker_id) {
    workerIds = stewardWorkerIds(callId);
  } else {
    workerIds = [thread];
  }
  const recipients = workerIds.length
    ? all<{ id: number }>(`SELECT id FROM users WHERE worker_id IN (${workerIds.map(() => "?").join(",")})`, ...workerIds).map((x) => x.id)
    : [];
  notifyUsers(
    recipients.filter((id) => id !== u.id),
    thread === "group" ? `${u.name} → crew` : u.name,
    b.body.slice(0, 180),
    { type: "message", callId, thread: String(thread) },
  );
  return { id: Number(r.lastInsertRowid) };
});

/** All conversations for the signed-in user across their active calls. */
route("GET", "/me/inbox", async ({ req }) => {
  const u = await requireUser(req);
  let calls: { id: number }[];
  if (u.is_admin) {
    calls = all(
      `SELECT DISTINCT c.id FROM calls c WHERE c.status IN ('scheduled','in_progress','ended','signed_off')
         AND c.call_date >= date('now','localtime','-7 days') ORDER BY c.call_date LIMIT 50`,
    );
  } else {
    calls = all(
      `SELECT c.id FROM assignments a JOIN calls c ON c.id = a.call_id
        WHERE a.worker_id = ? AND a.status = 'accepted' AND c.status != 'cancelled'
          AND c.call_date >= date('now','localtime','-7 days') ORDER BY c.call_date, c.start_time LIMIT 50`,
      u.worker_id,
    );
  }
  return calls.map((c) => ({
    call_id: c.id,
    label: callLabel(c.id),
    is_steward: isStewardOf(u, c.id),
    threads: threadsFor(u, c.id),
  }));
});
