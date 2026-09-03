import { router } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { advanceLabels, typeLabels } from "../../src/features/FollowUpForm";
import { medicationAppApi, readableError } from "../../src/features/medicationAppApi";
import { useAppAppearance } from "../../src/state/AppAppearanceProvider";
import { useMedicationSnapshot } from "../../src/state/useMedicationSnapshot";
import { Button, Card, Screen, StatusPill, spacing } from "../../src/ui";

const statusLabels = { scheduled: "待处理", completed: "已完成", cancelled: "已取消" } as const;

export default function FollowUpsScreen() {
  const appearance = useAppAppearance();
  const snapshot = useMedicationSnapshot();
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();
  const items = [...snapshot.followUps].sort((left, right) => Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt));

  const run = async (id: string, operation: () => Promise<void>) => {
    setBusyId(id);
    setError(undefined);
    try {
      await operation();
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusyId(undefined);
    }
  };

  const cancel = (id: string) => {
    Alert.alert("取消这个事项？", "事项会保留在记录中，并标记为已取消。", [
      { text: "返回", style: "cancel" },
      { text: "确认取消", style: "destructive", onPress: () => void run(id, () => medicationAppApi.cancelFollowUp(id)) },
    ]);
  };

  return (
    <Screen featureIcon="followups" title="事项" subtitle="记录复诊、取药和检查安排，提醒仅保存在本机。">
      <Button onPress={() => router.push("/follow-up/new" as never)}>新增事项</Button>
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: appearance.colors.danger }]}>{error}</Text> : null}
      {items.length === 0 ? (
        <Card><Text style={[styles.empty, { color: appearance.colors.muted }]}>还没有事项。</Text></Card>
      ) : items.map((item) => {
        const medication = snapshot.medications.find((entry) => entry.id === item.medicationId);
        const busy = busyId === item.id;
        return (
          <Card key={item.id} right={<StatusPill label={statusLabels[item.status]} tone={item.status === "completed" ? "good" : item.status === "cancelled" ? "warning" : undefined} />} title={item.title}>
            <Text style={[styles.body, { color: appearance.colors.text }]}>{typeLabels[item.type]} · {new Date(item.scheduledAt).toLocaleString("zh-CN")}</Text>
            <Text style={[styles.meta, { color: appearance.colors.muted }]}>{medication ? `关联药物：${medication.name}` : "未关联药物"} · {advanceLabels[item.advanceReminderDays]}</Text>
            {item.notes ? <Text style={[styles.meta, { color: appearance.colors.muted }]}>备注：{item.notes}</Text> : null}
            {item.status === "scheduled" ? (
              <View style={styles.actions}>
                <Button disabled={busy} onPress={() => router.push(`/follow-up/${item.id}/edit` as never)} variant="secondary">编辑</Button>
                <Button disabled={busy} onPress={() => void run(item.id, () => medicationAppApi.completeFollowUp(item.id))} variant="secondary">{busy ? "正在保存…" : "标记完成"}</Button>
                <Button disabled={busy} onPress={() => cancel(item.id)} variant="text">取消事项</Button>
              </View>
            ) : null}
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.sm },
  body: { fontSize: 15, lineHeight: 22 },
  meta: { fontSize: 13, lineHeight: 19 },
  empty: { fontSize: 15, lineHeight: 22 },
  error: { fontSize: 14, lineHeight: 20 },
});
