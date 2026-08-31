import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { ItemConsumptionAssertion } from "./demoApi";
import type { DoseItemView } from "./medicationAppApi";
import { readableError } from "./medicationAppApi";
import { assertionLabel } from "./labels";
import { Button, Card, Choice, FormField, StatusPill, colors, spacing } from "../ui";

type SelectedAssertion = Exclude<ItemConsumptionAssertion, "pending">;

export function DoseItemConfirmationCard({
  item,
  onConfirm,
  onRevise,
}: {
  item: DoseItemView;
  onConfirm: (assertion: SelectedAssertion, quantity: number) => Promise<void>;
  onRevise: () => void;
}) {
  const [selected, setSelected] = useState<SelectedAssertion>("taken_as_planned");
  const [quantity, setQuantity] = useState(String(item.plannedDoseQuantity));
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();

  if (item.assertion !== "pending") {
    return (
      <Card
        right={<StatusPill label={assertionLabel[item.assertion]} tone="good" />}
        title={item.displayName}
      >
        <Text style={styles.body}>
          计划数量 {item.plannedDoseQuantity}；实际数量 {item.confirmedConsumptionQuantity ?? 0}
        </Text>
        <Button onPress={onRevise} variant="text">
          修订这项记录
        </Button>
      </Card>
    );
  }

  const parsed =
    selected === "not_taken"
      ? 0
      : selected === "taken_as_planned"
        ? item.plannedDoseQuantity
        : Number(quantity);
  const quantityError =
    submitted &&
    selected === "partially_taken" &&
    (!Number.isFinite(parsed) || parsed <= 0 || parsed > 999999.999 || parsed === item.plannedDoseQuantity)
      ? "请输入大于 0 且不同于计划量的实际数量。"
      : undefined;

  const choose = (next: SelectedAssertion) => {
    setSelected(next);
    if (next === "taken_as_planned") setQuantity(String(item.plannedDoseQuantity));
    if (next === "not_taken") setQuantity("0");
  };

  const confirm = async () => {
    setSubmitted(true);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    if (
      selected === "partially_taken" &&
      (parsed <= 0 || parsed > 999999.999 || parsed === item.plannedDoseQuantity)
    )
      return;
    setSaving(true);
    setSaveError(undefined);
    try {
      await onConfirm(selected, parsed);
    } catch (error) {
      setSaveError(readableError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={item.displayName}>
      <Text style={styles.body}>
        本次计划数量：{item.plannedDoseQuantity}
      </Text>
      <View style={styles.choices}>
        <Choice
          label="按计划量服用"
          onPress={() => choose("taken_as_planned")}
          selected={selected === "taken_as_planned"}
        />
        <Choice
          label="与计划量不同"
          onPress={() => choose("partially_taken")}
          selected={selected === "partially_taken"}
        />
        <Choice
          label="未服用"
          onPress={() => choose("not_taken")}
          selected={selected === "not_taken"}
        />
      </View>
      {selected === "partially_taken" ? (
        <FormField
          error={quantityError}
          keyboardType="decimal-pad"
          label="本次实际数量"
          onChangeText={setQuantity}
          value={quantity}
        />
      ) : null}
      <Text style={styles.confirmation}>
        你将记录的实际数量：{Number.isFinite(parsed) ? parsed : "—"}
      </Text>
      {saveError ? <Text accessibilityRole="alert" style={styles.error}>{saveError}</Text> : null}
      <Button disabled={saving} onPress={confirm}>{saving ? "正在保存…" : "确认此药"}</Button>
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  choices: { gap: spacing.sm },
  confirmation: { color: colors.text, fontSize: 14, fontWeight: "600" },
  error: { color: colors.danger, fontSize: 13, lineHeight: 18 },
});
