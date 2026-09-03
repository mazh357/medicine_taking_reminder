import { describe, expect, it } from "vitest";

import {
  duplicateReminderTimes,
  isValidReminderTime,
  isValidScheduleQuantity,
  nextAvailableReminderTime,
  sortSchedules,
} from "./medication-schedule-ui";

describe("medication schedule UI helpers", () => {
  it("accepts only complete 24-hour reminder times", () => {
    expect(isValidReminderTime("00:00")).toBe(true);
    expect(isValidReminderTime("23:59")).toBe(true);
    expect(isValidReminderTime("8:00")).toBe(false);
    expect(isValidReminderTime("24:00")).toBe(false);
  });

  it("validates positive quantities with at most three decimal places", () => {
    expect(isValidScheduleQuantity("0.5")).toBe(true);
    expect(isValidScheduleQuantity("999999.999")).toBe(true);
    expect(isValidScheduleQuantity("0")).toBe(false);
    expect(isValidScheduleQuantity("1.0001")).toBe(false);
  });

  it("finds duplicates and sorts schedules by time", () => {
    const schedules = [
      { reminderTime: "20:00", plannedDoseQuantity: 1 },
      { reminderTime: "08:00", plannedDoseQuantity: 1 },
      { reminderTime: "20:00", plannedDoseQuantity: 0.5 },
    ];
    expect([...duplicateReminderTimes(schedules)]).toEqual(["20:00"]);
    expect(sortSchedules(schedules).map((item) => item.reminderTime)).toEqual([
      "08:00",
      "20:00",
      "20:00",
    ]);
  });

  it("suggests a unique hourly time for a newly added schedule", () => {
    expect(nextAvailableReminderTime([{ reminderTime: "08:00" }])).toBe("09:00");
  });
});

