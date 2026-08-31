import { afterEach, describe, expect, it, vi } from 'vitest';

import { installMedicationAppCapabilities, medicationAppApi } from './medicationAppApi';

afterEach(() => installMedicationAppCapabilities({}));

describe('medicationAppApi destructive clear gate', () => {
  it('uses the root-installed runtime lifecycle capability', async () => {
    const clearAll = vi.fn().mockResolvedValue(undefined);
    installMedicationAppCapabilities({ clearAll });

    await medicationAppApi.clearAll();

    expect(clearAll).toHaveBeenCalledOnce();
  });
});
