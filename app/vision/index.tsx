import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { visionLabApi } from '../../src/features/visionLabApi';
import { useVisionLabScreen, VisionText } from '../../src/features/vision-lab-ui';
import { Button, Card, FormField, Screen } from '../../src/ui';

export default function VisionLabScreen() {
  const { data, error, busy, run } = useVisionLabScreen();
  const [label, setLabel] = useState('');
  const [capability, setCapability] = useState('正在检查');
  useEffect(() => {
    let active = true;
    void visionLabApi().capability().then((result) => { if (active) setCapability(result.tier === 'full' ? '外观比较实验已就绪' : result.tier === 'count_only' ? '当前仅计数；外观模型或评测尚未就绪' : '视觉暂不可用，仍可保存实验照片'); }).catch(() => { if (active) setCapability('视觉暂不可用'); });
    return () => { active = false; };
  }, []);
  return <Screen title="照片比较实验" subtitle="本地实验，不参与服药打卡或库存计算。" headerRight={<Button onPress={() => router.back()} variant="text">返回</Button>}>
    <Card><VisionText>{capability}</VisionText><VisionText>先创建匿名样本，再拍摄正面与背面。当前不识别药名，整组比较和远程识图未开放。</VisionText></Card>
    <Card title="新建样本">
      <FormField label="匿名标签" placeholder="例如：样本 A" value={label} onChangeText={setLabel} />
      <Button disabled={busy || !label.trim()} onPress={() => void run(async () => { const id = await visionLabApi().createSample(label); setLabel(''); router.push(`/vision/baseline/${id}` as never); })}>创建样本</Button>
    </Card>
    {error && <VisionText error>{error}</VisionText>}
    {data?.samples.filter((s) => !s.deleted_at_utc).map((sample) => {
      const versions = data.baselines.filter((b) => b.sample_id === sample.id && b.status !== 'deleted');
      const selected = versions.find((b) => b.status === 'draft') ?? versions.find((b) => b.status === 'active') ?? versions[0];
      return <Card key={sample.id} title={sample.label}>
        <VisionText>{versions.some((b) => b.status === 'active') ? '已有活动基线' : '尚未激活基线'}</VisionText>
        {selected && <Button onPress={() => router.push(`/vision/baseline/${selected.id}` as never)} variant="secondary">管理基线与分析</Button>}
      </Card>;
    })}
    {data && !data.samples.some((s) => !s.deleted_at_utc) && <VisionText>还没有样本。</VisionText>}
  </Screen>;
}
