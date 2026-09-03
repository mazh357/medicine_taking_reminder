import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { MedicationInput } from "./medicationAppApi";
import { readableError } from "./medicationAppApi";
import {
  duplicateReminderTimes,
  isValidReminderTime,
  isValidScheduleQuantity,
  MAX_MEDICATION_SCHEDULES,
  nextAvailableReminderTime,
  sortSchedules,
} from "./medication-schedule-ui";
import { Button, Card, FormField, TimePickerField } from "../ui";
import { spacing } from "../ui/theme";
import { useAppAppearance } from "../state/AppAppearanceProvider";

function isValidQuantity(value: number, allowZero: boolean) {
  if (!Number.isFinite(value) || value < 0 || value > 999999.999) return false;
  if (!allowZero && value === 0) return false;
  return /^\d{1,6}(?:\.\d{1,3})?$/.test(String(value));
}

function validateName(value: string) {
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  return length >= 1 && length <= 60 && !/[\u0000-\u001f\u007f-\u009f]/u.test(normalized);
}

export function MedicationForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: MedicationInput;
  submitLabel: string;
  onSubmit: (value: MedicationInput) => Promise<void>;
}) {
  const { colors, textScale } = useAppAppearance();
  const [name, setName] = useState(initial?.name ?? "");
  const [stock, setStock] = useState(String(initial?.initialInventory ?? 0));
  const [schedules, setSchedules] = useState(() => {
    const values = initial?.schedules.length
      ? initial.schedules
      : [{ reminderTime: "08:00", plannedDoseQuantity: 1 }];
    return sortSchedules(values).map((schedule, index) => ({
      key: `schedule-${index}-${schedule.reminderTime}`,
      reminderTime: schedule.reminderTime,
      plannedDoseQuantity: String(schedule.plannedDoseQuantity),
    }));
  });
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();

  const stockNumber = Number(stock);
  const duplicateTimes = duplicateReminderTimes(schedules);
  const nameError = submitted && !validateName(name) ? "请输入 1—60 个字符，且不要包含换行或控制字符。" : undefined;
  const stockError = submitted && !isValidQuantity(stockNumber, true) ? "请输入 0—999999.999 之间的库存。" : undefined;
  const schedulesValid = schedules.length >= 1 && schedules.length <= MAX_MEDICATION_SCHEDULES &&
    schedules.every((schedule) =>
      isValidReminderTime(schedule.reminderTime) &&
      isValidScheduleQuantity(schedule.plannedDoseQuantity),
    ) && duplicateTimes.size === 0;

  const updateSchedule = (
    key: string,
    changes: Partial<Pick<(typeof schedules)[number], "reminderTime" | "plannedDoseQuantity">>,
  ) => {
    setSchedules((current) => sortSchedules(current.map((schedule) =>
      schedule.key === key ? { ...schedule, ...changes } : schedule,
    )));
  };

  const addSchedule = () => {
    setSchedules((current) => {
      if (current.length >= MAX_MEDICATION_SCHEDULES) return current;
      return sortSchedules([...current, {
        key: `schedule-${Date.now()}-${current.length}`,
        reminderTime: nextAvailableReminderTime(current),
        plannedDoseQuantity: "1",
      }]);
    });
  };

  const submit = async () => {
    setSubmitted(true);
    setSaveError(undefined);
    if (!validateName(name) || !isValidQuantity(stockNumber, true) || !schedulesValid) return;
    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        initialInventory: stockNumber,
        schedules: schedules.map((schedule) => ({
          reminderTime: schedule.reminderTime,
          plannedDoseQuantity: Number(schedule.plannedDoseQuantity),
        })),
      });
    } catch (error) {
      setSaveError(readableError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card title="药物与库存">
        <FormField
          error={nameError}
          label="药物名称"
          onChangeText={setName}
          placeholder="请输入名称"
          value={name}
        />
        <FormField
          error={stockError}
          keyboardType="decimal-pad"
          label="当前库存"
          onChangeText={setStock}
          value={stock}
        />
      </Card>
      <Card
        right={
          <Text style={[styles.count, { color: colors.muted, fontSize: 13 * textScale }]}>
            {schedules.length}/{MAX_MEDICATION_SCHEDULES}
          </Text>
        }
        title="每日服用时段"
      >
        <Text style={[styles.hint, { color: colors.muted, fontSize: 13 * textScale }]}>每个时段会生成独立提醒和服药记录，共享同一库存。</Text>
        {schedules.map((schedule, index) => {
          const timeError = !isValidReminderTime(schedule.reminderTime)
            ? "请选择合法的提醒时间。"
            : duplicateTimes.has(schedule.reminderTime)
              ? "该时间已经存在，请选择其他时间。"
              : undefined;
          const quantityError = !isValidScheduleQuantity(schedule.plannedDoseQuantity)
            ? "请输入大于 0、最多三位小数的计划数量。"
            : undefined;
          return (
            <View
              accessibilityLabel={`第 ${index + 1} 个服用时段`}
              key={schedule.key}
              style={[styles.schedule, { backgroundColor: colors.background, borderColor: colors.border }]}
            >
              <Text accessibilityRole="header" style={[styles.scheduleTitle, { color: colors.text, fontSize: 16 * textScale }]}>时段 {index + 1}</Text>
              <TimePickerField
                hint="使用 24 小时制"
                label="提醒时间"
                onChange={(value) => updateSchedule(schedule.key, { reminderTime: value })}
                value={schedule.reminderTime}
              />
              {timeError ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger, fontSize: 13 * textScale }]}>{timeError}</Text> : null}
              <FormField
                error={quantityError}
                keyboardType="decimal-pad"
                label="计划数量"
                onChangeText={(value) => updateSchedule(schedule.key, { plannedDoseQuantity: value })}
                value={schedule.plannedDoseQuantity}
              />
              <Button
                disabled={schedules.length === 1}
                onPress={() => setSchedules((current) => current.filter((item) => item.key !== schedule.key))}
                variant="text"
              >
                删除此时段
              </Button>
            </View>
          );
        })}
        <Button disabled={schedules.length >= MAX_MEDICATION_SCHEDULES} onPress={addSchedule} variant="secondary">
          {schedules.length >= MAX_MEDICATION_SCHEDULES ? "已达到 8 个时段" : "添加服用时段"}
        </Button>
      </Card>
      {saveError ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger, fontSize: 14 * textScale }]}>
          {saveError}
        </Text>
      ) : null}
      <Button disabled={saving} onPress={submit}>
        {saving ? "正在保存…" : submitLabel}
      </Button>
    </>
  );
}

const styles = StyleSheet.create({
  error: { fontSize: 14, lineHeight: 20 },
  count: { fontSize: 13, fontVariant: ["tabular-nums"] },
  hint: { fontSize: 13, lineHeight: 19 },
  schedule: { borderRadius: 12, borderWidth: 1, gap: spacing.sm, padding: spacing.sm },
  scheduleTitle: { fontSize: 16, fontWeight: "700" },
});
