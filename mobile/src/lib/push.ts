import * as Notifications from "expo-notifications";
import { AndroidImportance } from "expo-notifications";
import { AppState, Platform } from "react-native";
import { api } from "./session";

/**
 * Two delivery paths:
 *  1. Real push through Firebase Cloud Messaging, when the app was built with google-services.json
 *     and the server has the Firebase service-account key.
 *  2. Fallback: while the app is open, poll the server's notification inbox and show a local
 *     notification for anything new. Used only when no push token could be registered.
 */
let pushToken: string | null = null;
let lastSeenId = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;

export const currentPushToken = () => pushToken;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function setupNotifications() {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Job offers & messages",
      importance: AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#D9480F",
    });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return { permission: false, push: false };

  try {
    const t = await Notifications.getDevicePushTokenAsync();
    pushToken = String(t.data);
    await api("POST", "/me/push-token", { token: pushToken, platform: Platform.OS });
    return { permission: true, push: true };
  } catch {
    // No Firebase config in this build: fall back to polling while the app is open.
    pushToken = null;
    return { permission: true, push: false };
  }
}

type Inbox = { items: { id: number; title: string; body: string; data: Record<string, unknown> }[]; unread: number };

/** Poll the notification inbox; shows local notifications only when real push isn't available. */
export function startInboxPolling(onNew?: () => void) {
  stopInboxPolling();
  let first = true;
  const tick = async () => {
    if (AppState.currentState !== "active") return;
    try {
      const r = await api<Inbox>("GET", `/me/notifications?after=${lastSeenId}`);
      const fresh = r.items.filter((n) => n.id > lastSeenId);
      if (fresh.length) {
        lastSeenId = Math.max(...fresh.map((n) => n.id));
        if (!first && !pushToken) {
          for (const n of fresh.slice(0, 3).reverse()) {
            await Notifications.scheduleNotificationAsync({ content: { title: n.title, body: n.body, data: n.data }, trigger: null });
          }
        }
        if (!first) onNew?.();
      }
      first = false;
    } catch {
      // offline; try again next tick
    }
  };
  void tick();
  pollTimer = setInterval(tick, 10000);
}

export function stopInboxPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
