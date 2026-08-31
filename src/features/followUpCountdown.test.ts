import { describe, expect, it } from "vitest";

import type { FollowUpItemView } from "./medicationAppApi";
import { followUpCountdownLabel, nextScheduledFollowUp } from "./followUpCountdown";

function followUp(
  id: string,
  scheduledAt: string,
  status: FollowUpItemView["status"] = "scheduled",
): FollowUpItemView {
  return {
    id,
    type: "follow_up",
    title: id,
    scheduledAt,
    medicationId: null,
    notes: "",
    advanceReminderDays: 0,
    status,
    completedAt: null,
    cancelledAt: null,
  };
}

describe("follow-up countdown", () => {
  const now = new Date(2026, 7, 28, 10, 30);

  it.each([
    [new Date(2026, 7, 28, 11, 0).toISOString(), "今天 · 不足 1 小时"],
    [new Date(2026, 7, 28, 13, 0).toISOString(), "今天 · 还有 3 小时"],
    [new Date(2026, 7, 29, 8, 0).toISOString(), "明天"],
    [new Date(2026, 7, 31, 8, 0).toISOString(), "还有 3 天"],
    [new Date(2026, 7, 28, 9, 0).toISOString(), "已到期"],
    [new Date(2026, 7, 26, 9, 0).toISOString(), "已到期 2 天"],
  ])("formats %s as %s", (scheduledAt, expected) => {
    expect(followUpCountdownLabel(scheduledAt, now)).toBe(expected);
  });

  it("returns only the earliest scheduled item", () => {
    expect(nextScheduledFollowUp([
      followUp("completed", new Date(2026, 7, 27).toISOString(), "completed"),
      followUp("later", new Date(2026, 8, 2).toISOString()),
      followUp("next", new Date(2026, 7, 30).toISOString()),
    ])?.id).toBe("next");
  });
});
