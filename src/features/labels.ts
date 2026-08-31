import type {
  CountUnableReason,
  DoseLifecycle,
  ItemConsumptionAssertion,
} from "./demoApi";

export const lifecycleLabel: Record<DoseLifecycle, string> = {
  scheduled: "未到时间",
  due: "待记录",
  prepared: "已准备·待确认",
  taken_confirmed: "已完成记录",
  late_taken: "晚于正常时间记录",
  missed: "本次未完成服用记录",
  revoked: "已撤销",
};

export const assertionLabel: Record<ItemConsumptionAssertion, string> = {
  pending: "待确认",
  taken_as_planned: "按计划量服用",
  partially_taken: "与计划量不同",
  not_taken: "未服用",
};

export const countUnableLabel: Record<CountUnableReason, string> = {
  low_contrast: "物体与背景对比不足",
  blur: "画面较模糊",
  overlap: "物体可能接触或重叠",
  background_noise: "背景较杂乱",
  too_dark: "画面过暗",
  processing_error: "辅助计数暂时不可用",
};

export function formatLocalTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
