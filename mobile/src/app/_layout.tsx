import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { Stack } from "expo-router/stack";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SessionProvider, useSession } from "@/lib/session";
import { setupNotifications, startInboxPolling, stopInboxPolling } from "@/lib/push";
import { C } from "@/components/ui";

void SplashScreen.preventAutoHideAsync();

/** Open the right screen when a notification is tapped. */
function openFromNotification(data: Record<string, unknown> | undefined) {
  if (!data) return;
  const callId = data.callId ? String(data.callId) : null;
  if (data.type === "offer") router.navigate("/");
  else if (data.type === "message" && callId) router.push({ pathname: "/chat/[callId]", params: { callId, thread: String(data.thread ?? "group") } });
  else if (callId) router.push({ pathname: "/call/[id]", params: { id: callId } });
}

function Root() {
  const { ready, token } = useSession();

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  useEffect(() => {
    if (!token) return;
    void setupNotifications();
    startInboxPolling();
    const sub = Notifications.addNotificationResponseReceivedListener((r) => openFromNotification(r.notification.request.content.data));
    void Notifications.getLastNotificationResponseAsync().then((r) => r && openFromNotification(r.notification.request.content.data));
    return () => {
      sub.remove();
      stopInboxPolling();
    };
  }, [token]);

  if (!ready) return null;
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerTintColor: C.ink,
          headerStyle: { backgroundColor: C.paper },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: C.paper },
          headerBackButtonDisplayMode: "minimal",
        }}
      >
        <Stack.Protected guard={!!token}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="call/[id]" options={{ title: "Shift" }} />
          <Stack.Screen name="chat/[callId]" options={{ title: "Messages" }} />
        </Stack.Protected>
        <Stack.Protected guard={!token}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <Root />
    </SessionProvider>
  );
}
