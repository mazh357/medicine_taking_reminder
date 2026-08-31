import type {
  CaptureMode,
  EntityId,
  IdempotencyKey,
  InventoryUnit,
  ItemConsumptionAssertion,
  LocalDate,
  LocalTime,
  QuantityText,
  UtcInstant,
} from '../domain';

export interface WriteCommand {
  commandId: EntityId;
  idempotencyKey: IdempotencyKey;
  issuedAtUtc: UtcInstant;
  payloadSchemaVersion: 1;
}

export interface AcknowledgeDemoCommand extends WriteCommand {
  disclaimerVersion: string;
}

export interface CreateDemoMedicationCommand extends WriteCommand {
  displayName: string;
  dosageForm: InventoryUnit;
  initialInventoryQuantity: string;
}

export interface CreateDailyRegimenCommand extends WriteCommand {
  name: string;
  localTime: LocalTime;
  timeZone: string;
  onTimeOffsetMinutes: number;
  recordOffsetMinutes: number;
  captureMode: CaptureMode;
  startLocalDate: LocalDate;
  items: {
    medicationId: EntityId;
    plannedDoseQuantity: string;
  }[];
}

export interface MaterializeTodayCommand extends WriteCommand {
  localDate: LocalDate;
}

export interface MarkOccurrenceDueCommand extends WriteCommand {
  occurrenceId: EntityId;
  effectiveAtUtc: UtcInstant;
}

export interface MarkOccurrenceMissedCommand extends WriteCommand {
  occurrenceId: EntityId;
  effectiveAtUtc: UtcInstant;
}

export interface PrepareBySkippingCommand extends WriteCommand {
  occurrenceId: EntityId;
  reasonCode: 'camera_unavailable' | 'environment_inconvenient' | 'other';
}

export interface PrepareWithPhotoCommand extends WriteCommand {
  occurrenceId: EntityId;
  privateRelativePath: string;
  capturedAtUtc: UtcInstant;
}

export interface ReplacePreparedPhotoCommand extends WriteCommand {
  occurrenceId: EntityId;
  privateRelativePath: string;
  capturedAtUtc: UtcInstant;
}

export interface RecordCountObservationCommand extends WriteCommand {
  occurrenceId: EntityId;
  photoEvidenceId: EntityId;
  status: 'counted' | 'unable';
  detectedObjectCount: number | null;
  unableReasonCode: string | null;
  source: 'contour_counter' | 'manual_override';
  algorithmVersion: string;
}

export interface ItemConfirmationInput {
  occurrenceItemId: EntityId;
  assertion: Exclude<ItemConsumptionAssertion, 'pending'>;
  confirmedConsumptionQuantity?: string | null;
}

export interface ConfirmOccurrenceItemsCommand extends WriteCommand {
  occurrenceId: EntityId;
  confirmedAtUtc: UtcInstant;
  items: ItemConfirmationInput[];
}

export interface RevokeItemConfirmationCommand extends WriteCommand {
  factId: EntityId;
  reasonCode: string;
}

export interface RevokeOccurrenceCommand extends WriteCommand {
  occurrenceId: EntityId;
  reasonCode: string;
}

export interface ReviseItemConfirmationCommand extends WriteCommand {
  factId: EntityId;
  assertion: Exclude<ItemConsumptionAssertion, 'pending'>;
  confirmedConsumptionQuantity?: string | null;
  confirmedAtUtc: UtcInstant;
  reasonCode: string;
}

export interface InitialInventoryResult {
  medicationId: EntityId;
  quantity: QuantityText;
}

export interface ClearDemoDataCommand extends WriteCommand {
  confirmed: true;
}
