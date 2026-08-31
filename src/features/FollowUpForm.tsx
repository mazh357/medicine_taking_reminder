import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { localParts, toScheduledAt, validateFollowUpInput } from "./followUpFormLogic";
import {
  readableError,
  type AdvanceReminderDays,
  type FollowUpInput,
  type FollowUpType,
  type MedicationView,
} from "./medicationAppApi";
import { useAppAppearance } from "../state/AppAppearanceProvider";
import { Button, Card, Choice, FormField, TimePickerField, spacing } from "../ui";

const typeLabels: Record<FollowUpType, string> = {
  follow_up: "复诊",
  refill: "取药",
  test: "检查",
};

const advanceLabels: Record<AdvanceReminderDays, string> = {
  0: "不提前",
  1: "提前 1 天",
  3: "提前 3 天",
  7: "提前 7 天",
};

export function FollowUpForm({
  initial,
  medications,
  submitLabel,
  onSubmit,
}: {
  initial?: FollowUpInput;
  medications: MedicationView[];
  submitLabel: string;
  onSubmit: (input: FollowUpInput) => Promise<void>;
}) {
  const appearance = useAppAppearance();
  const initialParts = localParts(initial?.scheduledAt);
  const [type, setType] = useState<FollowUpType>(initial?.type ?? "follow_up");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [date, setDate] = useState(initialParts.date);
  const [time, setTime] = useState(initialParts.time);
  const [medicationId, setMedicationId] = useState<string | null>(initial?.medicationId ?? null);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [advance, setAdvance] = useState<AdvanceReminderDays>(initial?.advanceReminderDays ?? 1);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string>();

  const scheduledAt = toScheduledAt(date, time);
  const input: FollowUpInput | null = scheduledAt
    ? { type, title: title.trim(), scheduledAt, medicationId, notes: notes.trim(), advanceReminderDays: advance }
    : null;
  const validationError = submitted
    ? input
      ? validateFollowUpInput(input)
      : "请选择有效的日期和时间。"
    : null;

  const save = async () => {
    setSubmitted(true);
    setError(undefined);
    if (!input || validateFollowUpInput(input)) return;
    setSaving(true);
    try {
      await onSubmit(input);
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card title="事项内容">
        <Text style={[styles.label, { color: appearance.colors.text }]}>类型</Text>
        <View style={styles.list}>
          {(["follow_up", "refill", "test"] as FollowUpType[]).map((value) => (
            <Choice key={value} label={typeLabels[value]} onPress={() => setType(value)} selected={type === value} />
          ))}
        </View>
        <FormField label="标题" onChangeText={setTitle} placeholder="例如：复诊" value={title} />
        <FormField hint="格式：YYYY-MM-DD" label="日期" onChangeText={setDate} placeholder="2026-08-26" value={date} />
        <TimePickerField label="时间" onChange={setTime} value={time} />
      </Card>

      <Card title="关联药物（可选）">
        <View style={styles.list}>
          <Choice label="不关联药物" onPress={() => setMedicationId(null)} selected={medicationId === null} />
          {medications.map((medication) => (
            <Choice key={medication.id} label={medication.name} onPress={() => setMedicationId(medication.id)} selected={medicationId === medication.id} />
          ))}
        </View>
      </Card>

      <Card title="提醒与备注">
        <Text style={[styles.label, { color: appearance.colors.text }]}>提前提醒</Text>
        <View style={styles.list}>
          {([0, 1, 3, 7] as AdvanceReminderDays[]).map((value) => (
            <Choice key={value} label={advanceLabels[value]} onPress={() => setAdvance(value)} selected={advance === value} />
          ))}
        </View>
        <FormField label="备注（可选）" multiline onChangeText={setNotes} value={notes} />
      </Card>

      {validationError || error ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: appearance.colors.danger, fontSize: 14 * appearance.textScale }]}>
          {validationError ?? error}
        </Text>
      ) : null}
      <Button disabled={saving} onPress={save}>{saving ? "正在保存…" : submitLabel}</Button>
    </>
  );
}

export { advanceLabels, typeLabels };

const styles = StyleSheet.create({
  label: { fontSize: 15, fontWeight: "700" },
  list: { gap: spacing.sm },
  error: { fontSize: 14, lineHeight: 20 },
});
