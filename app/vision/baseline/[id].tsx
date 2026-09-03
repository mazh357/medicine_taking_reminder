import { router, useLocalSearchParams } from 'expo-router';
import { Alert } from 'react-native';

import { visionLabApi } from '../../../src/features/visionLabApi';
import { useVisionLabScreen, validVisionId, VisionPhotoCard, VisionText } from '../../../src/features/vision-lab-ui';
import { Button, Card, Screen } from '../../../src/ui';

export default function BaselineScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, busy, run } = useVisionLabScreen();
  const version = validVisionId(id) ? data?.baselines.find((b) => b.id === id) : undefined;
  const sample = data?.samples.find((s) => s.id === version?.sample_id);
  const photos = data?.photos.filter((p) => p.baseline_id === id && p.purpose !== 'analysis') ?? [];
  const latest = (side: 'front' | 'back') => photos.filter((p) => p.purpose === side).at(-1);
  const eligible = latest('front')?.eligible && latest('back')?.eligible;
  const openCamera = (mode: string) => router.push({ pathname: '/vision/capture' as never, params: { id, mode } });
  return <Screen title={sample?.label ?? '样本基线'} headerRight={<Button onPress={() => router.back()} variant="text">返回</Button>}>
    {error && <VisionText error>{error}</VisionText>}
    {!version ? <VisionText>{data ? '基线不存在。' : '正在读取…'}</VisionText> : <>
      <Card title={version.status === 'draft' ? '设置基线' : version.status === 'active' ? '当前活动基线' : '历史基线'}>
        <VisionText>{new Date(version.created_at_utc).toLocaleString()}</VisionText>
        {version.status === 'draft' && <>
          <VisionText>每面只拍一个完整对象，正面与背面各一张。激活后不可覆盖；换批次需建立新版本。</VisionText>
          <Button disabled={busy} onPress={() => openCamera('front')} variant="secondary">拍摄／重拍正面</Button>
          <Button disabled={busy} onPress={() => openCamera('back')} variant="secondary">拍摄／重拍背面</Button>
          <Button disabled={busy || !eligible} onPress={() => void run(() => visionLabApi().activate(id))}>激活此基线</Button>
        </>}
        {version.status === 'active' && <Button disabled={busy} onPress={() => openCamera('analysis')}>拍照并分析此样本</Button>}
        {version.status !== 'deleted' && version.status !== 'draft' && <Button disabled={busy} onPress={() => void run(async () => { const next = await visionLabApi().createVersion(version.sample_id); router.push(`/vision/baseline/${next}` as never); })} variant="secondary">建立新批次基线</Button>}
      </Card>
      {photos.map((photo) => <VisionPhotoCard key={photo.id} photo={photo} busy={busy} onDelete={() => Alert.alert('永久删除照片？', '照片内容无法恢复，删除记录仍保留。删除活动基线照片会停用该基线。', [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => void run(() => visionLabApi().deletePhoto(photo.id)) }])} />)}
      <Card title="分析历史">
        {data?.analyses.filter((a) => a.baseline_id === id).map((a) => <Button key={a.id} onPress={() => router.push(`/vision/result/${a.id}` as never)} variant="secondary">{new Date(a.recorded_at_utc).toLocaleString()}</Button>)}
        {!data?.analyses.some((a) => a.baseline_id === id) && <VisionText>暂无分析。</VisionText>}
      </Card>
      <Card title="全部版本">
        {data?.baselines.filter((b) => b.sample_id === version.sample_id && b.id !== id).map((b) => <Button key={b.id} onPress={() => router.replace(`/vision/baseline/${b.id}` as never)} variant="text">{new Date(b.created_at_utc).toLocaleString()} · {b.status === 'active' ? '活动' : b.status === 'draft' ? '草稿' : '历史'}</Button>)}
      </Card>
      {sample && !sample.deleted_at_utc && <Button disabled={busy} variant="text" onPress={() => Alert.alert('删除整个实验样本？', '其所有实验照片将永久删除；保留删除记录。不影响用药与库存。', [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => void run(async () => { await visionLabApi().deleteSample(sample.id); router.replace('/vision' as never); }) }])}>删除样本及照片</Button>}
    </>}
  </Screen>;
}
