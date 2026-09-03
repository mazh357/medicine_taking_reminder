import type { ClosedSetVisionResult, VisionProviderCapability } from 'medication-vision-module';

export type VisionSample = { id: string; label: string; created_at_utc: string; deleted_at_utc: string | null };
export type VisionBaseline = { id: string; sample_id: string; status: 'draft' | 'active' | 'retired' | 'deleted'; created_at_utc: string; activated_at_utc: string | null };
export type VisionPhoto = { id: string; baseline_id: string; purpose: 'front' | 'back' | 'analysis'; captured_at_utc: string; deleted_at_utc: string | null; cleanupPending: boolean; eligible: boolean; issue: string | null };
export type VisionAnalysis = { id: string; photo_id: string; baseline_id: string; result: ClosedSetVisionResult; recorded_at_utc: string };
export type VisionAnnotation = { id: string; analysis_id: string; object_index: number | null; value: 'looks_similar' | 'looks_different' | 'unable'; recorded_at_utc: string };
export type VisionLabSnapshot = { samples: VisionSample[]; baselines: VisionBaseline[]; photos: VisionPhoto[]; analyses: VisionAnalysis[]; annotations: VisionAnnotation[] };
export interface VisionLabApi {
  snapshot(): Promise<VisionLabSnapshot>;
  capability(): Promise<VisionProviderCapability>;
  createSample(label: string): Promise<string>;
  createVersion(sampleId: string): Promise<string>;
  captureBaseline(versionId: string, view: 'front' | 'back', localUri: string, supported: boolean): Promise<void>;
  activate(versionId: string): Promise<void>;
  analyze(versionId: string, localUri: string, supported: boolean): Promise<string>;
  retryAnalysis(photoId: string): Promise<string>;
  annotate(analysisId: string, objectIndex: number | null, value: VisionAnnotation['value']): Promise<void>;
  preview(photoId: string): Promise<string>;
  releasePreview(uri: string): Promise<void>;
  deletePhoto(photoId: string): Promise<void>;
  deleteSample(sampleId: string): Promise<void>;
  cancel(): Promise<void>;
}
let current: VisionLabApi | null = null;
export function installVisionLabApi(api: VisionLabApi | null) { current = api; }
export function visionLabApi(): VisionLabApi {
  if (!current) throw new Error('照片实验尚未准备好，请返回后重试。');
  return current;
}
