import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { api, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";
import { fmtDate, fmtTime, money } from "@/lib/format";
import { Badge, Button, C, Card, Empty, ErrorText, H1, Screen, s } from "@/components/ui";

export type Offer = {
  assignment_id: number; status: "offered" | "standby"; call_id: number; call_name: string; call_date: string; start_time: string; end_time: string | null;
  call_status: string; job_name: string; job_notes: string; client_name: string; venue_name: string | null; venue_address: string | null;
  role: string; is_steward: number; pay_rate: number | null; quantity: number; spots_left: number;
};

export default function Offers() {
  const { me } = useSession();
  const { data, error, refresh, refreshing, reload } = useApi<Offer[]>("/me/offers", 15000);
  const offers = data?.filter((o) => o.status === "offered") ?? [];
  const standby = data?.filter((o) => o.status === "standby") ?? [];
  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <H1 sub={`Hi ${me?.worker?.first_name ?? ""} — first to accept gets the spot.`}>Job offers</H1>
      <ErrorText>{error}</ErrorText>
      {data && offers.length === 0 && <Empty title="No open offers">New offers show up here and as a notification.</Empty>}
      {offers.map((o) => <OfferCard key={o.assignment_id} o={o} onDone={reload} />)}
      {standby.length > 0 && (
        <>
          <Text style={[s.h2, { marginTop: 12 }]}>On standby</Text>
          <Text style={s.small}>These filled up before you accepted. If someone drops out, you move up automatically and get a notification.</Text>
          {standby.map((o) => <OfferCard key={o.assignment_id} o={o} onDone={reload} />)}
        </>
      )}
    </Screen>
  );
}

function OfferCard({ o, onDone }: { o: Offer; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function respond(action: "accept" | "decline") {
    setBusy(action);
    setErr(null);
    try {
      const r = await api<{ status: string }>("POST", `/me/assignments/${o.assignment_id}/${action}`);
      if (r.status === "accepted") Alert.alert("You're booked!", `${o.role} · ${o.job_name}\n${fmtDate(o.call_date)} at ${fmtTime(o.start_time)}`);
      if (r.status === "standby") Alert.alert("Spots just filled", "You're on the standby list. If a spot opens, you'll be moved up and notified.");
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{o.job_name}</Text>
          <Text style={s.small}>{o.client_name}</Text>
        </View>
        {o.pay_rate != null && (
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: 20, fontWeight: "800", color: C.ink }}>{money(o.pay_rate)}</Text>
            <Text style={s.small}>per hour</Text>
          </View>
        )}
      </View>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
        <Badge tone="accent">{o.role}</Badge>
        {o.status === "standby" ? <Badge tone="amber">Standby</Badge> : <Badge tone={o.spots_left > 0 ? "green" : "amber"}>{o.spots_left > 0 ? `${o.spots_left} of ${o.quantity} spots left` : "Full — standby only"}</Badge>}
      </View>
      <Text style={[s.body, { marginTop: 6, fontWeight: "600", color: C.ink }]}>
        {o.call_name} · {fmtDate(o.call_date)} · {fmtTime(o.start_time)}
        {o.end_time ? `–${fmtTime(o.end_time)}` : ""}
      </Text>
      {o.venue_name ? <Text style={s.body}>{o.venue_name}{o.venue_address ? `, ${o.venue_address}` : ""}</Text> : null}
      {o.job_notes ? <Text style={[s.small, { marginTop: 4 }]}>{o.job_notes}</Text> : null}
      <ErrorText>{err}</ErrorText>
      <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
        <Button title={o.status === "standby" ? "Leave standby" : "Decline"} variant="secondary" onPress={() => respond("decline")} busy={busy === "decline"} style={{ flex: 1 }} />
        {o.status === "offered" && <Button title={o.spots_left > 0 ? "Accept" : "Join standby"} variant="accent" onPress={() => respond("accept")} busy={busy === "accept"} style={{ flex: 2 }} />}
      </View>
    </Card>
  );
}
