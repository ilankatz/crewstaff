import { Tabs } from "expo-router/js-tabs";
import { Text, type ColorValue } from "react-native";
import { C } from "@/components/ui";

const icon = (glyph: string) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <Text style={{ color, fontSize: 20, lineHeight: 24 }}>{glyph}</Text>;
  };

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.accent,
        tabBarInactiveTintColor: C.muted,
        tabBarStyle: { backgroundColor: C.white, borderTopColor: C.line },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Offers", tabBarIcon: icon("✦") }} />
      <Tabs.Screen name="shifts" options={{ title: "Shifts", tabBarIcon: icon("◷") }} />
      <Tabs.Screen name="messages" options={{ title: "Messages", tabBarIcon: icon("✉") }} />
      <Tabs.Screen name="hours" options={{ title: "Hours", tabBarIcon: icon("$") }} />
      <Tabs.Screen name="profile" options={{ title: "Me", tabBarIcon: icon("◉") }} />
    </Tabs>
  );
}
