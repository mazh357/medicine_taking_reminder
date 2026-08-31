import type {
  CaptureMode,
  EntityId,
  IdempotencyKey,
  ItemConsumptionAssertion,
  LocalDate,
  LocalTime,
  TextSize,
  ThemeMode,
  UtcInstant,
  FollowUpAdvanceDays,
  FollowUpItemType,
  InventoryForecastLeadDays,
} from '../domain';

export interface PersonalWriteCommand {
  commandId: EntityId;
  idempotencyKey: IdempotencyKey;
  issuedAtUtc: UtcInstant;
  payloadSchemaVersion: 2;
}

export type InitializeAppProfileCommand = PersonalWriteCommand;

export interface SavePreferencesCommand extends PersonalWriteCommand {
  themeMode: ThemeMode;
  textSize: TextSize;
  expectedRowVersion: number;
}

export interface CreateMedicationCommand extends PersonalWriteCommand {
  displayName: string;
  initialInventoryQuantity: string;
}

export interface CreateRegimenCommand extends PersonalWriteCommand {
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

export interface MaterializeDateCommand extends PersonalWriteCommand {
  localDate: LocalDate;
}

export interface UpdateRegimenPlanCommand extends PersonalWriteCommand {
  regimenId: EntityId;
  expectedRowVersion: number;
  currentLocalDate: LocalDate;
  currentAtUtc: UtcInstant;
  changes: {
    name?: string;
    localTime?: LocalTime;
    itemChanges?: {
      medicationId: EntityId;
      displayName?: string;
      plannedDoseQuantity?: string;
    }[];
  };
}

export interface PauseRegimenCommand extends PersonalWriteCommand {
  regimenId: EntityId;
  expectedRowVersion: number;
  currentLocalDate: LocalDate;
  currentAtUtc: UtcInstant;
}

export interface ResumeRegimenCommand extends PersonalWriteCommand {
  regimenId: EntityId;
  expectedRowVersion: number;
  currentLocalDate: LocalDate;
  currentAtUtc: UtcInstant;
}

export interface CorrectInventoryCommand extends PersonalWriteCommand {
  medicationId: EntityId;
  targetInventoryQuantity: string;
  reasonCode: string;
}

export interface ReconcileOccurrenceTimesCommand extends PersonalWriteCommand {
  localDate: LocalDate;
  currentAtUtc: UtcInstant;
}

export interface StartOccurrenceEarlyCommand extends PersonalWriteCommand {
  occurrenceId: EntityId;
  currentLocalDate: LocalDate;
}

export interface PreparePersonalWithPhotoCommand extends PersonalWriteCommand {
  occurrenceId: EntityId;
  currentLocalDate: LocalDate;
  encryptedMediaId: EntityId;
  capturedAtUtc: UtcInstant;
  occurrenceItemIds?: EntityId[];
}

export interface PreparePersonalBySkippingCommand extends PersonalWriteCommand {
  occurrenceId: EntityId;
  currentLocalDate: LocalDate;
  reasonCode: 'camera_unavailable' | 'environment_inconvenient' | 'other';
  occurrenceItemIds?: EntityId[];
}

export interface AppendRetakePhotoCommand extends PersonalWriteCommand {
  occurrenceId: EntityId;
  encryptedMediaId: EntityId;
  capturedAtUtc: UtcInstant;
}

export interface RecordPersonalCountObservationCommand extends PersonalWriteCommand {
  occurrenceId: EntityId;
  photoEvidenceId: EntityId;
  status: 'counted' | 'unable';
  detectedObjectCount: number | null;
  unableReasonCode: string | null;
  source: 'contour_counter' | 'manual_override';
  algorithmVersion: string;
}

export interface PersonalItemConfirmationInput {
  occurrenceItemId: EntityId;
  assertion: Exclude<ItemConsumptionAssertion, 'pending'>;
  confirmedConsumptionQuantity?: string | null;
}

export interface ConfirmPersonalOccurrenceItemsCommand extends PersonalWriteCommand {
  occurrenceId: EntityId;
  confirmedAtUtc: UtcInstant;
  items: PersonalItemConfirmationInput[];
}

export interface RevisePersonalItemConfirmationCommand extends PersonalWriteCommand {
  factId: EntityId;
  assertion: Exclude<ItemConsumptionAssertion, 'pending'>;
  confirmedConsumptionQuantity?: string | null;
  confirmedAtUtc: UtcInstant;
  reasonCode: string;
}

export interface RevokePersonalItemConfirmationCommand extends PersonalWriteCommand {
  factId: EntityId;
  reasonCode: string;
}

export interface RevokePersonalOccurrenceCommand extends PersonalWriteCommand {
  occurrenceId: EntityId;
  reasonCode: string;
}

export interface RequestPhotoDeletionCommand extends PersonalWriteCommand {
  photoEvidenceId: EntityId;
  reasonCode: string;
}

export interface FinalizePhotoTombstoneCommand extends PersonalWriteCommand {
  photoEvidenceId: EntityId;
  mediaDeletionVerified: true;
}

export interface SetInventoryForecastPreferenceCommand extends PersonalWriteCommand {
  medicationId: EntityId;
  leadDays: InventoryForecastLeadDays;
  expectedRowVersion: number;
}

export interface ReconcileAuxiliaryRemindersCommand extends PersonalWriteCommand {
  currentAtUtc: UtcInstant;
  currentLocalDate: LocalDate;
}

export interface CreateFollowUpItemCommand extends PersonalWriteCommand {
  type: FollowUpItemType;
  title: string;
  dueAtUtc: UtcInstant;
  timeZone: string;
  medicationId?: EntityId | null;
  note?: string;
  advanceDays: FollowUpAdvanceDays;
}

export interface EditFollowUpItemCommand extends PersonalWriteCommand {
  followUpItemId: EntityId;
  expectedRowVersion: number;
  changes: {
    type?: FollowUpItemType;
    title?: string;
    dueAtUtc?: UtcInstant;
    timeZone?: string;
    medicationId?: EntityId | null;
    note?: string;
    advanceDays?: FollowUpAdvanceDays;
  };
}

export interface CompleteFollowUpItemCommand extends PersonalWriteCommand {
  followUpItemId: EntityId;
  expectedRowVersion: number;
}

export interface CancelFollowUpItemCommand extends PersonalWriteCommand {
  followUpItemId: EntityId;
  expectedRowVersion: number;
}
