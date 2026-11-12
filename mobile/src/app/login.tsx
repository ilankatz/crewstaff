import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import { useSession } from "@/lib/session";
import { Button, C, ErrorText, Field, Screen, s } from "@/components/ui";

export default function Login() {
  const { signIn, server: savedServer } = useSession();
  const [server, setServer] = useState(savedServer);
  const [showServer, setShowServer] = useState(!savedServer);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await signIn(server, email.trim(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen>
        <View style={{ marginTop: 48, marginBottom: 24 }}>
          <Text style={{ fontSize: 38, fontWeight: "800", color: C.ink, letterSpacing: -1 }}>
            Crew<Text style={{ color: C.accent }}>Staff</Text>
          </Text>
          <Text style={[s.body, { marginTop: 6 }]}>Get job offers, clock in and out, and see your hours.</Text>
        </View>
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" onSubmitEditing={submit} />
        {showServer ? (
          <Field
            label="Server address"
            value={server}
            onChangeText={setServer}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="192.168.1.20:3000"
          />
        ) : (
          <Pressable onPress={() => setShowServer(true)}>
            <Text style={s.small}>Server: {savedServer} · change</Text>
          </Pressable>
        )}
        <ErrorText>{error}</ErrorText>
        <Button title="Sign in" onPress={submit} busy={busy} disabled={!email || !password || !server} big />
        <Text style={[s.small, { textAlign: "center", marginTop: 8 }]}>Your login comes from the office. Ask them if you don&apos;t have one.</Text>
      </Screen>
    </KeyboardAvoidingView>
  );
}
