import type { QuantityText, SignedQuantityText } from './quantity';
import type {
  CaptureMode,
  DoseLifecycle,
  EntityId,
  ItemConsumptionAssertion,
  LocalDate,
  LocalTime,
  PhotoEvidenceState,
  UtcInstant,
} from './model';

export type QuantityUnit = 'count';
export type ThemeMode = 'system' | 'light' | 'dark';
export type TextSize = 'standard' | 'large' | 'extra_large';

export interface AppProfile {
  id: 'local-profile';
  createdAtUtc: UtcInstant;
  updatedAtUtc: UtcInstant;
  rowVersion: number;
}

export interface AppPreferences {
  profileId: AppProfile['id'];
  themeMode: ThemeMode;
  textSize: TextSize;
  updatedAtUtc: UtcInstant;
  rowVersion: number;
}

export interface PersonalMedication {
  id: EntityId;
  displayName: string;
  quantityUnit: QuantityUnit;
  status: 'active' | 'inactive';
  createdAtUtc: UtcInstant;
  updatedAtUtc: UtcInstant;
  rowVersion: number;
}

export interface RegimenVersionItem {
  id: EntityId;
  regimenVersionId: EntityId;
  medicationId: EntityId;
  plannedDoseQuantity: QuantityText;
  quantityUnit: QuantityUnit;
  sortOrder: number;
}

export interface RegimenVersion {
  id: EntityId;
  regimenId: EntityId;
  versionNumber: number;
  name: string;
  localTime: LocalTime;
  timeZone: string;
  onTimeOffsetMinutes: number;
  recordOffsetMinutes: number;
  captureMode: CaptureMode;
  effectiveLocalDate: LocalDate;
  effectiveToLocalDate: LocalDate | null;
  supersededAtUtc: UtcInstant | null;
  supersedesVersionId: EntityId | null;
  items: RegimenVersionItem[];
  createdAtUtc: UtcInstant;
}

export interface PersonalRegimen {
  id: EntityId;
  status: 'active' | 'paused';
  statusEffectiveLocalDate: LocalDate;
  currentVersionId: EntityId;
  rowVersion: number;
  createdAtUtc: UtcInstant;
  updatedAtUtc: UtcInstant;
}

export interface PersonalDoseOccurrenceItem {
  id: EntityId;
  occurrenceId: EntityId;
  regimenVersionItemId: EntityId;
  medicationId: EntityId;
  medicationDisplayName: string;
  plannedDoseQuantity: QuantityText;
  quantityUnit: QuantityUnit;
  sortOrder: number;
  assertion: ItemConsumptionAssertion;
  confirmedConsumptionQuantity: QuantityText | null;
  activeFactId: EntityId | null;
}

export interface PersonalDoseOccurrence {
  id: EntityId;
  regimenId: EntityId;
  regimenVersionId: EntityId;
  localServiceDate: LocalDate;
  scheduledAtUtc: UtcInstant;
  onTimeUntilAtUtc: UtcInstant;
  recordUntilAtUtc: UtcInstant;
  currentLifecycle: DoseLifecycle;
  planProjectionState: 'active' | 'replaced';
  replacedByOccurrenceId: EntityId | null;
  rowVersion: number;
  items: PersonalDoseOccurrenceItem[];
  createdAtUtc: UtcInstant;
}

export type RegimenRevisionType = 'created' | 'modified' | 'paused' | 'resumed';

export interface RegimenRevisionEvent {
  id: EntityId;
  regimenId: EntityId;
  revisionType: RegimenRevisionType;
  previousVersionId: EntityId | null;
  newVersionId: EntityId | null;
  effectiveLocalDate: LocalDate;
  replacedOccurrenceId: EntityId | null;
  newOccurrenceId: EntityId | null;
  recordedAtUtc: UtcInstant;
  commandId: EntityId;
}

export interface PersonalInventoryLedgerEntry {
  id: EntityId;
  medicationId: EntityId;
  entryType: 'initial' | 'restock' | 'consumption' | 'reversal' | 'manual_adjustment';
  quantityDelta: SignedQuantityText;
  quantityUnit: QuantityUnit;
  sourceFactType: 'medication' | 'consumption_assertion' | 'inventory_ledger' | 'manual';
  sourceFactId: EntityId;
  reversesEntryId: EntityId | null;
  reasonCode: string | null;
  effectiveAtUtc: UtcInstant;
  recordedAtUtc: UtcInstant;
  commandId: EntityId;
}

export interface PersonalCountObservation {
  id: EntityId;
  photoEvidenceId: EntityId;
  status: 'counted' | 'unable';
  detectedObjectCount: number | null;
  unableReasonCode: string | null;
  source: 'contour_counter' | 'manual_override';
  algorithmVersion: string;
  recordedAtUtc: UtcInstant;
}

