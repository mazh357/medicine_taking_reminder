import { SymbolView, type AndroidSymbol, type SFSymbol } from "expo-symbols";
import regularAndroidWeight from "expo-symbols/androidWeights/regular";
import semiBoldAndroidWeight from "expo-symbols/androidWeights/semiBold";
import { StyleSheet, View, type ColorValue, type StyleProp, type ViewStyle } from "react-native";

export type FeatureIconName =
  | "today"
  | "medications"
  | "followups"
  | "history"
  | "settings";

const featureSymbols: Record<FeatureIconName, { android: AndroidSymbol; ios: SFSymbol }> = {
  today: { android: "today", ios: "calendar" },
  medications: { android: "medication", ios: "pills" },
  followups: { android: "event_note", ios: "calendar.badge.clock" },
  history: { android: "history", ios: "clock.arrow.circlepath" },
  settings: { android: "settings", ios: "gearshape" },
};

export function FeatureIcon({
  color,
  contained = false,
  containerColor,
  name,
  selected = false,
  size = 24,
  style,
}: {
  color: ColorValue;
  contained?: boolean;
  containerColor?: ColorValue;
  name: FeatureIconName;
  selected?: boolean;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const symbol = (
    <SymbolView
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      name={featureSymbols[name]}
      size={size}
      style={{ height: size, width: size }}
      tintColor={color}
      weight={{
        android: selected ? semiBoldAndroidWeight : regularAndroidWeight,
        ios: selected ? "semibold" : "regular",
      }}
    />
  );

  if (!contained) return symbol;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.container, { backgroundColor: containerColor }, style]}
    >
      {symbol}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    borderRadius: 12,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
});
