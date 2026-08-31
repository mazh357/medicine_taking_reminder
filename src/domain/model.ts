import type { QuantityText, SignedQuantityText } from './quantity';

export type UtcInstant = string;
export type LocalDate = string;
export type LocalTime = string;
export type EntityId = string;
export type IdempotencyKey = string;

export type DoseLifecycle =
  | 'scheduled'
  | 'due'
  | 'prepared'
  | 'taken_confirmed'
  | 'late_taken'
  | 'missed'
  | 'revoked';

export type ItemConsumptionAssertion =
  | 'pending'
  | 'taken_as_planned'
  | 'partially_taken'
  | 'not_taken';

export type PhotoEvidenceState = 'captured' | 'skipped_with_reason' | 'deleted_tombstone';
export type InventoryUnit = 'tablet' | 'capsule';
export type CaptureMode = 'group' | 'per_item';

export interface DemoProfile {
  id: 'demo-profile';
  disclaimerVersion: string;
  acknowledgedAtUtc: UtcInstant;
}

export interface Medication {
  id: EntityId;
  displayName: string;
  dosageForm: InventoryUnit;
  inventoryUnit: InventoryUnit;
  status: 'active' | 'inactive';
  createdAtUtc: UtcInstant;
}

export interface RegimenItem {
  id: EntityId;
  regimenId: EntityId;
  medicationId: EntityId;
  plannedDoseQuantity: QuantityText;
  unit: InventoryUnit;
  sortOrder: number;
}

export interface Regimen {
  id: EntityId;
  name: string;
  localTime: LocalTime;
  timeZone: string;
  onTimeOffsetMinutes: number;
  recordOffsetMinutes: number;
  captureMode: CaptureMode;
  startLocalDate: LocalDate;
  endLocalDate: LocalDate | null;
  status: 'active' | 'paused';
  rowVersion: number;
  items: RegimenItem[];
  createdAtUtc: UtcInstant;
  updatedAtUtc: UtcInstant;
}

export interface DoseOccurrenceItem {
  id: EntityId;
  occurrenceId: EntityId;
  regimenItemId: EntityId;
  medicationId: EntityId;
  medicationDisplayName: string;
  plannedDoseQuantity: QuantityText;
  unit: InventoryUnit;
  sortOrder: number;
  assertion: ItemConsumptionAssertion;
  confirmedConsumptionQuantity: QuantityText | null;
  activeFactId: EntityId | null;
}

export interface DoseOccurrence {
  id: EntityId;
  regimenId: EntityId;
  localServiceDate: LocalDate;
  scheduledAtUtc: UtcInstant;
  onTimeUntilAtUtc: UtcInstant;
  recordUntilAtUtc: UtcInstant;
  currentLifecycle: DoseLifecycle;
  rowVersion: number;
  items: DoseOccurrenceItem[];
  createdAtUtc: UtcInstant;
}

export interface ConsumptionAssertionFact {
  id: EntityId;
  occurrenceItemId: EntityId;
  assertion: Exclude<ItemConsumptionAssertion, 'pending'>;
  confirmedConsumptionQuantity: QuantityText;
  assertedConsumedAtUtc: UtcInstant | null;
  recordedAtUtc: UtcInstant;
  source: 'initial' | 'correction' | 'missed_backfill';
  supersedesFactId: EntityId | null;
  revisionGroupId: EntityId | null;
  commandId: EntityId;
}

export interface InventoryLedgerEntry {
  id: EntityId;
  medicationId: EntityId;
  entryType: 'initial' | 'restock' | 'consumption' | 'reversal' | 'manual_adjustment';
  quantityDelta: SignedQuantityText;
  unit: InventoryUnit;
  sourceFactType: 'medication' | 'consumption_assertion' | 'inventory_ledger' | 'manual';
  sourceFactId: EntityId;
  reversesEntryId: EntityId | null;
  reasonCode: string | null;
  effectiveAtUtc: UtcInstant;
  recordedAtUtc: UtcInstant;
  commandId: EntityId;
}

export interface PhotoEvidence {
  id: EntityId;
  occurrenceId: EntityId;
  state: PhotoEvidenceState;
  captureMode: CaptureMode;
  privateRelativePath: string | null;
  skipReasonCode: string | null;
  capturedAtUtc: UtcInstant | null;
  deletedAtUtc: UtcInstant | null;
  linkedOccurrenceItemIds: EntityId[];
  createdAtUtc: UtcInstant;
}

export interface CountObservation {
  id: EntityId;
  photoEvidenceId: EntityId;
  status: 'counted' | 'unable';
  detectedObjectCount: number | null;
  unableReasonCode: string | null;
  source: 'contour_counter' | 'manual_override';
  algorithmVersion: string;
  recordedAtUtc: UtcInstant;
}

export interface ProcessedCommand {
  commandType: string;
  idempotencyKey: IdempotencyKey;
  payloadFingerprint: string;
  resultJson: string;
  processedAtUtc: UtcInstant;
}

export interface HistoryEntry {
  occurrence: DoseOccurrence;
  photos: PhotoEvidence[];
  countObservations: CountObservation[];
  assertionFacts: ConsumptionAssertionFact[];
  inventoryEntries: InventoryLedgerEntry[];
}