export interface PersonalConsumptionAssertionFact {
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

export interface PersonalFactRevocation {
  id: EntityId;
  factId: EntityId;
  reasonCode: string;
  revisionGroupId: EntityId | null;
  recordedAtUtc: UtcInstant;
  commandId: EntityId;
}

export interface PersonalHistoryEntry {
  occurrence: PersonalDoseOccurrence;
  photos: PersonalPhotoEvidence[];
  countObservations: PersonalCountObservation[];
  assertionFacts: PersonalConsumptionAssertionFact[];
  inventoryEntries: PersonalInventoryLedgerEntry[];
}

export type ReminderIntentStatus = 'active' | 'cancelled' | 'completed';
export type ReminderProjectionStatus =
  | 'pending_rebuild'
  | 'scheduled'
  | 'failed'
  | 'cancel_pending'
  | 'cancelled'
  | 'obsolete';

export interface ReminderIntent {
  id: EntityId;
  regimenId: EntityId;
  occurrenceId: EntityId;
  scheduledAtUtc: UtcInstant;
  timeZone: string;
  privacyMode: 'neutral';
  status: ReminderIntentStatus;
  projectionVersion: number;
  createdAtUtc: UtcInstant;
  updatedAtUtc: UtcInstant;
}

export interface ReminderProjection {
  reminderIntentId: EntityId;
  systemNotificationId: string | null;
  status: ReminderProjectionStatus;
  failureCode: string | null;
  lastReconciledAtUtc: UtcInstant | null;
  rowVersion: number;
}

export interface PersonalPhotoEvidence {
  id: EntityId;
  occurrenceId: EntityId;
  state: PhotoEvidenceState;
  deletionStatus: 'active' | 'pending' | 'deleted';
  captureMode: CaptureMode;
  capturePurpose: 'initial' | 'retake';
  encryptedMediaId: EntityId | null;
  skipReasonCode: string | null;
  capturedAtUtc: UtcInstant | null;
  deletionRequestedAtUtc: UtcInstant | null;
  deletedAtUtc: UtcInstant | null;
  deletionReasonCode: string | null;
  linkedOccurrenceItemIds: EntityId[];
  createdAtUtc: UtcInstant;
}

export interface PersonalProcessedCommand {
  commandType: string;
  idempotencyKey: string;
  payloadFingerprint: string;
  resultJson: string;
  processedAtUtc: UtcInstant;
}

export interface PlanChangeResult {
  effectiveLocalDate: LocalDate;
  effective: 'today' | 'tomorrow';
  replacedOccurrenceId?: EntityId;
  newOccurrenceId?: EntityId;
  notificationRebuildRequired: boolean;
}

export interface LocalDataSummary {
  medicationCount: number;
  occurrenceCount: number;
  activePhotoCount: number;
  deletedPhotoCount: number;
  encryptedPhotoBytes: number;
}

export type InventoryForecastLeadDays = null | 3 | 7 | 14 | 30;

export interface InventoryForecastPreference {
  medicationId: EntityId;
  leadDays: InventoryForecastLeadDays;
  updatedAtUtc: UtcInstant;
  rowVersion: number;
}

export interface MedicationDailyPlan {
  regimenId: EntityId;
  regimenVersionId: EntityId;
  medicationId: EntityId;
  plannedDoseQuantity: QuantityText;
  localTime: LocalTime;
  timeZone: string;
  effectiveLocalDate: LocalDate;
}

export type InventoryForecastUnavailableReason =
  | 'disabled'
  | 'medication_inactive'
  | 'no_active_daily_plan'
  | 'multiple_time_zones';

export interface InventoryForecast {
  medicationId: EntityId;
  balanceQuantity: SignedQuantityText;
  dailyDoseQuantity: QuantityText | null;
  fullDoses: number | null;
  nextPlannedLocalDate: LocalDate | null;
  estimatedShortageLocalDate: LocalDate | null;
  timeZone: string | null;
  leadDays: InventoryForecastLeadDays;
  nominalTriggerAtUtc: UtcInstant | null;
  effectiveTriggerAtUtc: UtcInstant | null;
  unavailableReason: InventoryForecastUnavailableReason | null;
}

export type FollowUpItemType = 'follow_up' | 'refill' | 'test';
export type FollowUpItemStatus = 'pending' | 'completed' | 'cancelled';
export type FollowUpAdvanceDays = null | 1 | 3 | 7;

export interface FollowUpItem {
  id: EntityId;
  type: FollowUpItemType;
  title: string;
  dueAtUtc: UtcInstant;
  timeZone: string;
  medicationId: EntityId | null;
  note: string;
  advanceDays: FollowUpAdvanceDays;
  status: FollowUpItemStatus;
  completedAtUtc: UtcInstant | null;
  cancelledAtUtc: UtcInstant | null;
  createdAtUtc: UtcInstant;
  updatedAtUtc: UtcInstant;
  rowVersion: number;
}

export type FollowUpItemEventType = 'created' | 'edited' | 'completed' | 'cancelled';

export interface FollowUpItemEvent {
  id: EntityId;
  followUpItemId: EntityId;
  eventType: FollowUpItemEventType;
  previousStatus: FollowUpItemStatus | null;
  newStatus: FollowUpItemStatus;
  snapshotJson: string;
  recordedAtUtc: UtcInstant;
  commandId: EntityId;
}

export type AuxiliaryReminderKind = 'refill' | 'follow_up_advance' | 'follow_up_due';
export type AuxiliaryReminderSourceType = 'medication' | 'follow_up_item';

export interface AuxiliaryReminderIntent {
  id: EntityId;
  kind: AuxiliaryReminderKind;
  sourceType: AuxiliaryReminderSourceType;
  sourceId: EntityId;
  triggerAtUtc: UtcInstant;
  timeZone: string;
  status: ReminderIntentStatus;
  projectionVersion: number;
  createdAtUtc: UtcInstant;
  updatedAtUtc: UtcInstant;
}

export interface AuxiliaryReminderProjection {
  reminderIntentId: EntityId;
  systemNotificationId: string | null;
  status: ReminderProjectionStatus;
  failureCode: string | null;
  lastReconciledAtUtc: UtcInstant | null;
  rowVersion: number;
}
