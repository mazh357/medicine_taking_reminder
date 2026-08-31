import { describe, expect, it } from "vitest";

import { filterHistory, hasActiveHistoryFilters, hasActualFact, historyResult } from "./historyFilters";
import type { OccurrenceView } from "./medicationAppApi";

function occurrence(overrides: Partial<OccurrenceView> = {}): OccurrenceView {
  return {
    id: "occ-1",
    localServiceDate: "2026-08-26",
    plannedAt: "2026-08-26T08:00:00.000Z",
    onTimeUntilAt: "2026-08-26T09:00:00.000Z",
    recordUntilAt: "2026-08-26T20:00:00.000Z",
    lifecycle: "scheduled",
    preparedAt: null,
    completedAt: null,
    photo: null,
    photos: [],
    items: [{
      id: "item-1",
      medicationId: "med-1",
      displayName: "药物一",
      quantityUnit: "count",
      plannedDoseQuantity: 1,
      assertion: "pending",
      confirmedConsumptionQuantity: null,
      confirmedAt: null,
      revisions: [],
    }],
    ...overrides,
  };
}

describe("history filters", () => {
  it("marks only non-default conditions as active", () => {
    expect(hasActiveHistoryFilters({ dateRange: "30", medicationId: null, result: null })).toBe(false);
    expect(hasActiveHistoryFilters({ dateRange: "7", medicationId: null, result: null })).toBe(true);
    expect(hasActiveHistoryFilters({ dateRange: "30", medicationId: "med-1", result: null })).toBe(true);
    expect(hasActiveHistoryFilters({ dateRange: "30", medicationId: null, result: "missed" })).toBe(true);
  });

  it("hides schedule-only occurrences", () => {
    expect(hasActualFact(occurrence())).toBe(false);
    expect(filterHistory([occurrence()], { dateRange: "all", medicationId: null, result: null })).toEqual([]);
  });

  it("derives mixed medication outcomes as partial", () => {
    const value = occurrence({
      lifecycle: "taken_confirmed",
      items: [
        { ...occurrence().items[0]!, assertion: "taken_as_planned", confirmedConsumptionQuantity: 1 },
        { ...occurrence().items[0]!, id: "item-2", medicationId: "med-2", assertion: "not_taken", confirmedConsumptionQuantity: 0 },
      ],
    });
    expect(historyResult(value)).toBe("partial");
  });

  it("treats an in-progress multi-medication fact as partial", () => {
    const value = occurrence({
      lifecycle: "prepared",
      items: [
        { ...occurrence().items[0]!, assertion: "taken_as_planned", confirmedConsumptionQuantity: 1 },
        { ...occurrence().items[0]!, id: "item-2", medicationId: "med-2" },
      ],
    });
    expect(historyResult(value)).toBe("partial");
  });

  it("filters by date, medication and result", () => {
    const value = occurrence({ lifecycle: "missed" });
    expect(filterHistory([value], { dateRange: "7", medicationId: "med-1", result: "missed" }, new Date("2026-08-26T12:00:00Z"))).toEqual([value]);
    expect(filterHistory([value], { dateRange: "7", medicationId: "med-2", result: "missed" }, new Date("2026-08-26T12:00:00Z"))).toEqual([]);
  });
});
