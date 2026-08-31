import { router, useLocalSearchParams } from "expo-router";
import { StyleSheet, Text } from "react-native";

import { demoApi } from "../../../src/features/demoApi";
import { DoseItemConfirmationCard } from "../../../src/features/DoseItemConfirmationCard";
import { useMedicationSnapshot } from "../../../src/state/useMedicationSnapshot";
import { Button, Card, Screen, StatusPill, colors } from "../../../src/ui";

export default function ConfirmDoseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const snapshot = useMedicationSnapshot();
  const occurrence = snapshot.occurrences.find((item) => item.id === id);

  if (!occurrence) {
    return (
      <Screen title="找不到任务">
        <Button onPress={() => router.replace("/(tabs)")}>返回今天</Button>
      </Screen>
    );
  }

  const pendingCount = occurrence.items.filter((item) => item.assertion === "pending").length;

  return (
    <Screen
      headerRight={<StatusPill label={occurrence.lifecycle === "missed" ? "补录中" : "已准备·待确认"} tone="warning" />}
      title="逐药确认"
    >
      {occurrence.photo?.state === "skipped_with_reason" ? (
        <Card>
          <Text style={styles.notice}>本次无照片，按你的实际情况人工确认。</Text>
        </Card>
      ) : occurrence.photo?.detectedObjectCount !== null && occurrence.photo ? (
        <Card title="照片辅助信息">
          <Text style={styles.notice}>
            画面物体数：{occurrence.photo.detectedObjectCount}
          </Text>
        </Card>
      ) : null}

      {occurrence.items.map((item) => (
        <DoseItemConfirmationCard
          item={item}
          key={item.id}
          onConfirm={(assertion, quantity) =>
            demoApi.confirmDoseItem(id, item.id, assertion, quantity)
          }
          onRevise={() => router.push(`/history/${id}/revise?itemId=${item.id}`)}
        />
      ))}

      {pendingCount > 0 ? (
        <>
          <Text style={styles.pending}>
            还有 {pendingCount} 种药待确认，本次任务不会标为完成。
          </Text>
          <Button onPress={() => router.replace("/(tabs)")} variant="secondary">
            稍后继续
          </Button>
          <Button onPress={() => router.replace(`/task/${id}/capture`)} variant="text">
            重新拍摄
          </Button>
        </>
      ) : (
        <Button onPress={() => router.replace(`/history/${id}`)}>完成本次记录</Button>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  notice: { color: colors.text, fontSize: 14, lineHeight: 20 },
  pending: { color: colors.muted, fontSize: 14, lineHeight: 20 },
});
