import { CameraView, useCameraPermissions } from "expo-camera";
import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  demoApi,
  type DemoPhotoEvidence,
} from "../../../src/features/demoApi";
import { useMedicationSnapshot } from "../../../src/state/useMedicationSnapshot";
import {
  captureAndCommitPhoto,
  photoSaveErrorMessage,
} from "../../../src/infrastructure/media";
import {
  Button,
  Card,
  Choice,
  Screen,
  colors,
  spacing,
} from "../../../src/ui";

type SkipReason = NonNullable<DemoPhotoEvidence["skipReason"]>;

export default function CaptureScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const snapshot = useMedicationSnapshot();
  const occurrence = snapshot.occurrences.find((item) => item.id === id);
  const [showSkip, setShowSkip] = useState(false);
  const [skipReason, setSkipReason] = useState<SkipReason>("camera_unavailable");
  const [saving, setSaving] = useState(false);
  const [captureError, setCaptureError] = useState<string>();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView | null>(null);

  if (!occurrence) {
    return (
      <Screen title="找不到任务">
        <Button onPress={() => router.replace("/(tabs)")}>返回今天</Button>
      </Screen>
    );
  }

  const saveCapture = async () => {
    if (!camera.current) {
      setCaptureError("相机尚未准备好，请稍后重试或记录无法拍照的原因。");
      return;
    }
    setSaving(true);
    setCaptureError(undefined);
    try {
      await captureAndCommitPhoto(
        () => camera.current!.takePictureAsync({ quality: 0.8 }),
        (localUri) => demoApi.saveCapturedPhoto(id, localUri),
      );
      router.replace(`/task/${id}/count`);
    } catch (error) {
      setCaptureError(photoSaveErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const saveSkip = async () => {
    if (saving) return;
    setSaving(true);
    setCaptureError(undefined);
    try {
      await demoApi.skipPhoto(id, skipReason);
      router.replace(`/task/${id}/confirm`);
    } catch {
      setCaptureError("当前任务状态已经变化，请返回今天页面后重新进入任务。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      headerRight={
        <Button onPress={() => router.back()} variant="text">
          返回
        </Button>
      }
      subtitle={showSkip ? undefined : "请将本次物品放在取景区域内。"}
      title={showSkip ? "说明无法拍照的原因" : occurrence.lifecycle === "missed" ? "补拍本次记录" : "拍摄本次记录"}
    >
      {showSkip ? (
        <>
          <Card title="选择原因">
            <View style={styles.choices}>
              <Choice
                label="相机无法使用"
                onPress={() => setSkipReason("camera_unavailable")}
                selected={skipReason === "camera_unavailable"}
              />
              <Choice
                label="当前环境不方便"
                onPress={() => setSkipReason("environment_inconvenient")}
                selected={skipReason === "environment_inconvenient"}
              />
              <Choice
                label="其他原因"
                onPress={() => setSkipReason("other")}
                selected={skipReason === "other"}
              />
            </View>
            {skipReason === "other" ? (
              <Text style={styles.hint}>当前只记录“其他原因”分类。</Text>
            ) : null}
          </Card>
          <Card>
            <Text style={styles.body}>
              本次会记录为“无照片人工确认”。你仍需逐种确认实际服用情况。
            </Text>
          </Card>
          {captureError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {captureError}
            </Text>
          ) : null}
          <Button disabled={saving} onPress={saveSkip}>
            {saving ? "正在保存…" : "记录原因并继续"}
          </Button>
          <Button onPress={() => setShowSkip(false)} variant="secondary">
            返回拍照
          </Button>
        </>
      ) : (
        <>
          <Card title="本次计划">
            {occurrence.items.map((item) => (
              <Text key={item.id} style={styles.item}>
                {item.displayName}：计划数量 {item.plannedDoseQuantity}
              </Text>
            ))}
          </Card>
          {!permission ? (
            <View style={styles.permissionCard}>
              <Text style={styles.hint}>正在检查相机权限…</Text>
            </View>
          ) : permission.granted ? (
            <View
              accessibilityLabel="相机取景区域。请将物品放置在框内。"
              style={styles.viewfinder}
            >
              <CameraView facing="back" ref={camera} style={StyleSheet.absoluteFill} />
              <View pointerEvents="none" style={styles.guide}>
                <Text style={styles.guideTitle}>取景区域</Text>
                <Text style={styles.guideText}>保持光线充足 · 物体分开 · 不要靠近边缘</Text>
              </View>
            </View>
          ) : (
            <View style={styles.permissionCard}>
              <Text style={styles.body}>需要相机权限才能拍摄本次记录。</Text>
              <Button onPress={requestPermission} variant="secondary">
                请求相机权限
              </Button>
            </View>
          )}
          {captureError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {captureError}
            </Text>
          ) : null}
          {permission?.granted ? (
            <Button disabled={saving} onPress={saveCapture}>
              {saving ? "正在保存照片…" : "手动拍照并保存"}
            </Button>
          ) : null}
          <Button onPress={() => setShowSkip(true)} variant="text">
            这次无法拍照
          </Button>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  choices: { gap: spacing.sm },
  body: { color: colors.text, fontSize: 15, lineHeight: 22, textAlign: "center" },
  item: { color: colors.text, fontSize: 15, lineHeight: 22 },
  viewfinder: {
    alignItems: "center",
    aspectRatio: 0.78,
    backgroundColor: "#263238",
    borderRadius: 18,
    justifyContent: "center",
    overflow: "hidden",
  },
  guide: {
    alignItems: "center",
    borderColor: "#FFFFFF",
    borderRadius: 18,
    borderStyle: "dashed",
    borderWidth: 2,
    height: "72%",
    justifyContent: "center",
    padding: spacing.lg,
    width: "78%",
  },
  guideTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "700" },
  guideText: { color: "#E6ECEF", fontSize: 14, lineHeight: 20, marginTop: 8, textAlign: "center" },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  permissionCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 14,
    gap: spacing.md,
    padding: spacing.lg,
  },
});
