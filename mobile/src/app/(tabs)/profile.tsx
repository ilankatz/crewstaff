import * as DocumentPicker from "expo-document-picker";
import { useState } from "react";
import { Alert, Linking, Text, View } from "react-native";
import { api, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";
import { fmtDate } from "@/lib/format";
import { Badge, Button, C, Card, ErrorText, Field, H1, Row, Screen, s } from "@/components/ui";

type Doc = { id: number; kind: string; title: string; file_name: string; expires_on: string | null };

export default function Profile() {
  const { me, signOut, server, token } = useSession();
  const { data: docs, reload } = useApi<Doc[]>("/me/documents");
  const [uploading, setUploading] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  async function upload() {
    const res = await DocumentPicker.getDocumentAsync({ type: ["image/*", "application/pdf"], copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    setUploading(true);
    try {
      const fd = new FormData();
      // React Native's FormData accepts { uri, name, type } for files.
      fd.append("file", { uri: a.uri, name: a.name, type: a.mimeType ?? "application/octet-stream" } as unknown as Blob);
      fd.append("title", a.name.replace(/\.[^.]+$/, ""));
      fd.append("kind", "document");
      await api("POST", "/me/documents", fd);
      void reload();
      Alert.alert("Uploaded", "The office can now see this document.");
    } catch (e) {
      Alert.alert("Upload failed", e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Screen>
      <H1>{me?.name}</H1>
      <Card>
        <Row label="Email" value={me?.email} />
        <Row label="Phone" value={me?.worker?.phone || "—"} />
        <Text style={[s.label, { marginTop: 8 }]}>My roles</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {me?.roles.map((r) => <Badge key={r.id} tone={r.is_steward ? "amber" : "slate"}>{r.name}</Badge>)}
        </View>
      </Card>

      <Text style={[s.h2, { marginTop: 8 }]}>Documents & certifications</Text>
      <Card>
        {(docs ?? []).length === 0 && <Text style={s.small}>Nothing on file yet.</Text>}
        {docs?.map((d) => {
          const expired = d.expires_on && d.expires_on < today;
          return (
            <View key={d.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, gap: 8 }}>
              <Text
                style={{ color: C.ink, fontWeight: "500", flex: 1 }}
                onPress={() => Linking.openURL(`${server}/api/documents/${d.id}/file?token=${encodeURIComponent(token ?? "")}`)}
                numberOfLines={1}
              >
                {d.title}
              </Text>
              {d.expires_on ? <Badge tone={expired ? "red" : "slate"}>{expired ? "Expired" : "Exp."} {fmtDate(d.expires_on)}</Badge> : null}
            </View>
          );
        })}
        <Button title="Upload a document or photo" variant="secondary" onPress={upload} busy={uploading} style={{ marginTop: 6 }} />
      </Card>

      <Text style={[s.h2, { marginTop: 8 }]}>Change password</Text>
      <Card style={{ gap: 10 }}>
        <Field label="Current password" secureTextEntry value={pw.current} onChangeText={(v) => setPw({ ...pw, current: v })} />
        <Field label="New password (8+ characters)" secureTextEntry value={pw.next} onChangeText={(v) => setPw({ ...pw, next: v })} />
        <ErrorText>{pwErr}</ErrorText>
        {pwMsg && <Text style={{ color: C.green }}>{pwMsg}</Text>}
        <Button
          title="Update password"
          variant="secondary"
          disabled={!pw.current || pw.next.length < 8}
          onPress={async () => {
            setPwErr(null);
            setPwMsg(null);
            try {
              await api("POST", "/me/password", pw);
              setPw({ current: "", next: "" });
              setPwMsg("Password updated");
            } catch (e) {
              setPwErr(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      </Card>

      <Button title="Sign out" variant="danger" onPress={() => Alert.alert("Sign out?", "", [{ text: "Cancel" }, { text: "Sign out", style: "destructive", onPress: () => void signOut() }])} style={{ marginTop: 8 }} />
      <Text style={[s.small, { textAlign: "center" }]}>Connected to {server}</Text>
    </Screen>
  );
}
