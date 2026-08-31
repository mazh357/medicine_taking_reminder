import { describe, expect, it } from 'vitest';

import {
  normalizeQuantity,
  quantityToMilliunits,
  signedQuantityFromMilliunits,
  sumSignedQuantities,
} from '../quantity';

describe('QuantityText', () => {
  it('normalizes to a three-decimal fixed-point canonical string', () => {
    expect(normalizeQuantity('1.500')).toBe('1.5');
    expect(normalizeQuantity('0.000')).toBe('0');
    expect(normalizeQuantity('999999.999')).toBe('999999.999');
    expect(quantityToMilliunits(normalizeQuantity('0.125'))).toBe(125n);
  });

  it('rejects floats, exponent syntax, signs, leading zeroes and excess precision', () => {
    for (const invalid of ['-1', '+1', '1e3', '01', '1.0001', 'Infinity', 'NaN']) {
      expect(() => normalizeQuantity(invalid)).toThrow();
    }
  });

  it('sums inventory deltas without JavaScript floating point', () => {
    expect(
      sumSignedQuantities([
        signedQuantityFromMilliunits(1000n),
        signedQuantityFromMilliunits(-250n),
        signedQuantityFromMilliunits(-125n),
      ]),
    ).toBe('0.625');
  });
});
