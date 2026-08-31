import { describe, expect, it } from 'vitest';

import { RuntimeIdGenerator } from './demoDependencies';

describe('RuntimeIdGenerator', () => {
  it('creates lowercase RFC 4122 UUID v4-shaped identifiers', () => {
    const ids = new RuntimeIdGenerator();
    const generated = Array.from({ length: 100 }, () => ids.next());
    const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(generated.every((value) => uuidV4.test(value))).toBe(true);
    expect(new Set(generated)).toHaveLength(generated.length);
  });
});
