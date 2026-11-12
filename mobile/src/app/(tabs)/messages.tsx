import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useApi } from "@/lib/use-api";
import { C, Card, Empty, ErrorText, H1, Screen, s } from "@/components/ui";

type Inbox = {
  call_id: number;
  label: string;
  is_steward: boolean;
  threads: { key: string; title: string; unread: number; last: { body: string; sender: string; created_at: string } | null }[];
}[];

export default function Messages() {
  const { data, error, refresh, refreshing } = useApi<Inbox>("/me/inbox", 8000);
  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <H1 sub="Chat with your Steward and crew for each shift.">Messages</H1>
      <ErrorText>{error}</ErrorText>
      {data && data.length === 0 && <Empty title="No conversations">Messages for your shifts show up here.</Empty>}
      {data?.map((c) => (
        <Card key={c.call_id} style={{ padding: 0, gap: 0, overflow: "hidden" }}>
          <Text style={[s.label, { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }]}>{c.label}</Text>
          {c.threads.map((t, i) => (
            <Pressable
              key={t.key}
              onPress={() => router.push({ pathname: "/chat/[callId]", params: { callId: String(c.call_id), thread: t.key, title: t.title } })}
              style={({ pressed }) => ({ paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: C.line, backgroundColor: pressed ? C.paper : C.white })}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <Text style={[s.title, { fontSize: 15, fontWeight: t.unread ? "700" : "500", flex: 1 }]} numberOfLines={1}>
                  {t.key === "group" ? "📣 " : ""}{t.title}
                </Text>
                {t.unread > 0 && (
                  <View style={{ backgroundColor: C.accent, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 }}>
                    <Text style={{ color: C.white, fontWeight: "700", fontSize: 12 }}>{t.unread}</Text>
                  </View>
                )}
              </View>
              <Text style={s.small} numberOfLines={1}>{t.last ? `${t.last.sender}: ${t.last.body}` : "No messages yet"}</Text>
            </Pressable>
          ))}
        </Card>
      ))}
    </Screen>
  );
}
