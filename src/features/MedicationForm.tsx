import { useState } from "react";
import { StyleSheet, Text } from "react-native";

import type { MedicationInput } from "./medicationAppApi";
import { readableError } from "./medicationAppApi";
import { Button, Card, FormField, TimePickerField } from "../ui";
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
  const [dose, setDose] = useState(String(initial?.plannedDoseQuantity ?? 1));
  const [stock, setStock] = useState(String(initial?.initialInventory ?? 0));
  const [time, setTime] = useState(initial?.reminderTime ?? "08:00");
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();

  const doseNumber = Number(dose);
  const stockNumber = Number(stock);
  const nameError = submitted && !validateName(name) ? "请输入 1—60 个字符，且不要包含换行或控制字符。" : undefined;
  const doseError = submitted && !isValidQuantity(doseNumber, false) ? "请输入大于 0、最多三位小数的计划数量。" : undefined;
  const stockError = submitted && !isValidQuantity(stockNumber, true) ? "请输入 0—999999.999 之间的库存。" : undefined;

  const submit = async () => {
    setSubmitted(true);
    setSaveError(undefined);
    if (!validateName(name) || !isValidQuantity(doseNumber, false) || !isValidQuantity(stockNumber, true)) return;
    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        plannedDoseQuantity: doseNumber,
        initialInventory: stockNumber,
        reminderTime: time,
      });
    } catch (error) {
      setSaveError(readableError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card title="药物与数量">
        <FormField
          error={nameError}
          label="药物名称"
          onChangeText={setName}
          placeholder="请输入名称"
          value={name}
        />
        <FormField
          error={doseError}
          keyboardType="decimal-pad"
          label="每次计划数量"
          onChangeText={setDose}
          value={dose}
        />
      </Card>
      <Card title="计划与库存">
        <TimePickerField
          hint="使用 24 小时制"
          label="每日提醒时间"
          onChange={setTime}
          value={time}
        />
        <FormField
          error={stockError}
          keyboardType="decimal-pad"
          label="当前库存"
          onChangeText={setStock}
          value={stock}
        />
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
});
