export const FICTITIOUS_MEDICATION_SEEDS = [
  { displayName: '演示药A', dosageForm: 'tablet' as const, initialInventoryQuantity: '30' },
  { displayName: '演示药B', dosageForm: 'capsule' as const, initialInventoryQuantity: '20' },
] as const;

export const DEMO_DISCLAIMER_VERSION = 'demo-boundary-v0.1';
export const DEMO_DISCLAIMER_TEXT =
  '内部演示版本，仅限虚构数据。禁止录入真实患者信息、真实处方或真实用药照片。本应用不能用于指导或证明实际服药。';
