import type { OccurrenceView } from "./medicationAppApi";
import { photosForOccurrence } from "./medicationAppApi";

export type HistoryDateRange = "7" | "30" | "all";
export type HistoryResult = "planned" | "partial" | "not_taken" | "missed" | "revoked";
export type HistoryFilterValues = {
  dateRange: HistoryDateRange;
  medicationId: string | null;
  result: HistoryResult | null;
};

export function hasActiveHistoryFilters(filters: HistoryFilterValues): boolean {
  return filters.dateRange !== "30" || filters.medicationId !== null || filters.result !== null;
}

export function hasActualFact(occurrence: OccurrenceView): boolean {
  return (
    photosForOccurrence(occurrence).length > 0 ||
    occurrence.items.some((item) => item.assertion !== "pending" || item.revisions.length > 0) ||
    ["taken_confirmed", "late_taken", "missed", "revoked"].includes(occurrence.lifecycle)
  );
}

export function historyResult(occurrence: OccurrenceView): HistoryResult | null {
  if (occurrence.lifecycle === "revoked") return "revoked";
  if (occurrence.lifecycle === "missed") return "missed";
  const assertions = occurrence.items.map((item) => item.assertion);
  if (assertions.length === 0 || assertions.every((value) => value === "pending")) return null;
  if (assertions.some((value) => value === "pending")) return "partial";
  if (assertions.every((value) => value === "not_taken")) return "not_taken";
  if (assertions.every((value) => value === "taken_as_planned")) return "planned";
  return "partial";
}

export function filterHistory(
  occurrences: OccurrenceView[],
  filters: HistoryFilterValues,
  now = new Date(),
): OccurrenceView[] {
  const start = new Date(now);
  if (filters.dateRange !== "all") {
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (Number(filters.dateRange) - 1));
  }
  return occurrences
    .filter(hasActualFact)
    .filter((occurrence) => filters.dateRange === "all" || Date.parse(occurrence.plannedAt) >= start.getTime())
    .filter((occurrence) => !filters.medicationId || occurrence.items.some((item) => item.medicationId === filters.medicationId))
    .filter((occurrence) => !filters.result || historyResult(occurrence) === filters.result)
    .sort((left, right) => Date.parse(right.plannedAt) - Date.parse(left.plannedAt));
}
