import { describe, expect, it } from "vitest";

import { localParts, toScheduledAt, validateFollowUpInput } from "./followUpFormLogic";

describe("follow-up form", () => {
  it("round-trips a valid local date and time", () => {
    const value = toScheduledAt("2026-08-26", "09:05");
    expect(value).not.toBeNull();
    expect(localParts(value!)).toEqual({ date: "2026-08-26", time: "09:05" });
  });

  it("rejects invalid calendar dates and control characters", () => {
    expect(toScheduledAt("2026-02-31", "08:00")).toBeNull();
    expect(validateFollowUpInput({
      type: "follow_up",
      title: "复诊\n事项",
      scheduledAt: new Date().toISOString(),
      medicationId: null,
      notes: "",
      advanceReminderDays: 1,
    })).toBeTruthy();
  });
});
