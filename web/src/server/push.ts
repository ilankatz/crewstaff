import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, all, run } from "./db";

/**
 * Notifications are always written to the in-app inbox (the phone app polls it).
 * If a Firebase service-account key is present at data/firebase-service-account.json,
 * they are also sent as real push notifications through Firebase Cloud Messaging.
 */
const KEY_FILE = path.join(DATA_DIR, "firebase-service-account.json");

type Messaging = { send: (msg: unknown) => Promise<string> };
const g = globalThis as unknown as { __crewstaffFcm?: Messaging | null };

async function messaging(): Promise<Messaging | null> {
  if (g.__crewstaffFcm !== undefined) return g.__crewstaffFcm;
  if (!fs.existsSync(KEY_FILE)) return (g.__crewstaffFcm = null);
  try {
    const { initializeApp, cert, getApps } = await import("firebase-admin/app");
    const { getMessaging } = await import("firebase-admin/messaging");
    const app = getApps()[0] ?? initializeApp({ credential: cert(JSON.parse(fs.readFileSync(KEY_FILE, "utf8"))) });
    g.__crewstaffFcm = getMessaging(app) as unknown as Messaging;
    console.log("[crewstaff] Firebase push enabled");
  } catch (e) {
    console.error("[crewstaff] Firebase push disabled:", e);
    g.__crewstaffFcm = null;
  }
  return g.__crewstaffFcm;
}

export function pushStatus() {
  return { firebaseKeyPresent: fs.existsSync(KEY_FILE), enabled: !!g.__crewstaffFcm };
}

export type NotifyData = { type: string; [k: string]: string | number };

export function notifyUsers(userIds: number[], title: string, body: string, data: NotifyData) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  const ins = "INSERT INTO notifications (user_id, title, body, data) VALUES (?, ?, ?, ?)";
  for (const id of ids) run(ins, id, title, body, JSON.stringify(data));
  void sendPush(ids, title, body, data);
}

export function notifyWorkers(workerIds: number[], title: string, body: string, data: NotifyData) {
  if (!workerIds.length) return;
  const rows = all<{ id: number }>(
    `SELECT id FROM users WHERE worker_id IN (${workerIds.map(() => "?").join(",")})`,
    ...workerIds,
  );
  notifyUsers(rows.map((r) => r.id), title, body, data);
}

async function sendPush(userIds: number[], title: string, body: string, data: NotifyData) {
  const fcm = await messaging();
  if (!fcm) return;
  const tokens = all<{ token: string }>(
    `SELECT token FROM push_tokens WHERE user_id IN (${userIds.map(() => "?").join(",")})`,
    ...userIds,
  );
  const strData = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));
  for (const { token } of tokens) {
    try {
      await fcm.send({
        token,
        notification: { title, body },
        data: strData,
        android: { priority: "high", notification: { channelId: "default", sound: "default" } },
      });
    } catch (e: unknown) {
      const code = (e as { code?: string }).code || "";
      if (code.includes("registration-token-not-registered") || code.includes("invalid-argument")) {
        run("DELETE FROM push_tokens WHERE token = ?", token);
      } else {
        console.error("[crewstaff] push failed:", code || e);
      }
    }
  }
}
