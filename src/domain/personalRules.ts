import { DomainRuleError } from './errors';
import type { LocalDate } from './model';
import type {
  FollowUpAdvanceDays,
  FollowUpItemType,
  InventoryForecastLeadDays,
  TextSize,
  ThemeMode,
} from './personalModel';
import { normalizeQuantity, quantityToMilliunits, type QuantityText } from './quantity';

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u;

export function assertMedicationDisplayName(name: string): string {
  const normalized = name.trim();
  const length = Array.from(normalized).length;
  if (length < 1 || length > 60 || CONTROL_CHARACTER.test(normalized)) {
    throw new DomainRuleError('VALIDATION_FAILED', 'error.medication_name_invalid');
  }
  return normalized;
}

export function assertThemeMode(value: string): asserts value is ThemeMode {
  if (!['system', 'light', 'dark'].includes(value)) {
    throw new DomainRuleError('VALIDATION_FAILED', 'error.theme_mode_invalid');
  }
}

export function assertTextSize(value: string): asserts value is TextSize {
  if (!['standard', 'large', 'extra_large'].includes(value)) {
    throw new DomainRuleError('VALIDATION_FAILED', 'error.text_size_invalid');
  }
}

export function normalizeNonNegativeQuantity(input: string): QuantityText {
  return normalizeQuantity(input);
}

export function normalizePositiveQuantity(input: string): QuantityText {
  const normalized = normalizeQuantity(input);
  if (quantityToMilliunits(normalized) <= 0n) {
    throw new DomainRuleError('QUANTITY_INVALID', 'error.quantity_must_be_positive');
  }
  return normalized;
}

export function nextLocalDate(value: LocalDate): LocalDate {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf())) {
    throw new DomainRuleError('VALIDATION_FAILED', 'error.local_date_invalid');
  }
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10) as LocalDate;
}

export function addLocalDays(value: LocalDate, days: number): LocalDate {
  if (!Number.isInteger(days)) {
    throw new DomainRuleError('VALIDATION_FAILED', 'error.local_day_offset_invalid');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf())) {
    throw new DomainRuleError('VALIDATION_FAILED', 'error.local_date_invalid');
  }
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10) as LocalDate;
}

export function assertInventoryForecastLeadDays(
  value: number | null,
): asserts value is InventoryForecastLeadDays {
  if (value !== null && ![3, 7, 14, 30].includes(value)) {
    throw new DomainRuleError('VALIDATION_FAILED', 'error.inventory_lead_days_invalid');
  }
}

export function assertFollowUpType(value: string): asserts value is FollowUpItemType {
  if (!['follow_up', 'refill', 'test'].includes(value)) {
    throw new DomainRuleError('VALIDATION_FAILED', 'error.follow_up_type_invalid');
  }
}

export function assertFollowUpAdvanceDays(
  value: number | null,
): asserts value is FollowUpAdvanceDays {
  if (value !== null && ![1, 3, 7].includes(value)) {
    throw new DomainRuleError('VALIDATION_FAILED', 'error.follow_up_advance_days_invalid');
  }
}

export function assertFollowUpTitle(value: string): string {
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  if (length < 1 || length > 80 || CONTROL_CHARACTER.test(normalized)) {
    throw new DomainRuleError('VALIDATION_FAILED', 'error.follow_up_title_invalid');
  }
  return normalized;
}

export function assertFollowUpNote(value: string): string {
  const normalized = value.trim();
  if (Array.from(normalized).length > 500 || CONTROL_CHARACTER.test(normalized)) {
    throw new DomainRuleError('VALIDATION_FAILED', 'error.follow_up_note_invalid');
  }
  return normalized;
}

export function assertIanaTimeZone(value: string): string {
  const normalized = value.trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(new Date(0));
  } catch {
    throw new DomainRuleError('VALIDATION_FAILED', 'error.time_zone_invalid');
  }
  if (!normalized) {
    throw new DomainRuleError('VALIDATION_FAILED', 'error.time_zone_invalid');
  }
  return normalized;
}
