import { describe, expect, it, vi } from 'vitest';

import { clearExternalDataBeforeDatabase } from './clearDemoData';

describe('clearExternalDataBeforeDatabase', () => {
  it('preserves SQLite facts and rejects when media deletion fails', async () => {
    const clearDatabase = vi.fn().mockResolvedValue(undefined);
    await expect(
      clearExternalDataBeforeDatabase(
        {
          clearAll: async () => {
            throw new Error('delete failed');
          },
        },
        { clearAll: vi.fn().mockResolvedValue(undefined) },
        clearDatabase,
      ),
    ).rejects.toThrow('delete failed');
    expect(clearDatabase).not.toHaveBeenCalled();
  });

  it('clears the database only after media and reminders succeed', async () => {
    const order: string[] = [];
    await clearExternalDataBeforeDatabase(
      { clearAll: async () => void order.push('media') },
      { clearAll: async () => void order.push('reminders') },
      async () => void order.push('database'),
    );
    expect(order.at(-1)).toBe('database');
    expect(new Set(order.slice(0, 2))).toEqual(new Set(['media', 'reminders']));
  });
});
