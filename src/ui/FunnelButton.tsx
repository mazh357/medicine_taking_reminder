import { Pressable, StyleSheet, View } from "react-native";

import { useAppAppearance } from "../state/AppAppearanceProvider";

export function FunnelButton({
  active,
  expanded,
  onPress,
}: {
  active: boolean;
  expanded: boolean;
  onPress(): void;
}) {
  const { colors } = useAppAppearance();
  const color = active ? colors.primary : colors.text;
  return (
    <Pressable
      accessibilityHint="显示或隐藏记录筛选条件"
      accessibilityLabel={expanded ? "收起筛选" : "展开筛选"}
      accessibilityRole="button"
      accessibilityState={{ expanded, selected: active }}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: active ? colors.primarySoft : colors.surface },
        pressed && styles.pressed,
      ]}
    >
      <View importantForAccessibility="no-hide-descendants" style={styles.icon}>
        {active ? (
          <>
            <View style={[styles.funnelTop, { borderTopColor: color }]} />
            <View style={[styles.funnelStem, { backgroundColor: color }]} />
          </>
        ) : (
          <>
            <View style={[styles.outlineTop, { backgroundColor: color }]} />
            <View style={[styles.outlineLeft, { backgroundColor: color }]} />
            <View style={[styles.outlineRight, { backgroundColor: color }]} />
            <View style={[styles.outlineStem, { backgroundColor: color }]} />
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderRadius: 24,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  icon: { alignItems: "center", height: 24, justifyContent: "center", width: 24 },
  funnelTop: {
    borderLeftColor: "transparent",
    borderLeftWidth: 9,
    borderRightColor: "transparent",
    borderRightWidth: 9,
    borderTopWidth: 11,
    height: 0,
    width: 0,
  },
  funnelStem: { height: 8, marginTop: -1, width: 4 },
  outlineTop: { height: 2, left: 3, position: "absolute", top: 3, width: 18 },
  outlineLeft: { height: 2, left: 4, position: "absolute", top: 8, transform: [{ rotate: "45deg" }], width: 11 },
  outlineRight: { height: 2, position: "absolute", right: 4, top: 8, transform: [{ rotate: "-45deg" }], width: 11 },
  outlineStem: { bottom: 2, height: 7, position: "absolute", width: 3 },
  pressed: { opacity: 0.65 },
});
