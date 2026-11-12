import { router, useLocalSearchParams } from "expo-router";
import { Stack } from "expo-router/stack";
import { useEffect, useState } from "react";
import { Alert, Linking, Modal, Pressable, Text, View } from "react-native";
import { api } from "@/lib/session";
import { useApi } from "@/lib/use-api";
import { clock, elapsed, fmtDate, fmtTime, hhmmToIso, isoToHhmm, money } from "@/lib/format";
import { Badge, Button, C, Card, ErrorText, Field, Row, Screen, s } from "@/components/ui";

type RosterRow = {
  worker_id: number; first_name: string; last_name: string; phone: string; role: string; is_steward: boolean;
  clock_in: string | null; clock_out: string | null; no_show: boolean; edited: boolean; state: "not_in" | "in" | "out" | "no_show"; late: boolean; hours: number;
};
type CallDetail = {
  assignment_id: number; status: string; call_id: number; call_name: string; call_date: string; start_time: string; end_time: string | null;
  call_status: "scheduled" | "in_progress" | "ended" | "signed_off" | "approved" | "cancelled"; call_notes: string;
  job_name: string; job_notes: string; client_name: string; venue_name: string | null; venue_address: string | null;
  role: string; pay_rate: number | null; clock_in: string | null; clock_out: string | null; no_show: boolean; edited: number | null;
  is_steward: boolean; late: boolean; hours: number;
  stewards: { id: number; first_name: string; last_name: string; phone: string }[];
  roster?: RosterRow[];
};

