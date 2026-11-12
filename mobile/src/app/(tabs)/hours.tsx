import { Text, View } from "react-native";
import { useApi } from "@/lib/use-api";
import { clock, fmtDate, money, weekOf } from "@/lib/format";
import { Badge, C, Card, Empty, ErrorText, H1, Screen, s } from "@/components/ui";

type Entry = {
  call_id: number; job_name: string; call_name: string; call_date: string; role: string; pay_rate: number | null;
  clock_in: string | null; clock_out: string | null; no_show: boolean; hours: number; pay: number; approval: "approved" | "signed_off" | "pending";
};

export default function Hours() {
  const { data, error, refresh, refreshing } = useApi<Entry[]>("/me/hours", 30000);
  const weeks = new Map<string, Entry[]>();
  for (const e of data ?? []) {
    const w = weekOf(e.call_date);
    weeks.set(w, [...(weeks.get(w) ?? []), e]);
  }
  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <H1 sub="Estimated gross pay. Final pay comes from payroll.">My hours</H1>
      <ErrorText>{error}</ErrorText>
      {data && data.length === 0 && <Empty title="No hours yet">After you clock in and out, your time shows up here.</Empty>}
      {[...weeks.entries()].map(([week, entries]) => {
        const hrs = entries.reduce((a, e) => a + e.hours, 0);
        const pay = entries.reduce((a, e) => a + e.pay, 0);
        return (
          <View key={week} style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 8 }}>
              <Text style={s.h2}>Week of {fmtDate(week)}</Text>
              <Text style={{ color: C.ink, fontWeight: "700" }}>{hrs.toFixed(2)} h · {money(pay)}</Text>
            </View>
            {entries.map((e) => (
              <Card key={e.call_id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.title}>{e.job_name}</Text>
                    <Text style={s.small}>{fmtDate(e.call_date)} · {e.call_name} · {e.role}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ fontSize: 17, fontWeight: "700", color: C.ink }}>{e.hours.toFixed(2)} h</Text>
                    <Text style={s.small}>{money(e.pay)}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  {e.no_show ? <Badge tone="red">No-show</Badge> : <Text style={s.small}>{clock(e.clock_in)} – {e.clock_out ? clock(e.clock_out) : "on the clock"}</Text>}
                  <Badge tone={e.approval === "approved" ? "green" : e.approval === "signed_off" ? "blue" : "amber"}>
                    {e.approval === "approved" ? "Approved" : e.approval === "signed_off" ? "Signed off" : "Pending"}
                  </Badge>
                </View>
              </Card>
            ))}
          </View>
        );
      })}
    </Screen>
  );
}
