import { z } from 'zod';

export type VisionProviderKind = 'on_device' | 'remote_api';
export type VisionCaptureMode = 'group' | 'per_item';

/**
 * The vision boundary intentionally receives neither a planned dose nor a consumption fact.
 * Candidate medicines are limited to the current occurrence and are identified by local IDs.
 */
export interface VisionAnalysisInput {
  requestId: string;
  photoEvidenceId: string;
  mode: VisionCaptureMode;
  candidateMedicationIds: string[];
  appearanceVersionIds: string[];
}

export interface VisionProviderCapability {
  available: boolean;
  providerKind: VisionProviderKind;
  modelVersion: string | null;
  supportsBaselineComparison: boolean;
  supportsGroupCandidates: boolean;
}

export type VisionUnableReasonCode =
  | 'provider_unavailable'
  | 'model_disabled'
  | 'manifest_invalid'
  | 'model_unavailable'
  | 'unsupported_device'
  | 'input_decode_error'
  | 'media_unavailable'
  | 'timeout'
  | 'nonfinite_output'
  | 'unsupported_half'
  | 'unsupported_damaged'
  | 'unsupported_transparent_capsule'
  | 'mixed_appearance_same_medication'
  | 'no_active_baseline'
  | 'quality_edge_cutoff'
  | 'occlusion'
  | 'overlap'
  | 'quality_too_dark'
  | 'quality_overexposed'
  | 'quality_blur'
  | 'quality_glare'
  | 'ambiguous_group_assignment'
  | 'score_in_reject_band'
  | 'object_count_out_of_range';

export type AppearanceAssessment =
  | {
      status: 'suspected_change';
      reasons: ('color' | 'shape' | 'texture' | 'imprint')[];
    }
  | { status: 'unable'; reasonCode: VisionUnableReasonCode }
  | { status: 'no_anomaly_signal' };

export interface VisionObjectCandidate {
  objectIndex: number;
  box: { x: number; y: number; width: number; height: number };
  status: 'candidate' | 'ambiguous' | 'unassigned';
  candidateMedicationId: string | null;
  scoreBand: 'accepted' | 'reject_band' | null;
}

export type ClosedSetVisionResult =
  | {
      status: 'analyzed';
      providerKind: VisionProviderKind;
      detectedObjectCount: number;
      objects: VisionObjectCandidate[];
      unassignedObjectCount: number;
      appearanceAssessment: AppearanceAssessment;
      modelManifestVersion: string;
      durationMs: number;
    }
  | {
      status: 'unable';
      providerKind: VisionProviderKind;
      reasonCode: VisionUnableReasonCode;
      modelManifestVersion: string | null;
      durationMs: number;
    };

export interface RemoteVisionRequest {
  schemaVersion: '1';
  requestId: string;
  mode: VisionCaptureMode;
  currentImage: EncodedVisionImage;
  references: {
    ephemeralCandidateId: string;
    frontImage: EncodedVisionImage;
    backImage: EncodedVisionImage;
  }[];
}

/** A bounded encoded image value; never a path, URL, EXIF object, medication ID, or dose. */
export interface EncodedVisionImage {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  encoding: 'base64';
  data: string;
  byteLength: number;
  sha256: string;
}

/** Optional future transport envelope. It must not replace the approved request contract. */
export interface RemoteVisionEncryptedEnvelope {
  algorithm: 'X25519-HKDF-SHA256+A256GCM';
  keyId: string;
  ephemeralPublicKeyB64: string;
  nonceB64: string;
  ciphertextB64: string;
  tagB64: string;
}

export interface RemoteVisionObject {
  objectIndex: number;
  box: { x: number; y: number; width: number; height: number };
  status: 'candidate' | 'ambiguous' | 'unassigned';
  ephemeralCandidateId?: string;
}

export interface RemoteVisionResponse {
  schemaVersion: '1';
  requestId: string;
  status: 'analyzed' | 'unable';
  detectedObjectCount?: number;
  objects?: RemoteVisionObject[];
  unableReasonCode?: VisionUnableReasonCode;
  providerModelVersion: string;
  durationMs: number;
}

export interface VisionInferenceProvider {
  readonly kind: VisionProviderKind;
  getCapability(): Promise<VisionProviderCapability>;
  analyze(input: VisionAnalysisInput): Promise<ClosedSetVisionResult>;
}

const nonEmptyId = z.string().trim().min(1).max(128);
const nonNegativeInt = z.number().int().nonnegative();

const unableReasonSchema = z.enum([
  'provider_unavailable',
  'model_disabled',
  'manifest_invalid',
  'model_unavailable',
  'unsupported_device',
  'input_decode_error',
  'media_unavailable',
  'timeout',
  'nonfinite_output',
  'unsupported_half',
  'unsupported_damaged',
  'unsupported_transparent_capsule',
  'mixed_appearance_same_medication',
  'no_active_baseline',
  'quality_edge_cutoff',
  'occlusion',
  'overlap',
  'quality_too_dark',
  'quality_overexposed',
  'quality_blur',
  'quality_glare',
  'ambiguous_group_assignment',
  'score_in_reject_band',
  'object_count_out_of_range',
]);

