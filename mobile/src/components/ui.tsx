import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export const C = {
  ink: "#16181D",
  ink2: "#4B4F57",
  muted: "#80848C",
  line: "#E3E3DE",
  paper: "#F6F6F3",
  white: "#FFFFFF",
  accent: "#D9480F",
  accentSoft: "#FDEDE5",
  green: "#0F8A5F",
  greenSoft: "#E3F5EC",
  amber: "#B45309",
  amberSoft: "#FEF3C7",
  red: "#B91C1C",
  redSoft: "#FDE8E8",
  blue: "#0369A1",
  blueSoft: "#E0F2FE",
};

export function Screen({ children, onRefresh, refreshing, padded = true, edges }: { children: ReactNode; onRefresh?: () => void; refreshing?: boolean; padded?: boolean; edges?: ("top" | "bottom")[] }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.paper }} edges={edges ?? ["top"]}>
      <ScrollView
        contentContainerStyle={[padded && { padding: 16, paddingBottom: 40 }, { gap: 12 }]}
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[C.accent]} /> : undefined}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function H1({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <View style={{ marginBottom: 4 }}>
      <Text style={s.h1}>{children}</Text>
      {sub ? <Text style={s.sub}>{sub}</Text> : null}
    </View>
  );
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  if (onPress)
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [s.card, pressed && { opacity: 0.85 }, style]}>
        {children}
      </Pressable>
    );
  return <View style={[s.card, style]}>{children}</View>;
}

type Variant = "primary" | "secondary" | "danger" | "success" | "accent";
export function Button({ title, onPress, variant = "primary", busy, disabled, big, style }: { title: string; onPress: () => void; variant?: Variant; busy?: boolean; disabled?: boolean; big?: boolean; style?: StyleProp<ViewStyle> }) {
  const bg = { primary: C.ink, secondary: C.white, danger: C.white, success: C.green, accent: C.accent }[variant];
  const fg = { primary: C.white, secondary: C.ink, danger: C.red, success: C.white, accent: C.white }[variant];
  const border = variant === "secondary" ? C.line : variant === "danger" ? "#F5C2C2" : bg;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: bg, borderColor: border, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        big && { paddingVertical: 18, borderRadius: 16 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, { color: fg }, big && { fontSize: 19 }]}>{title}</Text>}
    </Pressable>
  );
}

type Tone = "green" | "amber" | "red" | "blue" | "slate" | "accent";
export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: Tone }) {
  const map: Record<Tone, [string, string]> = {
    green: [C.greenSoft, C.green],
    amber: [C.amberSoft, C.amber],
    red: [C.redSoft, C.red],
    blue: [C.blueSoft, C.blue],
    slate: ["#EEEEEA", C.ink2],
    accent: [C.accentSoft, C.accent],
  };
  const [bg, fg] = map[tone];
  return (
    <View style={[s.badge, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: "600" }}>{children}</Text>
    </View>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View style={s.empty}>
      <Text style={{ fontSize: 16, fontWeight: "600", color: C.ink }}>{title}</Text>
      {children ? <Text style={{ marginTop: 4, color: C.muted, textAlign: "center" }}>{children}</Text> : null}
    </View>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <View style={{ backgroundColor: C.redSoft, borderRadius: 10, padding: 10 }}>
      <Text style={{ color: C.red }}>{children}</Text>
    </View>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor={C.muted} {...props} style={[s.input, props.style]} />
    </View>
  );
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, gap: 12 }}>
      <Text style={{ color: C.muted }}>{label}</Text>
      <Text style={{ color: C.ink, fontWeight: "500", flexShrink: 1, textAlign: "right" }}>{value}</Text>
    </View>
  );
}

export const s = StyleSheet.create({
  h1: { fontSize: 28, fontWeight: "700", color: C.ink, letterSpacing: -0.5 },
  sub: { fontSize: 14, color: C.muted, marginTop: 2 },
  h2: { fontSize: 17, fontWeight: "700", color: C.ink },
  title: { fontSize: 17, fontWeight: "600", color: C.ink },
  body: { fontSize: 15, color: C.ink2 },
  small: { fontSize: 13, color: C.muted },
  label: { fontSize: 12, fontWeight: "700", color: C.muted, textTransform: "uppercase", letterSpacing: 0.5 },
  card: { backgroundColor: C.white, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.line, gap: 6 },
  btn: { paddingVertical: 13, paddingHorizontal: 16, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  btnText: { fontSize: 16, fontWeight: "700" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: "flex-start" },
  empty: { alignItems: "center", padding: 32, borderRadius: 16, borderWidth: 1, borderStyle: "dashed", borderColor: C.line },
  input: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: C.ink },
});
