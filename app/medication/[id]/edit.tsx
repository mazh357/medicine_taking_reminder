import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { inventoryPredictionLines } from "../../../src/features/inventoryPredictionLabels";
import {
  isValidReminderTime,
  isValidScheduleQuantity,
  MAX_MEDICATION_SCHEDULES,
  nextAvailableReminderTime,
} from "../../../src/features/medication-schedule-ui";
import {
  medicationAppApi,
  readableError,
  type MedicationScheduleView,
  type RefillReminderDays,
} from "../../../src/features/medicationAppApi";
import { useAppAppearance } from "../../../src/state/AppAppearanceProvider";
import { useMedicationSnapshot } from "../../../src/state/useMedicationSnapshot";
import {
  Button,
  Card,
  Choice,
  FormField,
  Screen,
  StatusPill,
  TimePickerField,
  spacing,
} from "../../../src/ui";

type RunOperation = (operation: () => Promise<void>) => Promise<boolean>;

function planStatus(medication: ReturnType<typeof useMedicationSnapshot>["medications"][number]) {
  if (medication.planState === "paused") return { label: "整体暂停", tone: "warning" as const };
  if (medication.planState === "no_schedule") return { label: "无时段", tone: "neutral" as const };
  if (medication.schedules.length > 0 && medication.schedules.every((item) => item.status === "paused")) {
    return { label: "时段均暂停", tone: "warning" as const };
  }
  return { label: "已启用", tone: "good" as const };
}

