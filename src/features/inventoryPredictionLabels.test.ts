import { describe, expect, it } from "vitest";

import { inventoryPredictionLines } from "./inventoryPredictionLabels";

describe("inventory prediction labels", () => {
  it("keeps depletion and next-insufficient dates separate", () => {
    expect(inventoryPredictionLines({
      status: "available",
      estimatedDepletionLocalDate: "2026-09-10",
      nextInsufficientLocalDate: "2026-09-11",
    })).toEqual(["预计用尽：2026-09-10", "下次不足：2026-09-11"]);
  });

  it("shows an explicit reason when prediction is unavailable", () => {
    expect(inventoryPredictionLines({ status: "unavailable", reason: "plan_paused" }))
      .toEqual(["暂不可预测：计划已暂停"]);
  });
});