const STATUS: Record<CallDetail["call_status"], { label: string; tone: "slate" | "green" | "amber" | "blue" | "red" }> = {
  scheduled: { label: "Not started", tone: "slate" },
  in_progress: { label: "Live", tone: "green" },
  ended: { label: "Ended", tone: "amber" },
  signed_off: { label: "Signed off", tone: "blue" },
  approved: { label: "Approved", tone: "blue" },
  cancelled: { label: "Cancelled", tone: "red" },
};

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export default function CallScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: c, error, reload, refresh, refreshing } = useApi<CallDetail>(`/me/calls/${id}`, 5000);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const onClock = !!c?.clock_in && !c?.clock_out && !c?.no_show;
  const now = useNow(onClock);

  async function act(key: string, method: string, path: string, body?: unknown) {
    setBusy(key);
    setActionErr(null);
    try {
      await api(method, path, body ?? {});
      await reload();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!c) return <Screen edges={[]}><ErrorText>{error}</ErrorText></Screen>;
  const st = STATUS[c.call_status];
  const steward = c.stewards[0];

  return (
    <Screen onRefresh={refresh} refreshing={refreshing} edges={[]}>
      <Stack.Screen options={{ title: c.is_steward ? "Run call" : "Shift" }} />
      <View>
        <View style={{ flexDirection: "row", gap: 6, marginBottom: 6 }}>
          <Badge tone={st.tone}>{st.label}</Badge>
          {c.is_steward && <Badge tone="amber">You&apos;re the Steward</Badge>}
        </View>
        <Text style={s.h1}>{c.job_name}</Text>
        <Text style={s.sub}>{c.call_name} · {fmtDate(c.call_date)} · {fmtTime(c.start_time)}{c.end_time ? `–${fmtTime(c.end_time)}` : ""}</Text>
      </View>

      {/* Worker's own clock */}
      {c.call_status !== "cancelled" && (
        <Card style={{ alignItems: "stretch", gap: 10 }}>
          {c.no_show ? (
            <Text style={[s.title, { color: C.red }]}>Marked as no-show. Message the Steward if that&apos;s wrong.</Text>
          ) : c.clock_out ? (
            <>
              <Text style={s.label}>Your time</Text>
              <Text style={{ fontSize: 28, fontWeight: "800", color: C.ink }}>{c.hours.toFixed(2)} hours</Text>
              <Text style={s.body}>{clock(c.clock_in)} – {clock(c.clock_out)}{c.pay_rate != null ? ` · est. ${money(c.hours * c.pay_rate)}` : ""}</Text>
              {c.edited ? <Text style={s.small}>Adjusted by the Steward/office.</Text> : null}
            </>
          ) : onClock ? (
            <>
              <Text style={s.label}>On the clock since {clock(c.clock_in)}</Text>
              <Text style={{ fontSize: 40, fontWeight: "800", color: C.green }}>{elapsed(c.clock_in!, now)}</Text>
              {c.late && <Badge tone="amber">Clocked in late</Badge>}
              {c.call_status === "in_progress" && (
                <Button title="Clock out" variant="primary" big busy={busy === "out"}
                  onPress={() => Alert.alert("Clock out now?", "", [{ text: "Cancel" }, { text: "Clock out", onPress: () => void act("out", "POST", `/me/calls/${c.call_id}/clock-out`) }])} />
              )}
            </>
          ) : c.call_status === "in_progress" ? (
            <>
              <Text style={s.title}>The call has started.</Text>
              <Button title="Clock in" variant="success" big busy={busy === "in"} onPress={() => act("in", "POST", `/me/calls/${c.call_id}/clock-in`)} />
            </>
          ) : c.call_status === "scheduled" ? (
            <>
              <Text style={s.title}>Clock-in opens when the Steward starts the call.</Text>
              <Text style={s.small}>Pull down to refresh, or wait for the notification.</Text>
            </>
          ) : (
            <Text style={s.title}>This call is closed.</Text>
          )}
          <ErrorText>{actionErr}</ErrorText>
        </Card>
      )}

      {c.is_steward && <StewardPanel c={c} onChanged={reload} />}

      <Card>
        <Row label="Role" value={c.role} />
        {c.pay_rate != null && <Row label="Pay" value={`${money(c.pay_rate)}/hr`} />}
        <Row label="Client" value={c.client_name} />
        {c.venue_name ? <Row label="Venue" value={c.venue_name} /> : null}
        {c.venue_address ? (
          <Pressable onPress={() => Linking.openURL(`geo:0,0?q=${encodeURIComponent(c.venue_address!)}`)}>
            <Text style={{ color: C.accent, fontWeight: "600", marginTop: 4 }}>📍 {c.venue_address} — open in Maps</Text>
          </Pressable>
        ) : null}
        {c.job_notes ? <Text style={[s.body, { marginTop: 8 }]}>{c.job_notes}</Text> : null}
        {c.call_notes ? <Text style={[s.body, { marginTop: 4 }]}>{c.call_notes}</Text> : null}
      </Card>

      {!c.is_steward && steward && (
        <Card>
          <Text style={s.label}>Steward</Text>
          <Text style={s.title}>{steward.first_name} {steward.last_name}</Text>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 6 }}>
            <Button title="Message" style={{ flex: 1 }} onPress={() => router.push({ pathname: "/chat/[callId]", params: { callId: String(c.call_id), thread: "mine", title: "Steward" } })} />
            {steward.phone ? <Button title="Call" variant="secondary" style={{ flex: 1 }} onPress={() => Linking.openURL(`tel:${steward.phone}`)} /> : null}
          </View>
        </Card>
      )}
      <Button title="📣 Crew group chat" variant="secondary" onPress={() => router.push({ pathname: "/chat/[callId]", params: { callId: String(c.call_id), thread: "group", title: "Everyone on this call" } })} />
      {c.call_status === "scheduled" && !c.is_steward && (
        <Button title="I can't make it — drop this shift" variant="danger"
          onPress={() => Alert.alert("Drop this shift?", "Your spot goes to the next person on standby.", [
            { text: "Keep it" },
            { text: "Drop shift", style: "destructive", onPress: async () => {
              try {
                await api("POST", `/me/assignments/${c.assignment_id}/cancel`);
                router.back();
              } catch (e) {
                Alert.alert("Couldn't drop shift", e instanceof Error ? e.message : String(e));
              }
            } },
          ])} />
      )}
    </Screen>
  );
}

// ------------------------------------------------------------------ Steward

