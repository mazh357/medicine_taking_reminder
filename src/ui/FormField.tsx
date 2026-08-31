import { StyleSheet, Text, TextInput, View } from "react-native";

import { useAppAppearance } from "../state/AppAppearanceProvider";
import { spacing } from "./theme";

type Props = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  hint?: string;
  error?: string;
  keyboardType?: "default" | "decimal-pad" | "number-pad";
  placeholder?: string;
  multiline?: boolean;
};

export function FormField({
  label,
  value,
  onChangeText,
  hint,
  error,
  keyboardType = "default",
  placeholder,
  multiline,
}: Props) {
  const { colors, textScale } = useAppAppearance();
  return (
    <View style={styles.group}>
      <Text style={[styles.label, { color: colors.text, fontSize: 15 * textScale }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        keyboardType={keyboardType}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.disabled}
        style={[
          styles.input,
          {
            backgroundColor: colors.surface,
            borderColor: error ? colors.danger : colors.border,
            color: colors.text,
            fontSize: 16 * textScale,
          },
          multiline && styles.multiline,
        ]}
        value={value}
      />
      {error ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger, fontSize: 13 * textScale }]}>
          {error}
        </Text>
      ) : hint ? (
        <Text style={[styles.hint, { color: colors.muted, fontSize: 13 * textScale }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.xs },
  label: { fontSize: 15, fontWeight: "600" },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  multiline: { minHeight: 96, textAlignVertical: "top" },
  hint: { fontSize: 13, lineHeight: 18 },
  error: { fontSize: 13, lineHeight: 18 },
});