const boxSchema = z.object({
  x: z.number().finite().nonnegative(),
  y: z.number().finite().nonnegative(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
}).strict();

const remoteVisionObjectSchema = z.object({
  objectIndex: nonNegativeInt,
  box: boxSchema,
  status: z.enum(['candidate', 'ambiguous', 'unassigned']),
  ephemeralCandidateId: nonEmptyId.optional(),
}).strict().superRefine((value, context) => {
  if (value.status === 'candidate' && value.ephemeralCandidateId === undefined) {
    context.addIssue({ code: 'custom', message: 'A candidate requires an ephemeral candidate ID.' });
  }
  if (value.status !== 'candidate' && value.ephemeralCandidateId !== undefined) {
    context.addIssue({ code: 'custom', message: 'Only a candidate may carry an ephemeral candidate ID.' });
  }
});

export const encodedVisionImageSchema = z.object({
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  encoding: z.literal('base64'),
  data: z.string().min(1).max(32_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  byteLength: z.number().int().positive().max(24_000_000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().superRefine((value, context) => {
  const padding = value.data.endsWith('==') ? 2 : value.data.endsWith('=') ? 1 : 0;
  const decodedLength = Math.floor(value.data.length * 3 / 4) - padding;
  if (decodedLength !== value.byteLength) {
    context.addIssue({ code: 'custom', message: 'Encoded byte length does not match the payload.' });
  }
});

export const remoteVisionRequestSchema = z.object({
  schemaVersion: z.literal('1'),
  requestId: nonEmptyId,
  mode: z.enum(['group', 'per_item']),
  currentImage: encodedVisionImageSchema,
  references: z.array(z.object({
    ephemeralCandidateId: nonEmptyId,
    frontImage: encodedVisionImageSchema,
    backImage: encodedVisionImageSchema,
  }).strict()).min(1).max(8),
}).strict().superRefine((value, context) => {
  const ids = value.references.map((reference) => reference.ephemeralCandidateId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', message: 'Ephemeral candidate IDs must be unique.' });
  }
  if (value.mode === 'per_item' && value.references.length !== 1) {
    context.addIssue({ code: 'custom', message: 'Per-item requests require exactly one reference.' });
  }
});

export const remoteVisionResponseSchema = z.object({
  schemaVersion: z.literal('1'),
  requestId: nonEmptyId,
  status: z.enum(['analyzed', 'unable']),
  detectedObjectCount: nonNegativeInt.optional(),
  objects: z.array(remoteVisionObjectSchema).max(8).optional(),
  unableReasonCode: unableReasonSchema.optional(),
  providerModelVersion: nonEmptyId,
  durationMs: z.number().finite().nonnegative(),
}).strict().superRefine((value, context) => {
  if (value.status === 'analyzed') {
    if (value.detectedObjectCount === undefined || value.objects === undefined) {
      context.addIssue({ code: 'custom', message: 'Analyzed responses require count and objects.' });
      return;
    }
    if (value.unableReasonCode !== undefined) {
      context.addIssue({ code: 'custom', message: 'Analyzed responses cannot carry an unable reason.' });
    }
    if (value.detectedObjectCount !== value.objects.length) {
      context.addIssue({ code: 'custom', message: 'Object count must equal the number of objects.' });
    }
    if (new Set(value.objects.map((object) => object.objectIndex)).size !== value.objects.length) {
      context.addIssue({ code: 'custom', message: 'Object indexes must be unique.' });
    }
  } else {
    if (value.unableReasonCode === undefined) {
      context.addIssue({ code: 'custom', message: 'Unable responses require a reason.' });
    }
    if (value.detectedObjectCount !== undefined || value.objects !== undefined) {
      context.addIssue({ code: 'custom', message: 'Unable responses cannot assert detected objects.' });
    }
  }
});

export function parseRemoteVisionResponse(input: unknown): RemoteVisionResponse {
  return remoteVisionResponseSchema.parse(input) as RemoteVisionResponse;
}

function unavailable(kind: VisionProviderKind): ClosedSetVisionResult {
  return {
    status: 'unable',
    providerKind: kind,
    reasonCode: 'provider_unavailable',
    modelManifestVersion: null,
    durationMs: 0,
  };
}

/** Placeholder until the signed model manifest and native LiteRT module pass the device gate. */
export class OnDeviceVisionProvider implements VisionInferenceProvider {
  readonly kind = 'on_device' as const;

  async getCapability(): Promise<VisionProviderCapability> {
    return {
      providerKind: this.kind,
      available: false,
      modelVersion: null,
      supportsBaselineComparison: false,
      supportsGroupCandidates: false,
    };
  }

  async analyze(_input: VisionAnalysisInput): Promise<ClosedSetVisionResult> {
    return unavailable(this.kind);
  }
}

/**
 * Remote inference is disabled by policy. This placeholder deliberately has no endpoint,
 * transport, fetch dependency, authentication token, or retry path.
 */
export class RemoteVisionProvider implements VisionInferenceProvider {
  readonly kind = 'remote_api' as const;

  async getCapability(): Promise<VisionProviderCapability> {
    return {
      providerKind: this.kind,
      available: false,
      modelVersion: null,
      supportsBaselineComparison: false,
      supportsGroupCandidates: false,
    };
  }

  async analyze(_input: VisionAnalysisInput): Promise<ClosedSetVisionResult> {
    return unavailable(this.kind);
  }
}
