import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { AppState, Linking, View } from 'react-native';

import { validVisionId, VisionText } from '../../src/features/vision-lab-ui';
import { visionLabApi } from '../../src/features/visionLabApi';
import { expoEncryptedMediaDriver, photoSaveErrorMessage, PhotoSaveError } from '../../src/infrastructure/media';
import { Button, Card, Choice, Screen } from '../../src/ui';

export default function VisionCaptureScreen() {
  const { id, mode } = useLocalSearchParams<{ id: string; mode: string }>();
  const valid = validVisionId(id) && ['front', 'back', 'analysis'].includes(mode);
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [active, setActive] = useState(true);
  const [supported, setSupported] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const epoch = useRef(0);
  const [error, setError] = useState<string>();
  useFocusEffect(useCallback(() => {
    setActive(AppState.currentState === 'active');
    const sub = AppState.addEventListener('change', (state) => { setActive(state === 'active'); if (state !== 'active') epoch.current += 1; });
    return () => {
      sub.remove(); epoch.current += 1; setActive(false);
      try { void visionLabApi().cancel(); } catch { /* Runtime disposal also cancels analysis. */ }
    };
  }, []));
  const save = async () => {
    if (lock.current || !camera.current || !valid || supported === undefined) return;
    lock.current = true; setBusy(true); setError(undefined);
    let localUri: string | undefined;
    const started = epoch.current;
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.85, exif: false });
      localUri = photo?.uri;
      if (!localUri) throw new Error('相机未返回照片，请重试。');
      if (epoch.current !== started) throw new Error('拍摄已取消，请回到前台后重试。');
      if (mode === 'analysis') {
        const analysisId = await visionLabApi().analyze(id, localUri, supported);
        if (epoch.current === started) router.replace(`/vision/result/${analysisId}` as never);
      } else {
        await visionLabApi().captureBaseline(id, mode as 'front' | 'back', localUri, supported);
        if (epoch.current === started) router.back();
      }
    } catch (e) { setError(e instanceof PhotoSaveError ? photoSaveErrorMessage(e) : e instanceof Error ? e.message : '保存失败，请重拍。'); }
    finally {
      if (localUri) await expoEncryptedMediaDriver.deleteTemporaryFile(localUri).catch(() => undefined);
      lock.current = false; setBusy(false);
    }
  };
  return <Screen title={mode === 'analysis' ? '拍摄分析照片' : mode === 'front' ? '拍摄正面' : '拍摄背面'} headerRight={<Button disabled={busy} onPress={() => router.back()} variant="text">返回</Button>}>
    {!valid ? <VisionText error>无效的拍摄入口。</VisionText> : <>
      <Card><VisionText>{mode === 'analysis' ? '只放所选样本的 1—8 个对象，彼此分开。' : '只放一个完整对象。' } 使用哑光纯色背景，保持清晰、光线均匀。</VisionText></Card>
      <Choice role="radio" label="完整、不透明，无混批、遮挡或反光" selected={supported === true} onPress={() => { if (!busy) setSupported(true); }} />
      <Choice role="radio" label="含半片、破损、透明胶囊、混批或不确定情况" description="只保存照片，交由人工记录；不执行外观比较。" selected={supported === false} onPress={() => { if (!busy) setSupported(false); }} />
      {permission?.granted ? <View style={{ height: 340, overflow: 'hidden', borderRadius: 16, backgroundColor: '#111' }}>{active && <CameraView facing="back" ref={camera} style={{ flex: 1 }} />}</View> : <Button onPress={() => void (permission?.canAskAgain === false ? Linking.openSettings() : requestPermission())}>允许相机权限</Button>}
      {error && <VisionText error>{error}</VisionText>}
      <Button disabled={!permission?.granted || busy || supported === undefined || !active} onPress={() => void save()}>{busy ? '正在保存与检查…' : '手动拍照并保存'}</Button>
    </>}
  </Screen>;
}
