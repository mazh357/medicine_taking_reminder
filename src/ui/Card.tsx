import type { PropsWithChildren, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAppAppearance } from "../state/AppAppearanceProvider";
import { spacing } from "./theme";

export function Card({
  title,
  right,
  children,
  onPress,
  accessibilityLabel,
}: PropsWithChildren<{
  title?: string;
  right?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
}>) {
  const { colors, textScale } = useAppAppearance();
  const content = (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}> 
      {title ? (
        <View style={styles.row}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text, fontSize: 18 * textScale }]}>
            {title}
          </Text>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      accessibilityHint="打开此任务"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  title: { flex: 1, fontSize: 18, fontWeight: "700" },
  pressed: { opacity: 0.72 },
});
