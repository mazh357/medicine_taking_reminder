import { router } from "expo-router";

import { FollowUpForm } from "../../src/features/FollowUpForm";
import { medicationAppApi } from "../../src/features/medicationAppApi";
import { useMedicationSnapshot } from "../../src/state/useMedicationSnapshot";
import { Button, Screen } from "../../src/ui";

export default function NewFollowUpScreen() {
  const snapshot = useMedicationSnapshot();
  return (
    <Screen headerRight={<Button onPress={() => router.back()} variant="text">返回</Button>} title="新增事项">
      <FollowUpForm
        medications={snapshot.medications}
        onSubmit={async (input) => {
          await medicationAppApi.createFollowUp(input);
          router.replace("/(tabs)/followups" as never);
        }}
        submitLabel="保存事项"
      />
    </Screen>
  );
}
