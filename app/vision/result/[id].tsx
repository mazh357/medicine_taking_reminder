import { router, useLocalSearchParams } from 'expo-router';
import { Alert, View } from 'react-native';

import { useVisionLabScreen, validVisionId, VisionPhotoCard, VisionText } from '../../../src/features/vision-lab-ui';
import { visionLabApi, type VisionAnnotation } from '../../../src/features/visionLabApi';
import { Button, Card, Screen } from '../../../src/ui';

const labels: Record<VisionAnnotation['value'], string> = { looks_similar: '人工：外观相近', looks_different: '人工：有差异', unable: '人工：无法判断' };
export default function VisionResultScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, busy, run } = useVisionLabScreen();
  const analysis = validVisionId(id) ? data?.analyses.find((a) => a.id === id) : undefined;
  const photo = data?.photos.find((p) => p.id === analysis?.photo_id);
  const result = analysis?.result;
  const annotations = data?.annotations.filter((a) => a.analysis_id === id) ?? [];
  const annotate = (index: number | null) => <View style={{ gap: 8 }}>
    {(Object.keys(labels) as VisionAnnotation['value'][]).map((value) => <Button key={value} disabled={busy} variant="secondary" onPress={() => void run(() => visionLabApi().annotate(id, index, value))}>{labels[value]}</Button>)}
  </View>;
  return <Screen title="视觉观察详情" headerRight={<Button onPress={() => router.back()} variant="text">返回</Button>}>
    {error && <VisionText error>{error}</VisionText>}
    {!analysis || !result ? <VisionText>{data ? '分析不存在。' : '正在读取…'}</VisionText> : <>
      <Card>
        <VisionText>{new Date(analysis.recorded_at_utc).toLocaleString()}</VisionText>
        <VisionText>{result.count.status === 'counted' ? `照片检测物体数：${result.count.detectedObjectCount}` : '照片物体数：无法判断'}</VisionText>
        <VisionText>{result.appearance.status === 'assessed' && result.appearance.candidates.some((c) => c.outcome === 'suspected_change') ? '疑似整体外观差异，请人工查看。' : '外观需要人工查看。'}</VisionText>
        {result.capabilityTier !== 'full' && <VisionText>当前未启用经过评测的外观模型，仅保留照片、计数及人工标注。</VisionText>}
      </Card>
      {photo && <VisionPhotoCard photo={photo} busy={busy} onDelete={() => Alert.alert('永久删除照片？', '保留分析及删除记录，照片内容无法恢复。', [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => void run(() => visionLabApi().deletePhoto(photo.id)) }])} />}
      {photo && !photo.deleted_at_utc && <Button disabled={busy} onPress={() => void run(async () => { const next = await visionLabApi().retryAnalysis(photo.id); router.replace(`/vision/result/${next}` as never); })}>使用原照片重试分析</Button>}
      <Card title="人工标注整张照片">{annotate(null)}</Card>
      {result.count.status === 'counted' && result.count.boxes.map((box, index) => <Card key={index} title={`对象 ${index + 1}（按从上到下、从左到右排列）`}>
        <VisionText>位置：距左约 {Math.round(box.x * 100)}%，距上约 {Math.round(box.y * 100)}%</VisionText>
        {annotate(index)}
      </Card>)}
      <Card title="标注历史">
        {annotations.length ? annotations.map((a) => <VisionText key={a.id}>{a.object_index === null ? '整张照片' : `对象 ${a.object_index + 1}`} · {labels[a.value]} · {new Date(a.recorded_at_utc).toLocaleString()}</VisionText>) : <VisionText>尚无人工标注。</VisionText>}
      </Card>
      <Button variant="secondary" onPress={() => router.replace(`/vision/baseline/${analysis.baseline_id}` as never)}>返回基线与重新拍摄</Button>
    </>}
  </Screen>;
}
