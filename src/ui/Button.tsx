import type { PropsWithChildren } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { useAppAppearance } from "../state/AppAppearanceProvider";
import { spacing } from "./theme";

type Props = PropsWithChildren<{
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger" | "text";
  disabled?: boolean;
  accessibilityLabel?: string;
}>;

export function Button({
  onPress,
  variant = "primary",
  disabled = false,
  accessibilityLabel,
  children,
}: Props) {
  const { colors, textScale } = useAppAppearance();
  const palette = {
    primary: { backgroundColor: colors.primary },
    secondary: { backgroundColor: colors.surface, borderColor: colors.primary, borderWidth: 1 },
    danger: { backgroundColor: colors.danger },
    text: { backgroundColor: "transparent" },
  } as const;
  const labelColor = variant === "secondary" || variant === "text" ? colors.primary : "#FFFFFF";
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        palette[variant],
        pressed && !disabled && styles.pressed,
        disabled && { backgroundColor: colors.disabled, borderColor: colors.disabled },
      ]}
    >
      <Text style={[styles.label, { color: labelColor, fontSize: 16 * textScale }]}>{children}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    borderRadius: 12,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  text: { alignSelf: "flex-start", backgroundColor: "transparent", paddingHorizontal: 0 },
  pressed: { opacity: 0.78 },
  label: { fontSize: 16, fontWeight: "700", textAlign: "center" },
});
