import { router, useLocalSearchParams } from "expo-router";
import { Text } from "react-native";

import { assertionLabel } from "../../../src/features/labels";
import { useMedicationSnapshot } from "../../../src/state/useMedicationSnapshot";
import { Button, Card, Screen } from "../../../src/ui";

export default function EditHistoryRecordScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const occurrence = useMedicationSnapshot().occurrences.find((item) => item.id === id);
  if (!occurrence) {
    return <Screen title="找不到记录"><Button onPress={() => router.back()}>返回</Button></Screen>;
  }
  return (
    <Screen
      headerRight={<Button onPress={() => router.back()} variant="text">返回</Button>}
      subtitle="请选择需要修改的药项。原记录和库存流水会继续保留。"
      title="修改记录"
    >
      {occurrence.items.map((item) => (
        <Card key={item.id} title={item.displayName}>
          <Text>{assertionLabel[item.assertion]} · 实际数量 {item.confirmedConsumptionQuantity ?? "待确认"}</Text>
          <Button onPress={() => router.push(`/history/${id}/revise?itemId=${item.id}`)}>
            修改此项
          </Button>
        </Card>
      ))}
    </Screen>
  );
}
