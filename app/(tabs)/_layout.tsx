import { Tabs } from "expo-router";
import type { ColorValue } from "react-native";

import { useAppAppearance } from "../../src/state/AppAppearanceProvider";
import { FeatureIcon, type FeatureIconName } from "../../src/ui";

function tabIcon(name: FeatureIconName) {
  return function TabFeatureIcon({ color, focused, size }: { color: ColorValue; focused: boolean; size: number }) {
    return <FeatureIcon color={color} name={name} selected={focused} size={Math.min(size, 24)} />;
  };
}

export default function TabsLayout() {
  const { colors } = useAppAppearance();
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
      <Tabs.Screen name="index" options={{ tabBarAccessibilityLabel: "今日", tabBarIcon: tabIcon("today"), title: "今日" }} />
      <Tabs.Screen name="medications" options={{ tabBarAccessibilityLabel: "用药", tabBarIcon: tabIcon("medications"), title: "用药" }} />
      <Tabs.Screen name="followups" options={{ tabBarAccessibilityLabel: "事项", tabBarIcon: tabIcon("followups"), title: "事项" }} />
      <Tabs.Screen name="history" options={{ tabBarAccessibilityLabel: "记录", tabBarIcon: tabIcon("history"), title: "记录" }} />
      <Tabs.Screen name="settings" options={{ tabBarAccessibilityLabel: "设置", tabBarIcon: tabIcon("settings"), title: "设置" }} />
    </Tabs>
  );
}
