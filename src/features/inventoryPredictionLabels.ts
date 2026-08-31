import type { InventoryPrediction } from "./medicationAppApi";

const unavailableReasonLabel: Record<Extract<InventoryPrediction, { status: "unavailable" }>["reason"], string> = {
  plan_paused: "计划已暂停",
  no_active_plan: "没有启用计划",
  invalid_balance: "库存数据需校正",
  complex_schedule: "当前计划暂不可预测",
  waiting_for_runtime: "预测服务尚未准备好",
};

export function inventoryPredictionLines(prediction: InventoryPrediction): string[] {
  if (prediction.status === "unavailable") {
    return [`暂不可预测：${unavailableReasonLabel[prediction.reason]}`];
  }
  return [
    `预计用尽：${prediction.estimatedDepletionLocalDate ?? "暂无"}`,
    `下次不足：${prediction.nextInsufficientLocalDate ?? "暂无"}`,
  ];
}

