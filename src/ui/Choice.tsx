import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAppAppearance } from "../state/AppAppearanceProvider";
import { spacing } from "./theme";

export function Choice({
  label,
  description,
  selected,
  onPress,
  role = "radio",
}: {
  label: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
  role?: "radio" | "checkbox";
}) {
  const { colors, textScale } = useAppAppearance();
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        { backgroundColor: colors.surface, borderColor: colors.border },
        selected && { backgroundColor: colors.primarySoft, borderColor: colors.primary },
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.mark, { borderColor: colors.primary }, role === "checkbox" && styles.square]}>
        {selected ? <View style={[styles.dot, { backgroundColor: colors.primary }]} /> : null}
      </View>
      <View style={styles.copy}>
        <Text style={[styles.label, { color: colors.text, fontSize: 16 * textScale }]}>{label}</Text>
        {description ? <Text style={[styles.description, { color: colors.muted, fontSize: 13 * textScale }]}>{description}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  choice: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 52,
    padding: spacing.sm,
  },
  pressed: { opacity: 0.78 },
  mark: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 2,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  square: { borderRadius: 5 },
  dot: { borderRadius: 6, height: 12, width: 12 },
  copy: { flex: 1 },
  label: { fontSize: 16, fontWeight: "600" },
  description: { fontSize: 13, lineHeight: 18, marginTop: 2 },
});
