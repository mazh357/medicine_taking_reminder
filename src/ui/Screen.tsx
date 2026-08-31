import type { PropsWithChildren, ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useAppAppearance } from "../state/AppAppearanceProvider";
import { spacing } from "./theme";

type ScreenProps = PropsWithChildren<{
  title: string;
  subtitle?: string;
  headerRight?: ReactNode;
  scroll?: boolean;
}>;

export function Screen({
  title,
  subtitle,
  headerRight,
  scroll = true,
  children,
}: ScreenProps) {
  const { colors, textScale } = useAppAppearance();
  const content = (
    <>
      <View style={styles.header}>
        <View style={styles.headingCopy}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text, fontSize: 28 * textScale }]}>
            {title}
          </Text>
          {subtitle ? <Text style={[styles.subtitle, { color: colors.muted, fontSize: 15 * textScale }]}>{subtitle}</Text> : null}
        </View>
        {headerRight}
      </View>
      {children}
    </>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.root, { backgroundColor: colors.background }]}
    >
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {content}
        </ScrollView>
      ) : (
        <View style={styles.content}>{content}</View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flexGrow: 1, gap: spacing.md, padding: spacing.md },
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  headingCopy: { flex: 1 },
  title: { fontSize: 28, fontWeight: "800" },
  subtitle: { fontSize: 15, lineHeight: 22, marginTop: 4 },
});
