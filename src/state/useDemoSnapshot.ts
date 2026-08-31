import { useSyncExternalStore } from "react";

import { demoApi } from "../features/demoApi";

export function useDemoSnapshot() {
  return useSyncExternalStore(
    demoApi.subscribe,
    demoApi.getSnapshot,
    demoApi.getSnapshot,
  );
}
