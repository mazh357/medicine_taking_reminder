import Constants from "expo-constants";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Linking, StyleSheet, Text, View } from "react-native";

import {
  medicationAppApi,
  readableError,
  type DeviceSelfCheck,
  type LocalDataSummary,
  type RuntimeVersionInfo,
  type TextSize,
  type ThemeMode,
} from "../../src/features/medicationAppApi";
import { useAppAppearance } from "../../src/state/AppAppearanceProvider";
import { useMedicationSnapshot } from "../../src/state/useMedicationSnapshot";
import { Button, Card, Choice, Screen, StatusPill, spacing } from "../../src/ui";

export default function SettingsScreen() {
  const snapshot = useMedicationSnapshot();
  const appearance = useAppAppearance();
  const [summary, setSummary] = useState<LocalDataSummary>();
  const [versionInfo, setVersionInfo] = useState<RuntimeVersionInfo>();
  const [versionError, setVersionError] = useState<string>();
  const [selfCheck, setSelfCheck] = useState<DeviceSelfCheck>();
  const [selfCheckBusy, setSelfCheckBusy] = useState(false);
  const [selfCheckError, setSelfCheckError] = useState<string>();
  const [testBusy, setTestBusy] = useState(false);
  const [testMessage, setTestMessage] = useState<string>();
  const [testError, setTestError] = useState<string>();
  const [appearanceBusy, setAppearanceBusy] = useState(false);
  const [appearanceError, setAppearanceError] = useState<string>();
  const [clearBusy, setClearBusy] = useState(false);
  const [clearError, setClearError] = useState<string>();

  useEffect(() => {
    void medicationAppApi.getLocalDataSummary().then(setSummary).catch(() => undefined);
  }, [snapshot]);

  useEffect(() => {
    void medicationAppApi.getRuntimeVersionInfo()
      .then(setVersionInfo)
      .catch((reason) => setVersionError(readableError(reason)));
  }, []);

  const saveAppearance = async (themeMode: ThemeMode, textSize: TextSize) => {
    if (appearanceBusy) return;
    setAppearanceBusy(true);
    setAppearanceError(undefined);
    try {
      await medicationAppApi.savePreferences(themeMode, textSize);
      appearance.applyPreferences(themeMode, textSize);
    } catch (reason) {
      setAppearanceError(readableError(reason));
    } finally {
      setAppearanceBusy(false);
    }
  };

  const runSelfCheck = async () => {
    setSelfCheckBusy(true);
    setSelfCheckError(undefined);
    try {
      setSelfCheck(await medicationAppApi.runSelfCheck());
    } catch (reason) {
      setSelfCheckError(readableError(reason));
    } finally {
      setSelfCheckBusy(false);
    }
  };

  const sendTestReminder = async () => {
    setTestBusy(true);
    setTestMessage(undefined);
    setTestError(undefined);
    try {
      await medicationAppApi.sendTestReminder();
      setTestMessage("测试提醒已安排，将在约 1 分钟后显示。");
    } catch (reason) {
      setTestError(readableError(reason));
    } finally {
      setTestBusy(false);
    }
  };

  const clear = () => {
    Alert.alert("清除全部本机数据？", "药物、照片、记录、库存、提醒和本机设置都会被清除，之后无法恢复。", [
      { text: "取消", style: "cancel" },
      {
        text: "确认清除",
        style: "destructive",
        onPress: () => void (async () => {
          setClearBusy(true);
          setClearError(undefined);
          try {
            await medicationAppApi.clearAll();
            router.replace("/(tabs)");
          } catch (reason) {
            setClearError(readableError(reason));
          } finally {
            setClearBusy(false);
          }
        })(),
      },
    ]);
  };

  return (
    <Screen title="设置">
      <Card title="用药与计划">
        <Text style={[styles.body, { color: appearance.colors.text, fontSize: 15 * appearance.textScale }]}>已启用 {snapshot.medications.filter((item) => item.active).length} 项 · 已暂停 {snapshot.medications.filter((item) => !item.active).length} 项</Text>
        <Button onPress={() => router.push("/(tabs)/medications")} variant="secondary">管理用药计划</Button>
      </Card>

      <Card title="设备与提醒">
        <Button disabled={selfCheckBusy} onPress={() => void runSelfCheck()} variant="secondary">{selfCheckBusy ? "正在检查…" : "运行设备自检"}</Button>
        {selfCheckError ? <Feedback error text={selfCheckError} /> : null}
        <Button disabled={testBusy} onPress={() => void sendTestReminder()} variant="secondary">{testBusy ? "正在安排…" : "1 分钟后测试提醒"}</Button>
        {testMessage ? <Feedback text={testMessage} /> : null}
        {testError ? <Feedback error text={testError} /> : null}
        <Button onPress={() => void Linking.openSettings()} variant="text">打开系统设置</Button>
        {selfCheck ? (
          <View style={styles.list}>
            {selfCheck.items.map((item) => (
              <View key={item.key} style={styles.row}>
                <View style={styles.flex}>
                  <Text style={[styles.rowTitle, { color: appearance.colors.text, fontSize: 14 * appearance.textScale }]}>{item.label}</Text>
                  <Text style={[styles.meta, { color: appearance.colors.muted, fontSize: 12 * appearance.textScale }]}>{item.detail}</Text>
                </View>
                <StatusPill label={item.status === "ok" ? "正常" : item.status === "checking" ? "检查中" : item.status === "warning" ? "需注意" : "不可用"} tone={item.status === "ok" ? "good" : "warning"} />
              </View>
            ))}
            <Text style={[styles.meta, { color: appearance.colors.muted }]}>最近检查：{new Date(selfCheck.checkedAt).toLocaleString("zh-CN")}</Text>
          </View>
        ) : null}
      </Card>

      <Card title="外观与文字">
        <Text style={[styles.label, { color: appearance.colors.text }]}>主题</Text>
        <View style={styles.list}>
          {(["system", "light", "dark"] as ThemeMode[]).map((mode) => (
            <Choice key={mode} label={{ system: "跟随系统", light: "浅色", dark: "深色" }[mode]} onPress={() => void saveAppearance(mode, appearance.textSize)} selected={appearance.themeMode === mode} />
          ))}
        </View>
        <Text style={[styles.label, { color: appearance.colors.text }]}>文字大小</Text>
        <View style={styles.list}>
          {(["standard", "large", "extra_large"] as TextSize[]).map((size) => (
            <Choice key={size} label={{ standard: "标准", large: "大", extra_large: "特大" }[size]} onPress={() => void saveAppearance(appearance.themeMode, size)} selected={appearance.textSize === size} />
          ))}
        </View>
        {appearanceBusy ? <Text style={[styles.meta, { color: appearance.colors.muted }]}>正在保存显示设置…</Text> : null}
        {appearanceError ? <Feedback error text={appearanceError} /> : null}
      </Card>

      <Card title="照片与数据">
        <Text style={[styles.body, { color: appearance.colors.text, fontSize: 15 * appearance.textScale }]}>药物 {summary?.medicationCount ?? "—"} · 任务 {summary?.occurrenceCount ?? "—"} · 照片 {summary?.activePhotoCount ?? "—"} · 已删除 {summary?.deletedPhotoCount ?? "—"}</Text>
        <Button onPress={() => router.push("/(tabs)/history")} variant="secondary">管理照片与记录</Button>
        <Button disabled={clearBusy} onPress={clear} variant="danger">{clearBusy ? "正在清除…" : "清除全部本机数据"}</Button>
        {clearError ? <Feedback error text={clearError} /> : null}
      </Card>

      <Card title="版本信息">
        <Text style={[styles.body, { color: appearance.colors.text, fontSize: 15 * appearance.textScale }]}>长期用药助手 {Constants.expoConfig?.version ?? "0.1.0"}</Text>
        <Text style={[styles.meta, { color: appearance.colors.muted }]}>构建号 {Constants.expoConfig?.android?.versionCode ?? "—"} · 本机离线运行</Text>
        <Text style={[styles.meta, { color: appearance.colors.muted }]}>数据库格式 {formatVersion(versionInfo?.databaseSchemaVersion)} · 媒体格式 {formatVersion(versionInfo?.mediaFormatVersion)}</Text>
        {versionError ? <Feedback error text={`版本信息未读取：${versionError}`} /> : null}
      </Card>
    </Screen>
  );
}

function formatVersion(value: number | null | undefined): string {
  return typeof value === "number" ? `v${value}` : "未读取";
}

function Feedback({ text, error = false }: { text: string; error?: boolean }) {
  const appearance = useAppAppearance();
  return <Text accessibilityLiveRegion="polite" accessibilityRole={error ? "alert" : undefined} style={[styles.feedback, { color: error ? appearance.colors.danger : appearance.colors.primary, fontSize: 14 * appearance.textScale }]}>{text}</Text>;
}

const styles = StyleSheet.create({
  body: { fontSize: 15, lineHeight: 22 },
  meta: { fontSize: 12, lineHeight: 18 },
  label: { fontSize: 15, fontWeight: "700" },
  list: { gap: spacing.sm },
  row: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  flex: { flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: "600" },
  feedback: { fontSize: 14, lineHeight: 20 },
});
