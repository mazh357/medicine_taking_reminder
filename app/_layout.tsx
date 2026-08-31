import * as Notifications from "expo-notifications";
import { router, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, AppState, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { installDemoApi } from "../src/features/demoApi";
import { installMedicationAppCapabilities, medicationAppApi } from "../src/features/medicationAppApi";
import { occurrenceEntryPath, resolveOccurrenceEntry } from "../src/features/occurrenceEntryPolicy";
import { createDemoRuntime } from "../src/infrastructure/runtime";
import { AppAppearanceProvider } from "../src/state/AppAppearanceProvider";
import { ForegroundLifecycleReconciler } from "../src/state/ForegroundLifecycleReconciler";
import { colors } from "../src/ui";
import { Button } from "../src/ui/Button";

type RuntimeState =
  | { status: "starting" }
  | { status: "ready" }
  | { status: "failed"; message: string };

export default function RootLayout() {
  const [runtimeState, setRuntimeState] = useState<RuntimeState>({ status: "starting" });
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setRuntimeState({ status: "starting" });
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    let mounted = true;
    let dispose: (() => Promise<void>) | undefined;
    let removeAppState: (() => void) | undefined;
    let stopReconciler: (() => void) | undefined;
    createDemoRuntime()
      .then((runtime) => {
        if (!mounted) {
          void runtime.dispose();
          return;
        }
        let clearing = false;
        installMedicationAppCapabilities({
          createMedication: (input) => runtime.api.createPersonalMedication(input),
          updatePlan: (id, input) => runtime.api.updatePlan(id, input),
          pausePlan: (id) => runtime.api.pausePlan(id),
          resumePlan: (id) => runtime.api.resumePlan(id),
          correctInventory: (id, target, reason) => runtime.api.correctInventory(id, target, reason),
          savePreferences: (theme, size) => runtime.api.savePreferences(theme, size),
          getPreferences: () => runtime.api.getPreferences(),
          runSelfCheck: () => runtime.api.runSelfCheck(),
          sendTestReminder: () => runtime.api.sendTestReminder(),
          getRuntimeVersionInfo: () => runtime.api.getRuntimeVersionInfo(),
          createFollowUp: (input) => runtime.api.createFollowUp(input),
          updateFollowUp: (id, input) => runtime.api.updateFollowUp(id, input),
          completeFollowUp: (id) => runtime.api.completeFollowUp(id),
          cancelFollowUp: (id) => runtime.api.cancelFollowUp(id),
          setRefillReminderDays: (id, days) => runtime.api.setRefillReminderDays(id, days),
          getLocalDataSummary: () => runtime.api.getLocalDataSummary(),
          listPhotos: (occurrenceId) => runtime.api.listPhotos(occurrenceId),
          createPhotoPreview: (photoId) => runtime.api.createPhotoPreview(photoId),
          releasePhotoPreview: (uri) => runtime.api.releasePhotoPreview(uri),
          deletePhoto: (photoId) => runtime.api.deletePhoto(photoId),
          reconcileToday: () => runtime.api.reconcileToday(),
          startOccurrenceEarly: (occurrenceId) => runtime.api.startOccurrenceEarly(occurrenceId),
          appendRetakePhoto: (occurrenceId, localUri) =>
            runtime.api.appendRetakePhoto(occurrenceId, localUri),
          clearAll: async () => {
            if (clearing) throw new Error("本机数据清除正在进行中。");
            clearing = true;
            // Revoke every UI capability before the first destructive step so
            // no mounted or delayed caller can continue using the old runtime.
            installMedicationAppCapabilities({});
            removeAppState?.();
            stopReconciler?.();
            if (mounted) setRuntimeState({ status: "starting" });
            try {
              await runtime.api.clearAll();
              const finishDisposal = dispose;
              dispose = undefined;
              await finishDisposal?.();
              if (mounted) setAttempt((value) => value + 1);
            } catch (error) {
              if (mounted) {
                setRuntimeState({
                  status: "failed",
                  message: error instanceof Error ? error.message : "本机数据清除未完成",
                });
              }
              throw error;
            }
          },
        });
        installDemoApi(runtime.api);
        dispose = runtime.dispose;
        const reconciler = new ForegroundLifecycleReconciler({
          now: () => Date.now(),
          reconcile: () => runtime.reconcile(),
          occurrences: () => runtime.api.getSnapshot().occurrences,
          setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
          clearTimer: (handle) => clearTimeout(handle),
        });
        if (AppState.currentState === "active" || AppState.currentState == null) reconciler.start();
        const appState = AppState.addEventListener("change", (state) => {
          if (state === "active") reconciler.start();
          else reconciler.stop();
        });
        removeAppState = () => appState.remove();
        stopReconciler = () => reconciler.stop();
        setRuntimeState({ status: "ready" });
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        setRuntimeState({
          status: "failed",
          message: error instanceof Error ? error.message : "未知初始化错误",
        });
      });
    return () => {
      mounted = false;
      removeAppState?.();
      stopReconciler?.();
      void dispose?.();
    };
  }, [attempt]);

  useEffect(() => {
    if (runtimeState.status !== "ready") return;
    let active = true;
    const openOccurrence = async (response: Notifications.NotificationResponse | null) => {
      if (!active || !response) return;
      const occurrenceId = response.notification.request.content.data?.occurrenceId;
      if (typeof occurrenceId === "string" && /^[a-z0-9-]{8,80}$/.test(occurrenceId)) {
        await medicationAppApi.reconcileToday().catch(() => undefined);
        const occurrence = medicationAppApi
          .getSnapshot()
          .occurrences.find((candidate) => candidate.id === occurrenceId);
        if (!occurrence) {
          router.replace("/(tabs)");
          return;
        }
        const destination = resolveOccurrenceEntry(occurrence);
        if (destination === "confirm_early") router.replace("/(tabs)");
        else router.push(occurrenceEntryPath(occurrenceId, destination));
        return;
      }
      if (response.notification.request.content.data?.kind === "daily_medication_reminder") {
        router.replace("/(tabs)");
        return;
      }
      const auxiliaryKind = response.notification.request.content.data?.kind;
      if (auxiliaryKind === "test_reminder") {
        router.replace("/(tabs)");
        return;
      }
      if (
        auxiliaryKind === "refill" ||
        auxiliaryKind === "follow_up_advance" ||
        auxiliaryKind === "follow_up_due"
      ) {
        router.replace("/(tabs)/followups" as never);
      }
    };
    void Notifications.getLastNotificationResponseAsync().then((response) => void openOccurrence(response));
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => void openOccurrence(response),
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, [runtimeState.status]);

  return (
    <SafeAreaProvider>
      <AppAppearanceProvider>
        <SafeAreaView style={styles.root}>
          <StatusBar style="auto" />
          {runtimeState.status === "ready" ? (
            <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }} />
          ) : runtimeState.status === "starting" ? (
            <View accessibilityLiveRegion="polite" style={styles.center}>
              <ActivityIndicator color={colors.primary} size="large" />
              <Text style={styles.title}>正在准备本地数据</Text>
              <Text style={styles.body}>完成后将直接进入今天。</Text>
            </View>
          ) : (
            <View accessibilityLiveRegion="assertive" style={styles.center}>
              <Text style={styles.title}>本地数据暂时无法打开</Text>
              <Text style={styles.body}>
                为保护已有记录，应用没有继续进入业务页面。请先重试。
              </Text>
              <Text selectable style={styles.detail}>
                {runtimeState.message}
              </Text>
              <Button onPress={retry}>重试</Button>
            </View>
          )}
        </SafeAreaView>
      </AppAppearanceProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flex: 1 },
  center: {
    alignItems: "center",
    flex: 1,
    gap: 12,
    justifyContent: "center",
    padding: 24,
  },
  title: { color: colors.text, fontSize: 20, fontWeight: "700", textAlign: "center" },
  body: { color: colors.text, fontSize: 15, lineHeight: 22, textAlign: "center" },
  detail: { color: colors.muted, fontSize: 12, lineHeight: 17, textAlign: "center" },
});
