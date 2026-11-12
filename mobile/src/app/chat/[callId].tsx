import { useLocalSearchParams } from "expo-router";
import { Stack } from "expo-router/stack";
import { useEffect, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";
import { C, ErrorText, s } from "@/components/ui";

type Msg = { id: number; body: string; created_at: string; sender: string; mine: boolean; sender_role: string | null };

export default function Chat() {
  const { callId, thread: rawThread, title } = useLocalSearchParams<{ callId: string; thread?: string; title?: string }>();
  const { me } = useSession();
  // "mine" = this worker's private thread with the Steward.
  const thread = rawThread === "mine" ? String(me?.worker?.id ?? "") : rawThread || "group";
  const { data, error, reload } = useApi<{ items: Msg[] }>(`/calls/${callId}/messages?thread=${thread}`, 4000);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const list = useRef<FlatList<Msg>>(null);
  const count = data?.items.length ?? 0;

  useEffect(() => {
    if (count) setTimeout(() => list.current?.scrollToEnd({ animated: false }), 50);
  }, [count]);

  async function send() {
    if (!text.trim()) return;
    setSending(true);
    setSendErr(null);
    try {
      await api("POST", `/calls/${callId}/messages?thread=${thread}`, { body: text.trim() });
      setText("");
      await reload();
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.paper }} edges={["bottom"]}>
      <Stack.Screen options={{ title: title || (thread === "group" ? "Crew chat" : "Messages") }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={90}>
        <Text style={[s.small, { textAlign: "center", paddingVertical: 6 }]}>
          {thread === "group" ? "Everyone on this call sees these messages." : "Private — only you, the Steward and the office."}
        </Text>
        <ErrorText>{error}</ErrorText>
        <FlatList
          ref={list}
          data={data?.items ?? []}
          keyExtractor={(m) => String(m.id)}
          contentContainerStyle={{ padding: 12, gap: 8 }}
          ListEmptyComponent={<Text style={[s.small, { textAlign: "center", marginTop: 40 }]}>No messages yet. Say hi.</Text>}
          renderItem={({ item: m }) => (
            <View style={{ alignItems: m.mine ? "flex-end" : "flex-start" }}>
              <View style={{ maxWidth: "80%", backgroundColor: m.mine ? C.ink : C.white, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, borderWidth: m.mine ? 0 : 1, borderColor: C.line }}>
                {!m.mine && (
                  <Text style={{ fontSize: 12, fontWeight: "700", color: m.sender_role === "Steward" ? C.amber : m.sender_role === "Office" ? C.blue : C.ink2 }}>
                    {m.sender}{m.sender_role ? ` · ${m.sender_role}` : ""}
                  </Text>
                )}
                <Text style={{ color: m.mine ? C.white : C.ink, fontSize: 15 }}>{m.body}</Text>
                <Text style={{ color: m.mine ? "rgba(255,255,255,0.5)" : C.muted, fontSize: 10, marginTop: 2 }}>
                  {new Date(m.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                </Text>
              </View>
            </View>
          )}
        />
        <ErrorText>{sendErr}</ErrorText>
        <View style={{ flexDirection: "row", gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.white }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Message…"
            placeholderTextColor={C.muted}
            multiline
            style={{ flex: 1, backgroundColor: C.paper, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16, maxHeight: 120, color: C.ink }}
          />
          <Pressable onPress={send} disabled={sending || !text.trim()} style={{ backgroundColor: text.trim() ? C.accent : C.line, borderRadius: 20, paddingHorizontal: 18, justifyContent: "center" }}>
            <Text style={{ color: C.white, fontWeight: "700" }}>{sending ? "…" : "Send"}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
