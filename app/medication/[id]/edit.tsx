import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text } from "react-native";

import { MedicationForm } from "../../../src/features/MedicationForm";
import { inventoryPredictionLines } from "../../../src/features/inventoryPredictionLabels";
import { medicationAppApi, readableError, type RefillReminderDays } from "../../../src/features/medicationAppApi";
import { useAppAppearance } from "../../../src/state/AppAppearanceProvider";
import { useMedicationSnapshot } from "../../../src/state/useMedicationSnapshot";
import { Button, Card, Choice, FormField, Screen, spacing } from "../../../src/ui";

export default function EditMedicationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, textScale } = useAppAppearance();
  const snapshot = useMedicationSnapshot();
  const medication = snapshot.medications.find((item) => item.id === id);
  const [inventory, setInventory] = useState(String(medication?.inventoryBalance ?? 0));
  const [inventoryReason, setInventoryReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [refillBusy, setRefillBusy] = useState(false);
  const [refillError, setRefillError] = useState<string>();

  if (!medication) {
    return (
      <Screen title="找不到药物">
        <Card><Button onPress={() => router.replace("/(tabs)/medications")}>返回用药计划</Button></Card>
      </Screen>
    );
  }

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await operation();
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy(false);
    }
  };

  const toggle = () => {
    const action = medication.active ? "暂停" : "恢复";
    Alert.alert(`${action}这个计划？`, medication.active ? "尚未开始的任务会按生效日期停止生成。已开始的记录不会改变。" : "系统会按提醒时间决定今天或明天恢复。", [
      { text: "取消", style: "cancel" },
      {
        text: `确认${action}`,
        onPress: () => void run(async () => {
          const result = medication.active ? await medicationAppApi.pausePlan(medication.id) : await medicationAppApi.resumePlan(medication.id);
          setMessage(`${action}已保存，${result.effective === "today" ? "今天" : "明天"}生效。`);
        }),
      },
    ]);
  };

  return (
    <Screen headerRight={<Button onPress={() => router.back()} variant="text">返回</Button>} title="修改计划与库存">
      <MedicationForm
        initial={{
          name: medication.name,
          plannedDoseQuantity: medication.plannedDoseQuantity,
          initialInventory: medication.inventoryBalance,
          reminderTime: medication.reminderTime,
        }}
        onSubmit={async (value) => {
          const result = await medicationAppApi.updatePlan(medication.id, value);
          setMessage(`计划已保存，${result.effective === "today" ? "今天" : "明天"}生效。`);
        }}
        submitLabel="保存计划修改"
      />
      <Card title="记录时间范围">
        <Text style={[styles.body, { color: colors.text, fontSize: 15 * textScale }]}>提醒时间：{medication.reminderTime}</Text>
        <Text style={[styles.body, { color: colors.text, fontSize: 15 * textScale }]}>正常记录截止：提醒后 {formatOffset(medication.onTimeOffsetMinutes)}</Text>
        <Text style={[styles.body, { color: colors.text, fontSize: 15 * textScale }]}>最晚记录截止：提醒后 {formatOffset(medication.recordOffsetMinutes)}</Text>
        <Text style={[styles.meta, { color: colors.muted, fontSize: 13 * textScale }]}>时间范围为当前版本的固定设置，仅用于判定正常记录、晚服记录与漏服。</Text>
      </Card>
      <Card title="库存预测与补药提醒">
        <Text style={[styles.body, { color: colors.text, fontSize: 15 * textScale }]}>当前库存：{medication.inventoryBalance}</Text>
        {inventoryPredictionLines(medication.inventoryPrediction).map((line) => (
          <Text key={line} style={[styles.meta, { color: colors.muted, fontSize: 13 * textScale }]}>{line}</Text>
        ))}
        <Text style={[styles.label, { color: colors.text, fontSize: 15 * textScale }]}>补药提醒</Text>
        {[0, 3, 7, 14, 30].map((days) => (
          <Choice
            key={days}
            label={days === 0 ? "不提醒" : `提前 ${days} 天`}
            onPress={() => void (async () => {
              setRefillBusy(true);
              setRefillError(undefined);
              try {
                await medicationAppApi.setRefillReminderDays(medication.id, days as RefillReminderDays);
                setMessage(days === 0 ? "已关闭补药提醒。" : `补药提醒已设为提前 ${days} 天。`);
              } catch (reason) {
                setRefillError(readableError(reason));
              } finally {
                setRefillBusy(false);
              }
            })}
            selected={medication.refillReminderDays === days}
          />
        ))}
        {refillBusy ? <Text style={[styles.meta, { color: colors.muted }]}>正在保存补药提醒…</Text> : null}
        {refillError ? <Text accessibilityRole="alert" style={[styles.message, { color: colors.danger }]}>{refillError}</Text> : null}
      </Card>
      <Card title="库存校正">
        <FormField keyboardType="decimal-pad" label="目标库存" onChangeText={setInventory} value={inventory} />
        <FormField label="校正原因" onChangeText={setInventoryReason} value={inventoryReason} />
        <Button
          disabled={busy}
          onPress={() => void run(async () => {
            const target = Number(inventory);
            if (!Number.isFinite(target) || target < 0 || target > 999999.999) throw new Error("请输入 0—999999.999 之间的库存。");
            if (!inventoryReason.trim()) throw new Error("请填写校正原因。");
            await medicationAppApi.correctInventory(medication.id, target, inventoryReason.trim());
            setMessage("库存校正已保存。");
          })}
          variant="secondary"
        >
          {busy ? "正在保存…" : "保存库存校正"}
        </Button>
      </Card>
      <Button disabled={busy} onPress={toggle} variant={medication.active ? "secondary" : "primary"}>{medication.active ? "暂停计划" : "恢复计划"}</Button>
      {message ? <Text accessibilityLiveRegion="polite" style={[styles.message, { color: colors.primary, fontSize: 14 * textScale }]}>{message}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={[styles.message, { color: colors.danger, fontSize: 14 * textScale }]}>{error}</Text> : null}
    </Screen>
  );
}

function formatOffset(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60} 小时`;
  return `${minutes} 分钟`;
}

const styles = StyleSheet.create({
  body: { fontSize: 15, lineHeight: 22 },
  label: { fontSize: 15, fontWeight: "700", marginTop: spacing.xs },
  meta: { fontSize: 13, lineHeight: 19 },
  message: { fontSize: 14, lineHeight: 20 },
});
