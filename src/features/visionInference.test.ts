import { describe, expect, it, vi } from 'vitest';
import { OnDeviceVisionProvider, RemoteVisionProvider, validateVisionAnalysisInput, type VisionAnalysisInput } from './visionInference';
vi.mock('expo', () => ({ requireNativeModule: () => { throw new Error('native unavailable'); } }));

const input: VisionAnalysisInput = { schemaVersion: '1', requestId: 'request-1', mode: 'baseline', currentImage: { photoEvidenceId: 'photo-1', localUri: 'content://example.encryptedmedia/photo.jpg' }, candidates: [] };
describe('canonical visual contract', () => {
  it('uses the standalone contract and has no business mutation fields', () => {
    expect(validateVisionAnalysisInput(input)).toEqual(input);
    expect(Object.keys(input)).not.toContain('plannedDoseQuantity');
    expect(Object.keys(input)).not.toContain('candidateMedicationIds');
  });
  it('keeps remote disabled without a transport', async () => {
    const provider = new RemoteVisionProvider();
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect((await provider.getCapability()).available).toBe(false);
    expect((await provider.analyze(input)).appearance.status).toBe('unable');
    expect(fetch).not.toHaveBeenCalled(); fetch.mockRestore();
  });
  it('falls back when native code is absent', async () => {
    expect((await new OnDeviceVisionProvider().analyze(input)).count.status).toBe('unable');
  });
});
