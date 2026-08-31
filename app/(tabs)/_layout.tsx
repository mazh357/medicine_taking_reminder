import { Tabs } from "expo-router";

import { colors } from "../../src/ui";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 13, fontWeight: "600" },
        tabBarStyle: { height: 62, paddingBottom: 8, paddingTop: 8 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "今日" }} />
      <Tabs.Screen name="medications" options={{ title: "用药" }} />
      <Tabs.Screen name="followups" options={{ title: "事项" }} />
      <Tabs.Screen name="history" options={{ title: "记录" }} />
      <Tabs.Screen name="settings" options={{ title: "设置" }} />
    </Tabs>
  );
}
