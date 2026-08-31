import { useSyncExternalStore } from "react";

import { medicationAppApi } from "../features/medicationAppApi";

export function useMedicationSnapshot() {
  return useSyncExternalStore(
    medicationAppApi.subscribe,
    medicationAppApi.getSnapshot,
    medicationAppApi.getSnapshot,
  );
}
