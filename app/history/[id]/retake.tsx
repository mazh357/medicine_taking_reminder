import { CameraView, useCameraPermissions } from "expo-camera";
import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { demoApi } from "../../../src/features/demoApi";
import { medicationAppApi } from "../../../src/features/medicationAppApi";
import { captureAndCommitPhoto, photoSaveErrorMessage } from "../../../src/infrastructure/media";
import { useMedicationSnapshot } from "../../../src/state/useMedicationSnapshot";
import { Button, Card, Screen, colors, spacing } from "../../../src/ui";

export default function RetakeHistoryPhotoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const occurrence = useMedicationSnapshot().occurrences.find((item) => item.id === id);
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  if (!occurrence || occurrence.lifecycle === "revoked" || occurrence.items.some((item) => item.assertion === "pending")) {
    return <Screen title="无法重新拍照"><Button onPress={() => router.replace(`/history/${id}`)}>返回记录</Button></Screen>;
  }

  const save = async () => {
    if (!camera.current || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await captureAndCommitPhoto(
        () => camera.current!.takePictureAsync({ quality: 0.8 }),
        (localUri) => medicationAppApi.appendRetakePhoto(id, localUri),
      );
      try {
        const count = await demoApi.countCapturedPhoto(id);
        await demoApi.storeCountResult(id, count);
      } catch {
        // The encrypted photo is already saved; auxiliary count failure must not discard it.
      }
      router.replace(`/history/${id}`);
    } catch (failure) {
      setError(photoSaveErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      headerRight={<Button onPress={() => router.back()} variant="text">返回</Button>}
      subtitle="新照片会追加到记录中，旧照片和服药记录不会被替换。"
      title="重新拍照"
    >
      <Card title="本次记录">
        {occurrence.items.map((item) => <Text key={item.id}>{item.displayName}：实际数量 {item.confirmedConsumptionQuantity ?? 0}</Text>)}
      </Card>
      {!permission ? (
        <Text>正在检查相机权限…</Text>
      ) : permission.granted ? (
        <View accessibilityLabel="重新拍照取景区域" style={styles.viewfinder}>
          <CameraView facing="back" ref={camera} style={StyleSheet.absoluteFill} />
          <View pointerEvents="none" style={styles.guide}><Text style={styles.guideText}>保持光线充足 · 物体分开</Text></View>
        </View>
      ) : (
        <Card><Text>需要相机权限才能重新拍照。</Text><Button onPress={requestPermission}>请求相机权限</Button></Card>
      )}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {permission?.granted ? <Button disabled={saving} onPress={save}>{saving ? "正在保存…" : "拍照并保存"}</Button> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  viewfinder: { aspectRatio: 0.78, backgroundColor: "#263238", borderRadius: 18, overflow: "hidden" },
  guide: { alignItems: "center", borderColor: "#fff", borderRadius: 18, borderStyle: "dashed", borderWidth: 2, height: "72%", justifyContent: "center", margin: "11%", padding: spacing.lg },
  guideText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});
