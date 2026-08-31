export type DemoCountUnableReason =
  | 'low_contrast'
  | 'blur'
  | 'overlap'
  | 'background_noise'
  | 'too_dark'
  | 'processing_error';

export interface DemoObjectBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DemoCountResult =
  | {
      status: 'counted';
      detectedObjectCount: number;
      quality: 'acceptable';
      boxes?: DemoObjectBox[];
    }
  | {
      status: 'unable';
      reason: DemoCountUnableReason;
    };

export interface DemoPillCounterNativeModule {
  countObjects(photoUri: string): Promise<DemoCountResult>;
}
