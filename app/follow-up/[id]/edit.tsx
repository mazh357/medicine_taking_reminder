import { router, useLocalSearchParams } from "expo-router";

import { FollowUpForm } from "../../../src/features/FollowUpForm";
import { medicationAppApi } from "../../../src/features/medicationAppApi";
import { useMedicationSnapshot } from "../../../src/state/useMedicationSnapshot";
import { Button, Card, Screen } from "../../../src/ui";

export default function EditFollowUpScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const snapshot = useMedicationSnapshot();
  const item = snapshot.followUps.find((entry) => entry.id === id);

  if (!item) {
    return <Screen title="找不到事项"><Card><Button onPress={() => router.replace("/(tabs)/followups" as never)}>返回事项</Button></Card></Screen>;
  }
  if (item.status !== "scheduled") {
    return <Screen title="事项不可编辑"><Card><Button onPress={() => router.replace("/(tabs)/followups" as never)}>返回事项</Button></Card></Screen>;
  }

  return (
    <Screen headerRight={<Button onPress={() => router.back()} variant="text">返回</Button>} title="编辑事项">
      <FollowUpForm
        initial={item}
        medications={snapshot.medications}
        onSubmit={async (input) => {
          await medicationAppApi.updateFollowUp(item.id, input);
          router.replace("/(tabs)/followups" as never);
        }}
        submitLabel="保存修改"
      />
    </Screen>
  );
}
