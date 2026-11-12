import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useApi } from "@/lib/use-api";
import { clock, fmtDate, fmtTime, isToday } from "@/lib/format";
import { Badge, C, Card, Empty, ErrorText, H1, Screen, s } from "@/components/ui";

type Shift = {
  assignment_id: number; call_id: number; call_name: string; call_date: string; start_time: string; end_time: string | null; call_status: string;
  job_name: string; client_name: string; venue_name: string | null; role: string; is_steward: boolean; clock_in: string | null; clock_out: string | null; no_show: boolean;
};

export default function Shifts() {
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const { data, error, refresh, refreshing } = useApi<Shift[]>(`/me/shifts?scope=${tab}`, 15000);
  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <H1>My shifts</H1>
      <View style={{ flexDirection: "row", backgroundColor: C.white, borderRadius: 12, padding: 3, borderWidth: 1, borderColor: C.line }}>
        {(["upcoming", "past"] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={{ flex: 1, paddingVertical: 8, borderRadius: 9, backgroundColor: tab === t ? C.ink : "transparent" }}>
            <Text style={{ textAlign: "center", fontWeight: "600", color: tab === t ? C.white : C.ink2 }}>{t === "upcoming" ? "Upcoming" : "Past"}</Text>
          </Pressable>
        ))}
      </View>
      <ErrorText>{error}</ErrorText>
      {data && data.length === 0 && <Empty title={tab === "upcoming" ? "No upcoming shifts" : "No past shifts"}>{tab === "upcoming" ? "Accept an offer and it shows up here." : ""}</Empty>}
      {data?.map((sh) => <ShiftCard key={sh.call_id} sh={sh} />)}
    </Screen>
  );
}

function ShiftCard({ sh }: { sh: Shift }) {
  const live = sh.call_status === "in_progress";
  const onClock = !!sh.clock_in && !sh.clock_out;
  return (
    <Card onPress={() => router.push({ pathname: "/call/[id]", params: { id: String(sh.call_id) } })} style={live ? { borderColor: C.green, borderWidth: 2 } : undefined}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        <Text style={[s.title, { flex: 1 }]}>{sh.job_name}</Text>
        {sh.is_steward && <Badge tone="amber">Steward</Badge>}
      </View>
      <Text style={[s.body, { fontWeight: "600", color: C.ink }]}>
        {isToday(sh.call_date) ? "Today" : fmtDate(sh.call_date)} · {fmtTime(sh.start_time)} · {sh.call_name}
      </Text>
      <Text style={s.small}>{sh.role}{sh.venue_name ? ` · ${sh.venue_name}` : ""}</Text>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
        {live && !sh.clock_in && <Badge tone="green">Live — tap to clock in</Badge>}
        {onClock && <Badge tone="green">On the clock since {clock(sh.clock_in)}</Badge>}
        {sh.clock_out && <Badge>{clock(sh.clock_in)} – {clock(sh.clock_out)}</Badge>}
        {sh.no_show && <Badge tone="red">No-show</Badge>}
        {sh.call_status === "ended" && <Badge tone="amber">Ended</Badge>}
        {sh.call_status === "approved" && <Badge tone="blue">Approved</Badge>}
      </View>
    </Card>
  );
}
