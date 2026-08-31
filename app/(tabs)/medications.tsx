import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { useAppAppearance } from "../../src/state/AppAppearanceProvider";
import { inventoryPredictionLines } from "../../src/features/inventoryPredictionLabels";
import { useMedicationSnapshot } from "../../src/state/useMedicationSnapshot";
import { Button, Card, Screen, StatusPill, spacing } from "../../src/ui";

export default function MedicationsScreen() {
  const { colors, textScale } = useAppAppearance();
  const snapshot = useMedicationSnapshot();

  return (
    <Screen title="用药计划">
      <Button onPress={() => router.push("/medication/new")}>新增药物</Button>
      {snapshot.medications.length === 0 ? (
        <Card>
          <Text style={[styles.empty, { color: colors.muted, fontSize: 15 * textScale }]}>还没有用药计划。</Text>
        </Card>
      ) : (
        snapshot.medications.map((medication) => (
          <Card
            key={medication.id}
            right={<StatusPill label={medication.active ? "已启用" : "已暂停"} tone={medication.active ? "good" : "warning"} />}
            title={medication.name}
          >
            <View style={styles.row}>
              <Text style={[styles.label, { color: colors.muted, fontSize: 14 * textScale }]}>每日计划</Text>
              <Text style={[styles.value, { color: colors.text, fontSize: 15 * textScale }]}>{medication.reminderTime} · 数量 {medication.plannedDoseQuantity}</Text>
            </View>
            <View style={styles.prediction}>
              {inventoryPredictionLines(medication.inventoryPrediction).map((line) => (
                <Text key={line} style={[styles.meta, { color: colors.muted, fontSize: 13 * textScale }]}>{line}</Text>
              ))}
              <Text style={[styles.meta, { color: colors.muted, fontSize: 13 * textScale }]}>补药提醒：{medication.refillReminderDays === 0 ? "不提醒" : `提前 ${medication.refillReminderDays} 天`}</Text>
            </View>
            <View style={styles.row}>
              <Text style={[styles.label, { color: colors.muted, fontSize: 14 * textScale }]}>当前库存</Text>
              <Text style={[styles.value, { color: colors.text, fontSize: 15 * textScale }]}>{medication.inventoryBalance}</Text>
            </View>
            <Button onPress={() => router.push(`/medication/${medication.id}/edit`)} variant="secondary">
              修改计划与库存
            </Button>
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { fontSize: 15, lineHeight: 22 },
  row: { flexDirection: "row", gap: spacing.sm, justifyContent: "space-between" },
  label: { fontSize: 14 },
  value: { flex: 1, fontSize: 15, fontWeight: "600", textAlign: "right" },
  prediction: { gap: spacing.xs },
  meta: { fontSize: 13, lineHeight: 18 },
});
