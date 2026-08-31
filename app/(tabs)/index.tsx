import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { medicationAppApi } from "../../src/features/medicationAppApi";
import { followUpCountdownLabel, nextScheduledFollowUp } from "../../src/features/followUpCountdown";
import { formatLocalTime, lifecycleLabel } from "../../src/features/labels";
import { occurrenceEntryPath, resolveOccurrenceEntry } from "../../src/features/occurrenceEntryPolicy";
import { useMedicationSnapshot } from "../../src/state/useMedicationSnapshot";
import { useAppAppearance } from "../../src/state/AppAppearanceProvider";
import { Button, Card, Screen, StatusPill, spacing } from "../../src/ui";

function currentLocalDate() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export default function TodayScreen() {
  const { colors, textScale } = useAppAppearance();
  const [openingId, setOpeningId] = useState<string>();
  const snapshot = useMedicationSnapshot();
  const occurrences = snapshot.occurrences
    .filter((occurrence) => occurrence.localServiceDate === currentLocalDate())
    .sort((left, right) => Date.parse(left.plannedAt) - Date.parse(right.plannedAt));
  const notification = medicationAppApi.getNotificationState();
  const nextFollowUp = nextScheduledFollowUp(snapshot.followUps);
  const notificationCopy =
    notification.status === "scheduled"
      ? "本地提醒已安排。"
      : notification.status === "ready"
        ? "提醒服务可用。"
        : notification.reason === "permission_denied"
          ? "通知权限已关闭，可在设置中重新检查。"
          : notification.reason === "scheduling_error"
            ? "部分提醒未能安排，任务仍会保留在今天。"
            : "提醒服务需要检查。";

  useFocusEffect(
    useCallback(() => {
      void medicationAppApi.reconcileToday().catch(() => undefined);
    }, []),
  );

  const navigateToEntry = (occurrenceId: string) => {
    const occurrence = medicationAppApi
      .getSnapshot()
      .occurrences.find((candidate) => candidate.id === occurrenceId);
    if (!occurrence) return;
    const destination = resolveOccurrenceEntry(occurrence);
    if (destination === "confirm_early") {
      Alert.alert(
        "尚未到提醒时间",
        "是否现在开始记录？",
        [
          { text: "取消", style: "cancel" },
          {
            text: "现在开始",
            onPress: () => {
              setOpeningId(occurrenceId);
              void medicationAppApi
                .startOccurrenceEarly(occurrenceId)
                .then(() => router.push(`/task/${occurrenceId}/capture`))
                .catch(() => Alert.alert("暂时无法开始", "任务状态可能已变化，请重试。"))
                .finally(() => setOpeningId(undefined));
            },
          },
        ],
      );
      return;
    }
    router.push(occurrenceEntryPath(occurrenceId, destination));
  };

  const openOccurrence = async (occurrenceId: string) => {
    if (openingId) return;
    setOpeningId(occurrenceId);
    try {
      await medicationAppApi.reconcileToday();
      navigateToEntry(occurrenceId);
    } catch {
      Alert.alert("暂时无法打开任务", "请稍后重试，已有记录不会丢失。" );
    } finally {
      setOpeningId(undefined);
    }
  };

  return (
    <Screen title="今天">
      {nextFollowUp ? (
        <Card
          accessibilityLabel={`下一个事项，${nextFollowUp.title}，${followUpCountdownLabel(nextFollowUp.scheduledAt)}`}
          onPress={() => router.push(`/follow-up/${nextFollowUp.id}/edit` as never)}
          right={<StatusPill label={followUpCountdownLabel(nextFollowUp.scheduledAt)} tone="warning" />}
          title="下一个事项"
        >
          <Text style={[styles.itemName, { color: colors.text, fontSize: 16 * textScale }]}>
            {{ follow_up: "复诊", refill: "取药", test: "检查" }[nextFollowUp.type]} · {nextFollowUp.title}
          </Text>
          <Text style={[styles.meta, { color: colors.muted, fontSize: 14 * textScale }]}>
            {new Date(nextFollowUp.scheduledAt).toLocaleString("zh-CN")}
          </Text>
        </Card>
      ) : null}

      <Card
        right={
          <StatusPill
            label={notification.status === "scheduled" ? "已安排" : notification.status === "ready" ? "可用" : "需检查"}
            tone={notification.status === "degraded" ? "warning" : "good"}
          />
        }
        title="本地提醒"
      >
        <Text style={[styles.body, { color: colors.text, fontSize: 15 * textScale }]}>{notificationCopy}</Text>
        {notification.status === "degraded" ? (
          <Button onPress={() => router.push("/(tabs)/settings")} variant="text">
            前往设备自检
          </Button>
        ) : null}
      </Card>

      {occurrences.length === 0 ? (
        <Card title="今天没有任务">
          <Text style={[styles.body, { color: colors.muted, fontSize: 15 * textScale }]}>新增用药计划后，今天的任务会显示在这里。</Text>
          <Button onPress={() => router.push("/medication/new")}>新增药物</Button>
        </Card>
      ) : (
        occurrences.map((occurrence) => {
          const pending = occurrence.items.filter((item) => item.assertion === "pending").length;
          const confirmed = occurrence.items.length - pending;
          return (
            <Card
              accessibilityLabel={`${formatLocalTime(occurrence.plannedAt)}，${lifecycleLabel[occurrence.lifecycle]}`}
              key={occurrence.id}
              onPress={() => void openOccurrence(occurrence.id)}
              right={
                <StatusPill
                  label={lifecycleLabel[occurrence.lifecycle]}
                  tone={occurrence.lifecycle === "prepared" || occurrence.lifecycle === "missed" ? "warning" : "good"}
                />
              }
              title={formatLocalTime(occurrence.plannedAt)}
            >
              <View style={styles.items}>
                {occurrence.items.map((item) => (
                  <View key={item.id} style={styles.itemRow}>
                    <Text style={[styles.itemName, { color: colors.text, fontSize: 16 * textScale }]}>{item.displayName}</Text>
                    <View style={styles.itemNumbers}>
                      <Text style={[styles.quantity, { color: colors.muted, fontSize: 14 * textScale }]}>计划数量 {item.plannedDoseQuantity}</Text>
                      <Text style={[styles.quantity, { color: colors.muted, fontSize: 14 * textScale }]}>当前库存 {snapshot.medications.find((medication) => medication.id === item.medicationId)?.inventoryBalance ?? "暂无"}</Text>
                    </View>
                  </View>
                ))}
              </View>
              <Text style={[styles.meta, { color: colors.muted, fontSize: 14 * textScale }]}>{confirmed}/{occurrence.items.length} 项已确认</Text>
              <Text style={[styles.openHint, { color: colors.primary, fontSize: 14 * textScale }]}>点击卡片继续</Text>
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 15, lineHeight: 22 },
  items: { gap: spacing.sm },
  itemRow: { flexDirection: "row", gap: spacing.sm, justifyContent: "space-between" },
  itemNumbers: { alignItems: "flex-end", gap: 2 },
  itemName: { flex: 1, fontSize: 16, fontWeight: "600" },
  quantity: { fontSize: 14 },
  meta: { fontSize: 14 },
  openHint: { fontSize: 14, fontWeight: "600" },
});
