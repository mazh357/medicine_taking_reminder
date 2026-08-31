import type { FollowUpItemView } from "./medicationAppApi";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function localDayOrdinal(value: Date): number {
  return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / DAY_MS;
}

export function nextScheduledFollowUp(
  items: FollowUpItemView[],
): FollowUpItemView | null {
  return items
    .filter((item) => item.status === "scheduled" && Number.isFinite(Date.parse(item.scheduledAt)))
    .sort((left, right) => Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt))[0] ?? null;
}

export function followUpCountdownLabel(scheduledAt: string, now = new Date()): string {
  const due = new Date(scheduledAt);
  const dueMs = due.getTime();
  const nowMs = now.getTime();
  if (!Number.isFinite(dueMs)) return "时间待确认";

  const calendarDays = localDayOrdinal(due) - localDayOrdinal(now);
  const remainingMs = dueMs - nowMs;
  if (remainingMs <= 0) {
    const overdueDays = Math.max(0, -calendarDays);
    return overdueDays === 0 ? "已到期" : `已到期 ${overdueDays} 天`;
  }
  if (calendarDays === 0) {
    return remainingMs < HOUR_MS
      ? "今天 · 不足 1 小时"
      : `今天 · 还有 ${Math.ceil(remainingMs / HOUR_MS)} 小时`;
  }
  if (calendarDays === 1) return "明天";
  return `还有 ${Math.max(1, calendarDays)} 天`;
}
