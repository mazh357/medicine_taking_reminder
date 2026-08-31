import { router } from "expo-router";

import { medicationAppApi } from "../../src/features/medicationAppApi";
import { MedicationForm } from "../../src/features/MedicationForm";
import { Button, Screen } from "../../src/ui";

export default function NewMedicationScreen() {
  return (
    <Screen
      headerRight={
        <Button onPress={() => router.back()} variant="text">
          返回
        </Button>
      }
      title="新增药物"
    >
      <MedicationForm
        onSubmit={async (value) => {
          await medicationAppApi.createMedication(value);
          router.replace("/(tabs)/medications");
        }}
        submitLabel="保存"
      />
    </Screen>
  );
}
