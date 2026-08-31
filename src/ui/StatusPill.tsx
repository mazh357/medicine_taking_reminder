import { StyleSheet, Text, View } from "react-native";

import { useAppAppearance } from "../state/AppAppearanceProvider";

export function StatusPill({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "good" | "warning" }) {
  const { colors, textScale } = useAppAppearance();
  const backgroundColor = tone === "good" ? colors.primarySoft : tone === "warning" ? colors.warningSoft : colors.border;
  const color = tone === "good" ? colors.primary : tone === "warning" ? colors.warning : colors.muted;
  return (
    <View style={[styles.pill, { backgroundColor }]}>
      <Text style={[styles.text, { color, fontSize: 12 * textScale }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  text: { fontSize: 12, fontWeight: "700" },
});
