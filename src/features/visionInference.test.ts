import { describe, expect, it, vi } from 'vitest';

import {
  OnDeviceVisionProvider,
  parseRemoteVisionResponse,
  remoteVisionRequestSchema,
  RemoteVisionProvider,
  type VisionAnalysisInput,
} from './visionInference';

type ForbiddenVisionInputKey = Extract<
  keyof VisionAnalysisInput,
  | 'plannedDoseQuantity'
  | 'confirmedConsumptionQuantity'
  | 'consumptionAssertion'
  | 'inventoryDelta'
>;
const visionInputHasNoFactMutationKey: ForbiddenVisionInputKey extends never ? true : false = true;

const input: VisionAnalysisInput = {
  requestId: 'request-1',
  photoEvidenceId: 'photo-1',
  mode: 'group',
  candidateMedicationIds: ['medication-1'],
  appearanceVersionIds: ['appearance-1'],
};

describe('vision inference providers', () => {
  it('keeps the on-device provider unavailable until the native model gate passes', async () => {
    const provider = new OnDeviceVisionProvider();
    await expect(provider.getCapability()).resolves.toMatchObject({
      providerKind: 'on_device',
      available: false,
      modelVersion: null,
      supportsBaselineComparison: false,
      supportsGroupCandidates: false,
    });
    await expect(provider.analyze(input)).resolves.toEqual({
      status: 'unable',
      providerKind: 'on_device',
      reasonCode: 'provider_unavailable',
      modelManifestVersion: null,
      durationMs: 0,
    });
  });

  it('keeps remote inference disabled without making a network request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const provider = new RemoteVisionProvider();

    await expect(provider.getCapability()).resolves.toMatchObject({
      providerKind: 'remote_api',
      available: false,
      modelVersion: null,
      supportsBaselineComparison: false,
      supportsGroupCandidates: false,
    });
    await expect(provider.analyze(input)).resolves.toMatchObject({
      status: 'unable',
      reasonCode: 'provider_unavailable',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('remote response validation', () => {
  it('strictly validates the approved encoded-image request contract', () => {
    const image = {
      mediaType: 'image/jpeg' as const,
      encoding: 'base64' as const,
      data: 'AQ==',
      byteLength: 1,
      sha256: 'a'.repeat(64),
    };
    expect(remoteVisionRequestSchema.parse({
      schemaVersion: '1',
      requestId: 'request-1',
      mode: 'per_item',
      currentImage: image,
      references: [{
        ephemeralCandidateId: 'candidate-1',
        frontImage: image,
        backImage: image,
      }],
    })).toMatchObject({ schemaVersion: '1', mode: 'per_item' });
  });

  it('strictly accepts a coherent closed-set response', () => {
    expect(parseRemoteVisionResponse({
      schemaVersion: '1',
      requestId: 'request-1',
      status: 'analyzed',
      detectedObjectCount: 1,
      objects: [{
        objectIndex: 0,
        box: { x: 1, y: 2, width: 30, height: 40 },
        status: 'candidate',
        ephemeralCandidateId: 'candidate-1',
      }],
      providerModelVersion: 'vision-0.1.0',
      durationMs: 120,
    })).toMatchObject({ schemaVersion: '1', requestId: 'request-1' });
  });

  it('rejects unknown fields and internally inconsistent object counts', () => {
    expect(() => parseRemoteVisionResponse({
      schemaVersion: '1',
      requestId: 'request-1',
      unexpected: true,
      status: 'analyzed',
      detectedObjectCount: 2,
      objects: [],
      providerModelVersion: 'vision-0.1.0',
      durationMs: 120,
    })).toThrow();
  });
});

describe('static safety boundary', () => {
  it('keeps consumption and inventory facts outside the analysis input contract', () => {
    expect(visionInputHasNoFactMutationKey).toBe(true);
    expect(input).not.toHaveProperty('plannedDoseQuantity');
    expect(input).not.toHaveProperty('confirmedConsumptionQuantity');
  });
});
