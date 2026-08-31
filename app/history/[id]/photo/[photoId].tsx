import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Image, StyleSheet, Text, View } from "react-native";

import { medicationAppApi, readableError, type PhotoView } from "../../../../src/features/medicationAppApi";
import { useAppAppearance } from "../../../../src/state/AppAppearanceProvider";
import { Button, Card, Screen } from "../../../../src/ui";

export default function PhotoDetailScreen() {
  const { id, photoId } = useLocalSearchParams<{ id: string; photoId: string }>();
  const { colors, textScale } = useAppAppearance();
  const [photo, setPhoto] = useState<PhotoView>();
  const [previewUri, setPreviewUri] = useState<string>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    let openedUri: string | undefined;
    void (async () => {
      try {
        const photos = await medicationAppApi.listPhotos(id);
        const selected = photos.find((item) => item.id === photoId);
        if (!selected) throw new Error("找不到这张照片记录。");
        if (!active) return;
        setPhoto(selected);
        if (selected.state === "captured") {
          const preview = await medicationAppApi.createPhotoPreview(selected.id);
          openedUri = preview.uri;
          if (active) setPreviewUri(preview.uri);
        }
      } catch (reason) {
        if (active) setError(readableError(reason));
      } finally {
        if (active) setBusy(false);
      }
    })();
    return () => {
      active = false;
      if (openedUri) void medicationAppApi.releasePhotoPreview(openedUri).catch(() => undefined);
    };
  }, [id, photoId]);

  const remove = () => {
    if (!photo) return;
    Alert.alert(
      "永久删除这张照片？",
      "照片内容和预览将被删除，之后无法恢复。任务、服用记录和库存不会改变。",
      [
        { text: "保留照片", style: "cancel" },
        {
          text: "永久删除",
          style: "destructive",
          onPress: () => void (async () => {
            setBusy(true);
            setError(undefined);
            try {
              await medicationAppApi.deletePhoto(photo.id);
              router.replace(`/history/${id}`);
            } catch (reason) {
              setError(readableError(reason));
            } finally {
              setBusy(false);
            }
          })(),
        },
      ],
    );
  };

  return (
    <Screen headerRight={<Button onPress={() => router.back()} variant="text">返回</Button>} title="照片详情">
      <Card>
        {previewUri ? <Image accessibilityLabel="本次照片预览" resizeMode="contain" source={{ uri: previewUri }} style={styles.image} /> : (
          <View style={[styles.placeholder, { backgroundColor: colors.border }]}>
            <Text style={[styles.placeholderText, { color: colors.muted, fontSize: 14 * textScale }]}>{busy ? "正在准备预览…" : photo?.state === "deleted_tombstone" ? "照片已永久删除" : "预览暂时不可用"}</Text>
          </View>
        )}
        {photo ? <Text style={[styles.meta, { color: colors.muted, fontSize: 13 * textScale }]}>拍摄时间：{new Date(photo.capturedAt).toLocaleString("zh-CN")}</Text> : null}
      </Card>
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger, fontSize: 14 * textScale }]}>{error}</Text> : null}
      {photo?.state === "captured" ? <Button disabled={busy} onPress={remove} variant="danger">永久删除照片</Button> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  image: { aspectRatio: 1, borderRadius: 14, width: "100%" },
  placeholder: { alignItems: "center", aspectRatio: 1, borderRadius: 14, justifyContent: "center", width: "100%" },
  placeholderText: { fontSize: 14 },
  meta: { fontSize: 13, lineHeight: 18 },
  error: { fontSize: 14, lineHeight: 20 },
});
