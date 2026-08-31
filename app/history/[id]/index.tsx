import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { demoApi } from "../../../src/features/demoApi";
import { medicationAppApi, type PhotoView } from "../../../src/features/medicationAppApi";
import {
  assertionLabel,
  formatLocalTime,
  lifecycleLabel,
} from "../../../src/features/labels";
import { useMedicationSnapshot } from "../../../src/state/useMedicationSnapshot";
import {
  Button,
  Card,
  Screen,
  StatusPill,
  colors,
  spacing,
} from "../../../src/ui";

export default function HistoryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const snapshot = useMedicationSnapshot();
  const occurrence = snapshot.occurrences.find((item) => item.id === id);
  const [photos, setPhotos] = useState<PhotoView[]>([]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void medicationAppApi.listPhotos(id).then((next) => {
        if (active) setPhotos(next);
      });
      return () => {
        active = false;
      };
    }, [id]),
  );

  if (!occurrence) {
    return (
      <Screen title="找不到记录">
        <Button onPress={() => router.replace("/(tabs)/history")}>返回记录</Button>
      </Screen>
    );
  }

  const revoke = () => {
    Alert.alert(
      "撤销本次服用记录？",
      "原记录不会被删除；系统会恢复相应库存，并标记为已撤销。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "确认撤销",
          style: "destructive",
          onPress: () => demoApi.revokeOccurrence(id),
        },
      ],
    );
  };

  const completed = occurrence.items.every((item) => item.assertion !== "pending");
  const modify = () => {
    if (occurrence.items.length === 1) {
      router.push(`/history/${id}/revise?itemId=${occurrence.items[0]!.id}`);
      return;
    }
    router.push(`/history/${id}/edit`);
  };
  return (
    <Screen
      headerRight={
        <Button onPress={() => router.replace("/(tabs)/history")} variant="text">
          返回
        </Button>
      }
      subtitle={formatLocalTime(occurrence.plannedAt)}
      title="本次记录"
    >
      {completed && occurrence.lifecycle !== "revoked" ? (
        <Card title="记录操作">
          <Button onPress={modify}>修改记录</Button>
          <Button onPress={() => router.push(`/history/${id}/retake`)} variant="secondary">
            重新拍照
          </Button>
        </Card>
      ) : null}

      <Card title="任务状态">
        <StatusPill label={lifecycleLabel[occurrence.lifecycle]} tone="good" />
        {occurrence.preparedAt ? (
          <Text style={styles.meta}>已准备：{formatLocalTime(occurrence.preparedAt)}</Text>
        ) : null}
        {occurrence.completedAt ? (
          <Text style={styles.meta}>完成记录：{formatLocalTime(occurrence.completedAt)}</Text>
        ) : null}
      </Card>

      <Card title={`照片记录（${photos.length}）`}>
        {photos.length === 0 ? <Text style={styles.body}>尚无照片或跳过记录。</Text> : photos.map((photo, index) => (
          <View key={photo.id} style={styles.itemCard}>
            <Text style={styles.itemTitle}>第 {index + 1} 条 · {formatLocalTime(photo.capturedAt)}</Text>
            <Text style={styles.meta}>{photo.capturePurpose === "retake" ? "重新拍摄" : "首次拍摄"}</Text>
            {photo.state === "captured" ? (
              <>
                <Text style={styles.meta}>画面物体数：{photo.detectedObjectCount ?? "未得到结果"}</Text>
                <Button onPress={() => router.push(`/history/${id}/photo/${photo.id}`)} variant="text">查看与管理照片</Button>
              </>
            ) : photo.state === "deleted_tombstone" ? (
              <Text style={styles.meta}>照片已永久删除</Text>
            ) : (
              <Text style={styles.meta}>本次无照片，已记录跳过原因。</Text>
            )}
          </View>
        ))}
      </Card>

      <Card title="逐药事实">
        <View style={styles.list}>
          {occurrence.items.map((item) => (
            <View key={item.id} style={styles.itemCard}>
              <Text style={styles.itemTitle}>{item.displayName}</Text>
              <Text style={styles.body}>{assertionLabel[item.assertion]}</Text>
              <Text style={styles.meta}>
                计划数量 {item.plannedDoseQuantity}；实际数量 {" "}
                {item.confirmedConsumptionQuantity === null
                  ? "待确认"
                  : item.confirmedConsumptionQuantity}
              </Text>
              {item.revisions.length ? (
                <Text style={styles.note}>已修订 {item.revisions.length} 次，原事实仍保留。</Text>
              ) : null}
              {item.assertion !== "pending" && occurrence.lifecycle !== "revoked" ? (
                <Button
                  onPress={() => router.push(`/history/${id}/revise?itemId=${item.id}`)}
                  variant="text"
                >
                  修订这项记录
                </Button>
              ) : null}
            </View>
          ))}
        </View>
      </Card>

      <Card title="当前剩余库存">
        {occurrence.items.map((item) => {
          const medication = snapshot.medications.find(
            (candidate) => candidate.id === item.medicationId,
          );
          return (
            <View key={item.id} style={styles.inventoryRow}>
              <Text style={styles.meta}>{item.displayName}</Text>
              <Text style={styles.inventoryQuantity}>
                {medication ? medication.inventoryBalance : "暂无库存数据"}
              </Text>
            </View>
          );
        })}
      </Card>

      {occurrence.lifecycle !== "revoked" &&
      occurrence.items.some((item) => item.assertion !== "pending") ? (
        <Button onPress={revoke} variant="danger">
          撤销本次记录
        </Button>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  meta: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  note: { color: colors.warning, fontSize: 13, lineHeight: 18 },
  list: { gap: spacing.sm },
  itemCard: { borderBottomColor: colors.border, borderBottomWidth: 1, gap: 4, paddingBottom: spacing.sm },
  itemTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  inventoryRow: { flexDirection: "row", justifyContent: "space-between" },
  inventoryQuantity: { color: colors.text, fontSize: 16, fontWeight: "700" },
});
