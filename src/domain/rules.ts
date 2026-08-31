import { DomainRuleError } from './errors';
import type {
  DoseLifecycle,
  DoseOccurrenceItem,
  ItemConsumptionAssertion,
  UtcInstant,
} from './model';
import {
  isPositiveQuantity,
  normalizeQuantity,
  quantitiesEqual,
  type QuantityText,
} from './quantity';

export function assertFictitiousMedicationName(name: string): string {
  const normalized = name.trim();
  if (!normalized.startsWith('演示') || normalized.length < 4 || normalized.length > 24) {
    throw new DomainRuleError('VALIDATION_FAILED', 'error.demo_medication_name_required');
  }
  if (/[@:/\\]|https?:|\d{6,}/i.test(normalized)) {
    throw new DomainRuleError('VALIDATION_FAILED', 'error.demo_medication_name_unsafe');
  }
  return normalized;
}

export function assertLocalTime(value: string): void {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new DomainRuleError('VALIDATION_FAILED', 'error.local_time_invalid');
  }
}

export function assertLocalDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new DomainRuleError('VALIDATION_FAILED', 'error.local_date_invalid');
  }
}

export function assertUtcInstant(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new DomainRuleError('VALIDATION_FAILED', 'error.utc_instant_invalid');
  }
}

export function assertWindowOffsets(onTimeOffsetMinutes: number, recordOffsetMinutes: number): void {
  if (
    !Number.isInteger(onTimeOffsetMinutes) ||
    !Number.isInteger(recordOffsetMinutes) ||
    onTimeOffsetMinutes <= 0 ||
    recordOffsetMinutes <= onTimeOffsetMinutes ||
    recordOffsetMinutes >= 24 * 60
  ) {
    throw new DomainRuleError('WINDOW_ORDER_INVALID', 'error.window_order_invalid');
  }
}

export function validateAssertionQuantity(
  assertion: Exclude<ItemConsumptionAssertion, 'pending'>,
  rawQuantity: string | null | undefined,
  plannedDoseQuantity: QuantityText,
): QuantityText {
  if (assertion === 'not_taken') {
    if (rawQuantity != null && normalizeQuantity(rawQuantity) !== '0') {
      throw new DomainRuleError(
        'QUANTITY_ASSERTION_MISMATCH',
        'error.not_taken_quantity_must_be_zero',
      );
    }
    return normalizeQuantity('0');
  }
  if (rawQuantity == null || rawQuantity === '') {
    throw new DomainRuleError('QUANTITY_REQUIRED', 'error.confirmed_quantity_required');
  }

  const quantity = normalizeQuantity(rawQuantity);
  if (!isPositiveQuantity(quantity)) {
    throw new DomainRuleError('QUANTITY_INVALID', 'error.confirmed_quantity_must_be_positive');
  }
  const equalsPlan = quantitiesEqual(quantity, plannedDoseQuantity);
  if (assertion === 'taken_as_planned' && !equalsPlan) {
    throw new DomainRuleError(
      'QUANTITY_ASSERTION_MISMATCH',
      'error.taken_as_planned_quantity_mismatch',
    );
  }
  if (assertion === 'partially_taken' && equalsPlan) {
    throw new DomainRuleError(
      'QUANTITY_ASSERTION_MISMATCH',
      'error.partial_quantity_equals_plan',
    );
  }
  return quantity;
}

export function deriveDoseLifecycle(
  current: DoseLifecycle,
  items: readonly Pick<DoseOccurrenceItem, 'assertion' | 'confirmedConsumptionQuantity'>[],
  confirmedAtUtc: UtcInstant,
  onTimeUntilAtUtc: UtcInstant,
  hadMissedEvent: boolean,
): DoseLifecycle {
  if (items.some((item) => item.assertion === 'pending')) {
    return current === 'due' ? 'due' : 'prepared';
  }

  const hasPositiveConsumption = items.some(
    (item) =>
      item.confirmedConsumptionQuantity != null &&
      isPositiveQuantity(item.confirmedConsumptionQuantity),
  );
  if (!hasPositiveConsumption) return 'missed';
  if (hadMissedEvent || Date.parse(confirmedAtUtc) > Date.parse(onTimeUntilAtUtc)) {
    return 'late_taken';
  }
  return 'taken_confirmed';
}

export function assertDetectedObjectCount(value: number | null): void {
  if (value != null && (!Number.isInteger(value) || value < 0)) {
    throw new DomainRuleError('VALIDATION_FAILED', 'error.detected_object_count_invalid');
  }
}
