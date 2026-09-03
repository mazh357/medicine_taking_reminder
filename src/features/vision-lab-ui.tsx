import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { AppState, Image, Text } from 'react-native';

import { useAppAppearance } from '../state/AppAppearanceProvider';
import { Button, Card } from '../ui';
import { visionLabApi, type VisionLabSnapshot, type VisionPhoto } from './visionLabApi';

export function VisionText({ children, error = false }: PropsWithChildren<{ error?: boolean }>) {
  const { colors, textScale } = useAppAppearance();
  return <Text selectable accessibilityRole={error ? 'alert' : undefined} style={{ color: error ? colors.danger : colors.text, fontSize: 15 * textScale, lineHeight: 23 * textScale }}>{children}</Text>;
}

export function useVisionLabScreen() {
  const [data, setData] = useState<VisionLabSnapshot>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const reload = useCallback(async () => { const result = await visionLabApi().snapshot(); if (mounted.current) setData(result); }, []);
  useFocusEffect(useCallback(() => {
    void reload().catch((e: unknown) => setError(e instanceof Error ? e.message : '读取失败，请重试。'));
  }, [reload]));
  const run = async (action: () => Promise<unknown>) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(undefined);
    try { await action(); await reload(); }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : '操作未完成，请重试。'); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  };
  return { data, error, busy, run, reload };
}

export function VisionPhotoCard({ photo, busy, onDelete }: { photo: VisionPhoto; busy: boolean; onDelete: () => void }) {
  const [uri, setUri] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const leased = useRef<string | undefined>(undefined);
  const generation = useRef(0);
  const loadingLock = useRef(false);
  const clear = useCallback(() => {
    generation.current += 1;
    const old = leased.current; leased.current = undefined; setUri(undefined);
    if (old) { try { void visionLabApi().releasePreview(old).catch(() => undefined); } catch { /* Runtime cleanup owns remaining previews. */ } }
  }, []);
  useFocusEffect(useCallback(() => {
    const sub = AppState.addEventListener('change', (state) => { if (state !== 'active') clear(); });
    return () => { sub.remove(); clear(); };
  }, [clear]));
  const preview = async () => {
    if (uri) { clear(); return; }
    if (loadingLock.current) return;
    loadingLock.current = true; setLoading(true); setError(undefined);
    const epoch = generation.current;
    try {
      const api = visionLabApi();
      const next = await api.preview(photo.id);
      if (generation.current !== epoch) { await api.releasePreview(next); return; }
      leased.current = next; setUri(next);
    } catch { setError('照片暂时无法解密预览，请稍后重试。'); }
    finally { loadingLock.current = false; setLoading(false); }
  };
  return <Card>
    <VisionText>{photo.purpose === 'front' ? '正面' : photo.purpose === 'back' ? '背面' : '分析照片'} · {new Date(photo.captured_at_utc).toLocaleString()}</VisionText>
    {photo.deleted_at_utc ? <VisionText>{photo.cleanupPending ? '照片已停止使用，文件清理待重试。' : '照片内容已删除'}</VisionText> : <>
      {photo.purpose !== 'analysis' && <VisionText>{photo.eligible ? '可用于基线设置' : '需要重拍：请使用单个完整对象、纯色背景并保持清晰。'}</VisionText>}
      {uri && <Image source={{ uri }} accessibilityLabel="已解密的实验照片预览" style={{ width: '100%', height: 240 }} resizeMode="contain" />}
      {error && <VisionText error>{error}</VisionText>}
      <Button disabled={loading} onPress={() => void preview()} variant="secondary">{loading ? '正在解密…' : uri ? '关闭预览' : '预览照片'}</Button>
      <Button disabled={busy} onPress={() => { clear(); onDelete(); }} variant="text">删除这张照片</Button>
    </>}
  </Card>;
}

export function validVisionId(value: unknown): value is string { return typeof value === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(value); }
