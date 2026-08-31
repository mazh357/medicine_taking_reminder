import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  demoApi,
  type ItemConsumptionAssertion,
} from "../../../src/features/demoApi";
import { assertionLabel } from "../../../src/features/labels";
import { useMedicationSnapshot } from "../../../src/state/useMedicationSnapshot";
import {
  Button,
  Card,
  Choice,
  FormField,
  Screen,
  colors,
  spacing,
} from "../../../src/ui";

type RevisionAssertion = Exclude<ItemConsumptionAssertion, "pending">;

export default function ReviseDoseItemScreen() {
  const { id, itemId } = useLocalSearchParams<{ id: string; itemId: string }>();
  const snapshot = useMedicationSnapshot();
  const occurrence = snapshot.occurrences.find((item) => item.id === id);
  const item = occurrence?.items.find((candidate) => candidate.id === itemId);
  const initial = item?.assertion === "pending" ? "taken_as_planned" : item?.assertion;
  const [assertion, setAssertion] = useState<RevisionAssertion>(initial ?? "taken_as_planned");
  const [quantity, setQuantity] = useState(String(item?.confirmedConsumptionQuantity ?? item?.plannedDoseQuantity ?? 0));
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);

  if (!occurrence || !item) {
    return (
      <Screen title="找不到记录">
        <Button onPress={() => router.replace("/(tabs)/history")}>返回记录</Button>
      </Screen>
    );
  }

  const parsed = assertion === "not_taken" ? 0 : assertion === "taken_as_planned" ? item.plannedDoseQuantity : Number(quantity);
  const quantityInvalid = assertion === "partially_taken" && (!Number.isFinite(parsed) || parsed <= 0 || parsed === item.plannedDoseQuantity);
  const save = async () => {
    setSubmitted(true);
    if (!reason.trim() || quantityInvalid) return;
    await demoApi.reviseDoseItem(id, item.id, assertion, parsed, reason);
    router.replace(`/history/${id}`);
  };

  return (
    <Screen
      headerRight={
        <Button onPress={() => router.back()} variant="text">
          返回
        </Button>
      }
      subtitle="原记录会保留，库存通过反向和修订流水重新计算。"
      title={`修订 ${item.displayName}`}
    >
      <Card title="原记录">
        <Text style={styles.body}>{assertionLabel[item.assertion]}</Text>
        <Text style={styles.meta}>
          计划数量 {item.plannedDoseQuantity}；实际数量 {item.confirmedConsumptionQuantity ?? "待确认"}
        </Text>
      </Card>
      <Card title="新记录">
        <View style={styles.choices}>
          <Choice
            label="按计划量服用"
            onPress={() => setAssertion("taken_as_planned")}
            selected={assertion === "taken_as_planned"}
          />
          <Choice
            label="与计划量不同"
            onPress={() => setAssertion("partially_taken")}
            selected={assertion === "partially_taken"}
          />
          <Choice
            label="未服用"
            onPress={() => setAssertion("not_taken")}
            selected={assertion === "not_taken"}
          />
        </View>
        {assertion === "partially_taken" ? (
          <FormField
            error={submitted && quantityInvalid ? "请输入大于 0 且不同于计划量的实际数量。" : undefined}
            keyboardType="decimal-pad"
            label="新实际数量"
            onChangeText={setQuantity}
            value={quantity}
          />
        ) : null}
        <FormField
          error={submitted && !reason.trim() ? "请填写修订原因。" : undefined}
          label="修订原因"
          multiline
          onChangeText={setReason}
          value={reason}
        />
      </Card>
      <Button onPress={save}>确认修订</Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  meta: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  choices: { gap: spacing.sm },
});
