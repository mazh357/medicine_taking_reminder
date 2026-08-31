import { DomainRuleError } from './errors';

export type QuantityText = string & { readonly __quantityText: unique symbol };
export type SignedQuantityText = string & { readonly __signedQuantityText: unique symbol };

const INPUT_PATTERN = /^(0|[1-9][0-9]{0,5})(?:\.([0-9]{1,3}))?$/;
const MAX_MILLIUNITS = 999_999_999n;

export function normalizeQuantity(input: string): QuantityText {
  const match = INPUT_PATTERN.exec(input);
  if (!match) {
    throw new DomainRuleError('QUANTITY_INVALID', 'error.quantity_invalid');
  }

  const whole = BigInt(match[1]!);
  const fraction = (match[2] ?? '').padEnd(3, '0');
  const milliunits = whole * 1000n + BigInt(fraction || '0');
  if (milliunits > MAX_MILLIUNITS) {
    throw new DomainRuleError('QUANTITY_INVALID', 'error.quantity_out_of_range');
  }
  return quantityFromMilliunits(milliunits);
}

export function quantityToMilliunits(value: QuantityText | string): bigint {
  const normalized = normalizeQuantity(String(value));
  const [whole, fraction = ''] = normalized.split('.');
  return BigInt(whole!) * 1000n + BigInt(fraction.padEnd(3, '0'));
}

export function quantityFromMilliunits(value: bigint): QuantityText {
  if (value < 0n || value > MAX_MILLIUNITS) {
    throw new DomainRuleError('QUANTITY_INVALID', 'error.quantity_out_of_range');
  }
  const whole = value / 1000n;
  const fraction = (value % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''}` as QuantityText;
}

export function signedQuantityFromMilliunits(value: bigint): SignedQuantityText {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const unsigned = quantityFromMilliunits(absolute);
  return `${sign}${unsigned}` as SignedQuantityText;
}

export function signedQuantityToMilliunits(value: SignedQuantityText | string): bigint {
  const text = String(value);
  const negative = text.startsWith('-');
  const unsigned = normalizeQuantity(negative ? text.slice(1) : text);
  const milliunits = quantityToMilliunits(unsigned);
  return negative ? -milliunits : milliunits;
}

export function negateQuantity(value: QuantityText): SignedQuantityText {
  const milliunits = quantityToMilliunits(value);
  return signedQuantityFromMilliunits(-milliunits);
}

export function sumSignedQuantities(values: readonly (SignedQuantityText | string)[]): SignedQuantityText {
  return signedQuantityFromMilliunits(
    values.reduce((sum, value) => sum + signedQuantityToMilliunits(value), 0n),
  );
}

export function quantitiesEqual(a: QuantityText | string, b: QuantityText | string): boolean {
  return quantityToMilliunits(a) === quantityToMilliunits(b);
}

export function isPositiveQuantity(value: QuantityText | string): boolean {
  return quantityToMilliunits(value) > 0n;
}
