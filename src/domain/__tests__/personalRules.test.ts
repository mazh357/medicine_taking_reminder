import { describe, expect, it } from 'vitest';

import {
  addLocalDays,
  assertFollowUpAdvanceDays,
  assertFollowUpNote,
  assertFollowUpTitle,
  assertFollowUpType,
  assertIanaTimeZone,
  assertInventoryForecastLeadDays,
  assertMedicationDisplayName,
  nextLocalDate,
  normalizeNonNegativeQuantity,
  normalizePositiveQuantity,
  type QuantityUnit,
} from '..';

describe('personal local domain rules', () => {
  it('accepts neutral real-world names and trims only boundary whitespace', () => {
    expect(assertMedicationDisplayName('  二甲双胍缓释片 0.5g  ')).toBe('二甲双胍缓释片 0.5g');
    expect(assertMedicationDisplayName('Vitamin B-12（甲钴胺）')).toBe('Vitamin B-12（甲钴胺）');
  });

  it('rejects blank, control characters and names over 60 Unicode characters', () => {
    for (const value of ['   ', '药物\n名称', '药物\t名称', '药'.repeat(61)]) {
      expect(() => assertMedicationDisplayName(value)).toThrow();
    }
  });

  it('freezes the personal quantity unit to count and keeps fixed-point rules', () => {
    const unit: QuantityUnit = 'count';
    expect(unit).toBe('count');
    expect(normalizeNonNegativeQuantity('0.500')).toBe('0.5');
    expect(normalizePositiveQuantity('1.250')).toBe('1.25');
    expect(() => normalizePositiveQuantity('0')).toThrow();
  });

  it('increments local dates without depending on a device time zone', () => {
    expect(nextLocalDate('2026-12-31')).toBe('2027-01-01');
    expect(addLocalDays('2026-01-01', -7)).toBe('2025-12-25');
  });

  it('strictly validates forecast and follow-up fields', () => {
    for (const leadDays of [null, 3, 7, 14, 30]) {
      expect(() => assertInventoryForecastLeadDays(leadDays)).not.toThrow();
    }
    expect(() => assertInventoryForecastLeadDays(1)).toThrow();
    for (const advanceDays of [null, 1, 3, 7]) {
      expect(() => assertFollowUpAdvanceDays(advanceDays)).not.toThrow();
    }
    expect(() => assertFollowUpAdvanceDays(14)).toThrow();
    expect(() => assertFollowUpType('test')).not.toThrow();
    expect(() => assertFollowUpType('other')).toThrow();
    expect(assertFollowUpTitle('  复查肝功能  ')).toBe('复查肝功能');
    expect(assertFollowUpNote('  携带报告  ')).toBe('携带报告');
    expect(() => assertFollowUpTitle('')).toThrow();
    expect(() => assertFollowUpTitle('项'.repeat(81))).toThrow();
    expect(() => assertFollowUpNote('注'.repeat(501))).toThrow();
    expect(assertIanaTimeZone('Asia/Shanghai')).toBe('Asia/Shanghai');
    expect(() => assertIanaTimeZone('Not/A_Zone')).toThrow();
  });
});
