import type { MedicationScheduleInput } from "./medicationAppApi";

export const MAX_MEDICATION_SCHEDULES = 8;

export function isValidReminderTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function isValidScheduleQuantity(value: string | number): boolean {
  const text = String(value);
  if (!/^\d{1,6}(?:\.\d{1,3})?$/.test(text)) return false;
  const quantity = Number(text);
  return Number.isFinite(quantity) && quantity > 0 && quantity <= 999999.999;
}

export function duplicateReminderTimes(
  schedules: readonly Pick<MedicationScheduleInput, "reminderTime">[],
): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const schedule of schedules) {
    if (seen.has(schedule.reminderTime)) duplicates.add(schedule.reminderTime);
    seen.add(schedule.reminderTime);
  }
  return duplicates;
}

export function sortSchedules<T extends Pick<MedicationScheduleInput, "reminderTime">>(
  schedules: readonly T[],
): T[] {
  return [...schedules].sort((left, right) => left.reminderTime.localeCompare(right.reminderTime));
}

export function nextAvailableReminderTime(
  schedules: readonly Pick<MedicationScheduleInput, "reminderTime">[],
): string {
  const used = new Set(schedules.map((schedule) => schedule.reminderTime));
  for (let offset = 0; offset < 24; offset += 1) {
    const hour = (8 + offset) % 24;
    const candidate = `${String(hour).padStart(2, "0")}:00`;
    if (!used.has(candidate)) return candidate;
  }
  return "08:00";
}
