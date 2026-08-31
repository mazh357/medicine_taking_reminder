import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text } from "react-native";

import {
  demoApi,
  type DemoCountResult,
} from "../../../src/features/demoApi";
import { countUnableLabel } from "../../../src/features/labels";
import { useMedicationSnapshot } from "../../../src/state/useMedicationSnapshot";
import {
  Button,
  Card,
  FormField,
  Screen,
  StatusPill,
  colors,
  spacing,
} from "../../../src/ui";

export default function CountResultScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const snapshot = useMedicationSnapshot();
  const occurrence = snapshot.occurrences.find((item) => item.id === id);
  const started = useRef(false);
  const [result, setResult] = useState<DemoCountResult | null>(null);
  const [manual, setManual] = useState("");
  const [manualError, setManualError] = useState<string>();

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    demoApi
      .countCapturedPhoto(id)
      .then(async (next) => {
        await demoApi.storeCountResult(id, next);
        setResult(next);
      })
      .catch(() => {
        const unable: DemoCountResult = { status: "unable", reason: "processing_error" };
        demoApi.storeCountResult(id, unable).finally(() => setResult(unable));
      });
  }, [id]);

  if (!occurrence) {
    return (
      <Screen title="找不到任务">
        <Button onPress={() => router.replace("/(tabs)")}>返回今天</Button>
      </Screen>
    );
  }

  const saveManual = async () => {
    const parsed = Number(manual);
    if (!Number.isInteger(parsed) || parsed < 0) {
      setManualError("请输入大于或等于 0 的整数。");
      return;
    }
    await demoApi.storeManualObjectCount(id, parsed);
    router.replace(`/task/${id}/confirm`);
  };

  return (
    <Screen
      headerRight={<StatusPill label={occurrence.lifecycle === "missed" ? "补录中" : "已准备·待确认"} tone="warning" />}
      title="照片辅助信息"
    >
      <Card title="物体计数">
        {!result ? (
          <Text accessibilityRole="alert" style={styles.body}>
            正在进行辅助查看，不影响继续记录。
          </Text>
        ) : result.status === "counted" ? (
          <>
            <Text style={styles.count}>{result.detectedObjectCount}</Text>
            <Text style={styles.center}>画面中检测到的独立物体数</Text>
          </>
        ) : (
          <>
            <StatusPill label="无法判断" />
            <Text style={styles.body}>{countUnableLabel[result.reason]}。照片仍已保存。</Text>
          </>
        )}
      </Card>
      <Card title="人工填写照片中的物体总数（可选）">
        <FormField
          error={manualError}
          hint="可选"
          keyboardType="number-pad"
          label="画面物体总数"
          onChangeText={setManual}
          value={manual}
        />
        <Button onPress={saveManual} variant="secondary">
          保存人工填写并继续
        </Button>
      </Card>
      <Button onPress={() => router.replace(`/task/${id}/confirm`)}>
        继续逐药确认
      </Button>
      <Button onPress={() => router.replace(`/task/${id}/capture`)} variant="text">
        重新拍摄
      </Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  count: { color: colors.primary, fontSize: 54, fontWeight: "800", textAlign: "center" },
  center: { color: colors.text, fontSize: 15, textAlign: "center" },
  warning: { backgroundColor: colors.warningSoft, borderRadius: 10, marginTop: spacing.xs, padding: spacing.sm },
  warningText: { color: colors.warning, fontSize: 14, lineHeight: 20 },
});