function StewardPanel({ c, onChanged }: { c: CallDetail; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<RosterRow | null>(null);
  const roster = c.roster ?? [];
  const counts = {
    in: roster.filter((r) => r.state === "in").length,
    out: roster.filter((r) => r.state === "out").length,
    notIn: roster.filter((r) => r.state === "not_in").length,
    noShow: roster.filter((r) => r.state === "no_show").length,
  };

  async function act(key: string, method: string, path: string, body?: unknown) {
    setBusy(key);
    setErr(null);
    try {
      await api(method, path, body ?? {});
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function rowActions(r: RosterRow) {
    const base = `/calls/${c.call_id}/workers/${r.worker_id}`;
    const buttons: { text: string; style?: "cancel" | "destructive"; onPress?: () => void }[] = [];
    if (c.call_status === "in_progress" && r.state === "not_in") buttons.push({ text: "Clock in now", onPress: () => void act(`r${r.worker_id}`, "POST", `${base}/clock-in`) });
    if (c.call_status === "in_progress" && r.state === "in") buttons.push({ text: "Clock out now", onPress: () => void act(`r${r.worker_id}`, "POST", `${base}/clock-out`) });
    if (["in_progress", "ended"].includes(c.call_status)) {
      buttons.push({ text: "Edit times", onPress: () => setEditing(r) });
      if (!r.no_show) buttons.push({ text: "Mark no-show", style: "destructive", onPress: () => void act(`r${r.worker_id}`, "PATCH", base, { no_show: true }) });
      else buttons.push({ text: "Undo no-show", onPress: () => void act(`r${r.worker_id}`, "PATCH", base, { no_show: false }) });
    }
    if (r.phone) buttons.push({ text: `Call ${r.first_name}`, onPress: () => void Linking.openURL(`tel:${r.phone}`) });
    buttons.push({ text: "Message", onPress: () => router.push({ pathname: "/chat/[callId]", params: { callId: String(c.call_id), thread: String(r.worker_id), title: `${r.first_name} ${r.last_name}` } }) });
    buttons.push({ text: "Close", style: "cancel" });
    Alert.alert(`${r.first_name} ${r.last_name}`, `${r.role}${r.clock_in ? ` · in ${clock(r.clock_in)}` : ""}${r.clock_out ? ` · out ${clock(r.clock_out)}` : ""}`, buttons);
  }

  return (
    <>
      <Card style={{ borderColor: C.amber, borderWidth: 2, gap: 10 }}>
        <Text style={s.h2}>Steward controls</Text>
        {c.call_status === "scheduled" && (
          <>
            <Text style={s.body}>When the crew arrives, start the call. Everyone gets a notification and can clock in from their phone.</Text>
            <Button title="▶  Start call" variant="success" big busy={busy === "start"}
              onPress={() => Alert.alert("Start the call?", "Crew will be able to clock in.", [{ text: "Cancel" }, { text: "Start", onPress: () => void act("start", "POST", `/calls/${c.call_id}/start`) }])} />
          </>
        )}
        {c.call_status === "in_progress" && (
          <>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Stat n={counts.in} label="on clock" color={C.green} />
              <Stat n={counts.notIn} label="not in" color={counts.notIn ? C.accent : C.muted} />
              <Stat n={counts.out} label="out" color={C.ink2} />
            </View>
            <Button title="■  End call" variant="primary" busy={busy === "end"}
              onPress={() => Alert.alert(
                "End the call?",
                `${counts.in ? `${counts.in} still on the clock will be clocked out now. ` : ""}${counts.notIn ? `${counts.notIn} who never clocked in will be marked no-show.` : ""}`.trim() || "Everyone is clocked out.",
                [{ text: "Cancel" }, { text: "End call", style: "destructive", onPress: () => void act("end", "POST", `/calls/${c.call_id}/end`, { clock_out_remaining: true }) }],
              )} />
          </>
        )}
        {c.call_status === "ended" && (
          <>
            <Text style={s.body}>Check everyone&apos;s times below (tap a name to fix). When it&apos;s right, sign off and it goes to the office for approval.</Text>
            <Button title="✓  Sign off timesheet" variant="success" big busy={busy === "sign"}
              onPress={() => Alert.alert("Sign off?", "You won't be able to change times after this.", [{ text: "Cancel" }, { text: "Sign off", onPress: () => void act("sign", "POST", `/calls/${c.call_id}/sign-off`) }])} />
          </>
        )}
        {c.call_status === "signed_off" && <Text style={s.body}>Signed off. Waiting for office approval.</Text>}
        {c.call_status === "approved" && <Text style={s.body}>Approved by the office.</Text>}
        <ErrorText>{err}</ErrorText>
      </Card>

      <Text style={[s.h2, { marginTop: 4 }]}>Crew · {roster.length}</Text>
      {roster.map((r) => (
        <Pressable key={r.worker_id} onPress={() => rowActions(r)} style={({ pressed }) => [{ backgroundColor: pressed ? C.paper : C.white, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 }]}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: r.state === "in" ? C.green : r.state === "out" ? C.ink2 : r.state === "no_show" ? C.red : C.line }} />
          <View style={{ flex: 1 }}>
            <Text style={s.title}>{r.first_name} {r.last_name}</Text>
            <Text style={s.small}>{r.role}{r.is_steward ? " (you)" : ""}</Text>
          </View>
          <View style={{ alignItems: "flex-end", gap: 2 }}>
            {r.state === "no_show" ? <Badge tone="red">No-show</Badge> : r.state === "not_in" ? <Badge>Not in</Badge> : (
              <Text style={{ color: C.ink, fontWeight: "600" }}>{clock(r.clock_in)} – {r.clock_out ? clock(r.clock_out) : "now"}</Text>
            )}
            <View style={{ flexDirection: "row", gap: 4 }}>
              {r.late && <Badge tone="amber">Late</Badge>}
              {r.edited && <Badge>Edited</Badge>}
              {r.state === "out" && <Text style={s.small}>{r.hours.toFixed(2)} h</Text>}
            </View>
          </View>
        </Pressable>
      ))}
      {editing && <EditTimes row={editing} c={c} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
    </>
  );
}

function Stat({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: C.paper, borderRadius: 12, padding: 10, alignItems: "center" }}>
      <Text style={{ fontSize: 26, fontWeight: "800", color }}>{n}</Text>
      <Text style={s.small}>{label}</Text>
    </View>
  );
}