export default function EditMedicationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, textScale } = useAppAppearance();
  const snapshot = useMedicationSnapshot();
  const medication = snapshot.medications.find((item) => item.id === id);
  const [inventory, setInventory] = useState(String(medication?.inventoryBalance ?? 0));
  const [inventoryReason, setInventoryReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [refillBusy, setRefillBusy] = useState(false);
  const [refillError, setRefillError] = useState<string>();

  if (!medication) {
    return (
      <Screen title="找不到药物">
        <Card><Button onPress={() => router.replace("/(tabs)/medications")}>返回用药计划</Button></Card>
      </Screen>
    );
  }

  const run: RunOperation = async (operation) => {
    if (busy) return false;
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await operation();
      return true;
    } catch (reason) {
      setError(readableError(reason));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const toggleMedication = () => {
    const pausing = medication.planState === "active";
    const action = pausing ? "暂停" : "恢复";
    Alert.alert(
      `${action}这个药物的全部提醒？`,
      pausing
        ? "尚未开始的任务会按生效日期停止生成，已开始的记录不会改变。各时段原有的启停状态会保留。"
        : "系统会恢复药物级提醒，但不会开启之前单独暂停的时段。",
      [
        { text: "取消", style: "cancel" },
        {
          text: `确认${action}`,
          onPress: () => void run(async () => {
            const result = pausing
              ? await medicationAppApi.pauseMedication(medication.id)
              : await medicationAppApi.resumeMedication(medication.id);
            setMessage(`${action}已保存，${result.effective === "today" ? "今天" : "明天"}生效。`);
          }),
        },
      ],
    );
  };

  return (
    <Screen headerRight={<Button onPress={() => router.back()} variant="text">返回</Button>} title="修改计划与库存">
      <Card
        right={
          <StatusPill
            label={planStatus(medication).label}
            tone={planStatus(medication).tone}
          />
        }
        title={medication.name}
      >
        <Text style={[styles.body, { color: colors.text, fontSize: 15 * textScale }]}>当前库存：{medication.inventoryBalance}</Text>
        {medication.schedules.length > 0 ? (
          <Button disabled={busy} onPress={toggleMedication} variant={medication.planState === "active" ? "secondary" : "primary"}>
            {medication.planState === "active" ? "暂停全部提醒" : "恢复药物提醒"}
          </Button>
        ) : null}
      </Card>

      <Card
        right={<Text style={[styles.count, { color: colors.muted, fontSize: 13 * textScale }]}>{medication.schedules.length}/{MAX_MEDICATION_SCHEDULES}</Text>}
        title="每日服用时段"
      >
        {medication.schedules.length === 0 ? (
          <Text style={[styles.meta, { color: colors.muted, fontSize: 13 * textScale }]}>暂无提醒时段。药物、库存和既往记录仍然保留。</Text>
        ) : (
          medication.schedules.map((schedule, index) => (
            <ScheduleEditorCard
              busy={busy}
              index={index}
              key={schedule.id}
              otherTimes={medication.schedules.filter((item) => item.id !== schedule.id).map((item) => item.reminderTime)}
              run={run}
              schedule={schedule}
              setMessage={setMessage}
            />
          ))
        )}
        {medication.schedules.length < MAX_MEDICATION_SCHEDULES ? (
          <AddScheduleCard
            busy={busy}
            existingTimes={medication.schedules.map((item) => item.reminderTime)}
            medicationId={medication.id}
            run={run}
            setMessage={setMessage}
          />
        ) : (
          <Text style={[styles.meta, { color: colors.muted, fontSize: 13 * textScale }]}>已达到每个药物最多 8 个时段。</Text>
        )}
      </Card>

      <Card title="库存预测与补药提醒">
        {inventoryPredictionLines(medication.inventoryPrediction).map((line) => (
          <Text key={line} style={[styles.meta, { color: colors.muted, fontSize: 13 * textScale }]}>{line}</Text>
        ))}
        <Text style={[styles.label, { color: colors.text, fontSize: 15 * textScale }]}>补药提醒</Text>
        {[0, 3, 7, 14, 30].map((days) => (
          <Choice
            key={days}
            label={days === 0 ? "不提醒" : `提前 ${days} 天`}
            onPress={() => void (async () => {
              setRefillBusy(true);
              setRefillError(undefined);
              try {
                await medicationAppApi.setRefillReminderDays(medication.id, days as RefillReminderDays);
                setMessage(days === 0 ? "已关闭补药提醒。" : `补药提醒已设为提前 ${days} 天。`);
              } catch (reason) {
                setRefillError(readableError(reason));
              } finally {
                setRefillBusy(false);
              }
            })}
            selected={medication.refillReminderDays === days}
          />
        ))}
        {refillBusy ? <Text style={[styles.meta, { color: colors.muted }]}>正在保存补药提醒…</Text> : null}
        {refillError ? <Text accessibilityRole="alert" style={[styles.message, { color: colors.danger }]}>{refillError}</Text> : null}
      </Card>

      <Card title="库存校正">
        <FormField keyboardType="decimal-pad" label="目标库存" onChangeText={setInventory} value={inventory} />
        <FormField label="校正原因" onChangeText={setInventoryReason} value={inventoryReason} />
        <Button
          disabled={busy}
          onPress={() => void run(async () => {
            const target = Number(inventory);
            if (!Number.isFinite(target) || target < 0 || target > 999999.999) throw new Error("请输入 0—999999.999 之间的库存。");
            if (!inventoryReason.trim()) throw new Error("请填写校正原因。");
            await medicationAppApi.correctInventory(medication.id, target, inventoryReason.trim());
            setInventoryReason("");
            setMessage("库存校正已保存。");
          })}
          variant="secondary"
        >
          {busy ? "正在保存…" : "保存库存校正"}
        </Button>
      </Card>
      {message ? <Text accessibilityLiveRegion="polite" style={[styles.message, { color: colors.primary, fontSize: 14 * textScale }]}>{message}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={[styles.message, { color: colors.danger, fontSize: 14 * textScale }]}>{error}</Text> : null}
    </Screen>
  );
}

function ScheduleEditorCard({
  schedule,
  index,
  otherTimes,
  busy,
  run,
  setMessage,
}: {
  schedule: MedicationScheduleView;
  index: number;
  otherTimes: string[];
  busy: boolean;
  run: RunOperation;
  setMessage: (message: string) => void;
}) {
  const { colors, textScale } = useAppAppearance();
  const [editing, setEditing] = useState(false);
  const [time, setTime] = useState(schedule.reminderTime);
  const [quantity, setQuantity] = useState(String(schedule.plannedDoseQuantity));

  const timeError = !isValidReminderTime(time)
    ? "请选择合法的提醒时间。"
    : otherTimes.includes(time)
      ? "该时间已经存在，请选择其他时间。"
      : undefined;
  const quantityError = !isValidScheduleQuantity(quantity)
    ? "请输入大于 0、最多三位小数的计划数量。"
    : undefined;

  const toggle = () => {
    const pausing = schedule.status === "active";
    const action = pausing ? "暂停" : "恢复";
    void run(async () => {
      const result = pausing
        ? await medicationAppApi.pauseMedicationSchedule(schedule.id)
        : await medicationAppApi.resumeMedicationSchedule(schedule.id);
      setMessage(`${action}时段已保存，${result.effective === "today" ? "今天" : "明天"}生效。`);
    });
  };

  const remove = () => {
    Alert.alert("删除这个服用时段？", "只停止未来提醒；药物、库存、照片和既往记录会保留。", [
      { text: "取消", style: "cancel" },
      {
        text: "确认删除",
        style: "destructive",
        onPress: () => void run(async () => {
          const result = await medicationAppApi.deleteMedicationSchedule(schedule.id);
          setMessage(`时段已删除，${result.effective === "today" ? "今天" : "明天"}生效。`);
        }),
      },
    ]);
  };

  return (
    <View style={[styles.schedule, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <View style={styles.scheduleHeader}>
        <View style={styles.flex}>
          <Text accessibilityRole="header" style={[styles.scheduleTitle, { color: colors.text, fontSize: 16 * textScale }]}>时段 {index + 1} · {schedule.reminderTime}</Text>
          <Text style={[styles.meta, { color: colors.muted, fontSize: 13 * textScale }]}>计划数量 {schedule.plannedDoseQuantity}</Text>
        </View>
        <StatusPill label={schedule.status === "active" ? "已启用" : "已暂停"} tone={schedule.status === "active" ? "good" : "warning"} />
      </View>
      <Text style={[styles.meta, { color: colors.muted, fontSize: 13 * textScale }]}>正常截止：提醒后 {formatOffset(schedule.onTimeOffsetMinutes)} · 最晚记录：提醒后 {formatOffset(schedule.recordOffsetMinutes)}</Text>
      {editing ? (
        <View style={styles.editor}>
          <TimePickerField label="提醒时间" onChange={setTime} value={time} />
          {timeError ? <Text accessibilityRole="alert" style={[styles.message, { color: colors.danger }]}>{timeError}</Text> : null}
          <FormField error={quantityError} keyboardType="decimal-pad" label="计划数量" onChangeText={setQuantity} value={quantity} />
          <View style={styles.actions}>
            <Button disabled={busy} onPress={() => setEditing(false)} variant="secondary">取消</Button>
            <Button
              disabled={busy || Boolean(timeError) || Boolean(quantityError)}
              onPress={() => void (async () => {
                const saved = await run(async () => {
                  const result = await medicationAppApi.updateMedicationSchedule(schedule.id, {
                    reminderTime: time,
                    plannedDoseQuantity: Number(quantity),
                  });
                  setMessage(`时段已修改，${result.effective === "today" ? "今天" : "明天"}生效。`);
                });
                if (saved) setEditing(false);
              })()}
            >
              保存修改
            </Button>
          </View>
        </View>
      ) : (
        <View style={styles.editor}>
          <Button
            disabled={busy}
            onPress={() => {
              setTime(schedule.reminderTime);
              setQuantity(String(schedule.plannedDoseQuantity));
              setEditing(true);
            }}
            variant="secondary"
          >
            修改时段
          </Button>
          <Button disabled={busy} onPress={toggle} variant="secondary">{schedule.status === "active" ? "暂停此时段" : "恢复此时段"}</Button>
          <Button disabled={busy} onPress={remove} variant="text">删除此时段</Button>
        </View>
      )}
    </View>
  );
}

function AddScheduleCard({
  medicationId,
  existingTimes,
  busy,
  run,
  setMessage,
}: {
  medicationId: string;
  existingTimes: string[];
  busy: boolean;
  run: RunOperation;
  setMessage: (message: string) => void;
}) {
  const { colors, textScale } = useAppAppearance();
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState(() => nextAvailableReminderTime(existingTimes.map((reminderTime) => ({ reminderTime }))));
  const [quantity, setQuantity] = useState("1");

  if (!open) {
    return (
      <Button
        disabled={busy}
        onPress={() => {
          setTime(nextAvailableReminderTime(existingTimes.map((reminderTime) => ({ reminderTime }))));
          setOpen(true);
        }}
        variant="secondary"
      >
        添加服用时段
      </Button>
    );
  }

  const timeError = !isValidReminderTime(time)
    ? "请选择合法的提醒时间。"
    : existingTimes.includes(time)
      ? "该时间已经存在，请选择其他时间。"
      : undefined;
  const quantityError = !isValidScheduleQuantity(quantity)
    ? "请输入大于 0、最多三位小数的计划数量。"
    : undefined;

  return (
    <View style={[styles.schedule, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <Text accessibilityRole="header" style={[styles.scheduleTitle, { color: colors.text, fontSize: 16 * textScale }]}>添加新时段</Text>
      <TimePickerField label="提醒时间" onChange={setTime} value={time} />
      {timeError ? <Text accessibilityRole="alert" style={[styles.message, { color: colors.danger }]}>{timeError}</Text> : null}
      <FormField error={quantityError} keyboardType="decimal-pad" label="计划数量" onChangeText={setQuantity} value={quantity} />
      <View style={styles.actions}>
        <Button disabled={busy} onPress={() => setOpen(false)} variant="secondary">取消</Button>
        <Button
          disabled={busy || Boolean(timeError) || Boolean(quantityError)}
          onPress={() => void (async () => {
            const saved = await run(async () => {
              await medicationAppApi.addMedicationSchedule(medicationId, {
                reminderTime: time,
                plannedDoseQuantity: Number(quantity),
              });
              setMessage("新时段已添加。");
            });
            if (saved) {
              setOpen(false);
              setQuantity("1");
            }
          })()}
        >
          保存新时段
        </Button>
      </View>
    </View>
  );
}

function formatOffset(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60} 小时`;
  return `${minutes} 分钟`;
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  body: { fontSize: 15, lineHeight: 22 },
  count: { fontSize: 13, fontVariant: ["tabular-nums"] },
  editor: { gap: spacing.sm },
  flex: { flex: 1 },
  label: { fontSize: 15, fontWeight: "700", marginTop: spacing.xs },
  meta: { fontSize: 13, lineHeight: 19 },
  message: { fontSize: 14, lineHeight: 20 },
  schedule: { borderRadius: 12, borderWidth: 1, gap: spacing.sm, padding: spacing.sm },
  scheduleHeader: { alignItems: "flex-start", flexDirection: "row", gap: spacing.sm },
  scheduleTitle: { fontSize: 16, fontWeight: "700" },
});