function EditTimes({ row, c, onClose, onSaved }: { row: RosterRow; c: CallDetail; onClose: () => void; onSaved: () => void }) {
  const [inT, setIn] = useState(isoToHhmm(row.clock_in) || c.start_time);
  const [outT, setOut] = useState(isoToHhmm(row.clock_out));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    // Keep the original date of an existing clock-in; otherwise use the call date.
    const baseDate = row.clock_in ? new Date(row.clock_in).toLocaleDateString("en-CA") : c.call_date;
    const clock_in = hhmmToIso(baseDate, inT);
    const clock_out = outT ? hhmmToIso(baseDate, outT, clock_in) : null;
    if (!clock_in || (outT && !clock_out)) return setErr("Use 24-hour HH:MM, e.g. 07:45 or 18:30");
    setBusy(true);
    setErr(null);
    try {
      await api("PATCH", `/calls/${c.call_id}/workers/${row.worker_id}`, { clock_in, clock_out, no_show: false });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)" }} onPress={onClose} />
      <View style={{ backgroundColor: C.white, padding: 20, gap: 12, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
        <Text style={s.h2}>Edit times · {row.first_name} {row.last_name}</Text>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}><Field label="Clock in (HH:MM)" value={inT} onChangeText={setIn} keyboardType="numbers-and-punctuation" placeholder="07:45" /></View>
          <View style={{ flex: 1 }}><Field label="Clock out (HH:MM)" value={outT} onChangeText={setOut} keyboardType="numbers-and-punctuation" placeholder={c.call_status === "in_progress" ? "still working" : "16:30"} /></View>
        </View>
        <Text style={s.small}>Times after midnight roll to the next day automatically. Changes are logged.</Text>
        <ErrorText>{err}</ErrorText>
        <View style={{ flexDirection: "row", gap: 10, marginBottom: 12 }}>
          <Button title="Cancel" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
          <Button title="Save" onPress={save} busy={busy} style={{ flex: 1 }} />
        </View>
      </View>
    </Modal>
  );
}
