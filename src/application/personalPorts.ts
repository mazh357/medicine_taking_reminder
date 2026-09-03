import type {
  AppPreferences,
  AppProfile,
  DoseLifecycle,
  EntityId,
  LocalDate,
  PersonalDoseOccurrence,
  PersonalConsumptionAssertionFact,
  PersonalCountObservation,
  PersonalFactRevocation,
  PersonalHistoryEntry,
  PersonalInventoryLedgerEntry,
  PersonalMedication,
  PersonalPhotoEvidence,
  PersonalProcessedCommand,
  PersonalRegimen,
  RegimenRevisionEvent,
  RegimenVersion,
  ReminderIntent,
  ReminderProjection,
  UtcInstant,
  AuxiliaryReminderIntent,
  AuxiliaryReminderProjection,
  AuxiliaryReminderKind,
  FollowUpItem,
  FollowUpItemEvent,
  InventoryForecastPreference,
  MedicationDailyPlan,
  RegimenRetirementFact,
} from '../domain';
import type { Clock, IdGenerator, PayloadFingerprinter, ScheduleResolver } from './ports';

export interface MedicationRepository {
  getAppProfile(): Promise<AppProfile | null>;
  insertAppProfile(profile: AppProfile, preferences: AppPreferences): Promise<void>;
  getPreferences(): Promise<AppPreferences | null>;
  updatePreferences(preferences: AppPreferences, expectedRowVersion: number): Promise<void>;

  getMedication(id: EntityId): Promise<PersonalMedication | null>;
  listMedications(): Promise<PersonalMedication[]>;
  insertMedication(medication: PersonalMedication): Promise<void>;
  updateMedicationName(
    medicationId: EntityId,
    displayName: string,
    updatedAtUtc: UtcInstant,
  ): Promise<void>;
  setMedicationStatus(input: {
    medicationId: EntityId;
    status: PersonalMedication['status'];
    effectiveLocalDate: LocalDate;
    expectedRowVersion: number;
    updatedAtUtc: UtcInstant;
  }): Promise<void>;
  getInventoryForecastPreference(medicationId: EntityId): Promise<InventoryForecastPreference | null>;
  listInventoryForecastPreferences(): Promise<InventoryForecastPreference[]>;
  insertInventoryForecastPreference(preference: InventoryForecastPreference): Promise<void>;
  updateInventoryForecastPreference(
    preference: InventoryForecastPreference,
    expectedRowVersion: number,
  ): Promise<void>;
  listActiveDailyPlansForMedication(
    medicationId: EntityId,
    localDate: LocalDate,
  ): Promise<MedicationDailyPlan[]>;

  getRegimen(id: EntityId): Promise<PersonalRegimen | null>;
  getRegimenVersion(id: EntityId): Promise<RegimenVersion | null>;
  getEffectiveRegimenVersion(regimenId: EntityId, localDate: LocalDate): Promise<RegimenVersion | null>;
  listRegimensForDate(localDate: LocalDate): Promise<PersonalRegimen[]>;
  listRegimensForMedication(medicationId: EntityId): Promise<PersonalRegimen[]>;
  insertRegimen(regimen: PersonalRegimen, version: RegimenVersion): Promise<void>;
  appendRegimenVersion(
    regimen: PersonalRegimen,
    version: RegimenVersion,
    expectedRowVersion: number,
  ): Promise<void>;
  setRegimenStatus(input: {
    regimenId: EntityId;
    status: PersonalRegimen['status'];
    effectiveLocalDate: LocalDate;
    expectedRowVersion: number;
    updatedAtUtc: UtcInstant;
  }): Promise<void>;
  appendRegimenRevision(event: RegimenRevisionEvent): Promise<void>;
  retireRegimen(
    fact: RegimenRetirementFact,
    expectedRowVersion: number,
    updatedAtUtc: UtcInstant,
  ): Promise<void>;

  getOccurrence(id: EntityId): Promise<PersonalDoseOccurrence | null>;
  getOccurrenceByItemId(occurrenceItemId: EntityId): Promise<PersonalDoseOccurrence | null>;
  findActiveOccurrence(regimenId: EntityId, localDate: LocalDate): Promise<PersonalDoseOccurrence | null>;
  listActiveOccurrencesForDate(localDate: LocalDate): Promise<PersonalDoseOccurrence[]>;
  listAllOccurrencesForDate(localDate: LocalDate): Promise<PersonalDoseOccurrence[]>;
  listAllOccurrences(): Promise<PersonalDoseOccurrence[]>;
  listActiveOccurrencesForRegimenFromDate(
    regimenId: EntityId,
    localDate: LocalDate,
  ): Promise<PersonalDoseOccurrence[]>;
  insertOccurrence(occurrence: PersonalDoseOccurrence): Promise<void>;
  updateOccurrenceLifecycle(
    occurrenceId: EntityId,
    lifecycle: DoseLifecycle,
    commandId: EntityId,
    effectiveAtUtc: UtcInstant,
    reasonCode: string,
  ): Promise<void>;
  replaceOccurrence(
    occurrenceId: EntityId,
    replacementOccurrenceId: EntityId | null,
    commandId: EntityId,
    effectiveAtUtc: UtcInstant,
  ): Promise<void>;
  addMissedEvents(
    occurrenceId: EntityId,
    pendingOccurrenceItemIds: EntityId[],
    recordUntilAtUtc: UtcInstant,
    recordedAtUtc: UtcInstant,
  ): Promise<void>;
  hasMissedEvent(occurrenceId: EntityId): Promise<boolean>;
  resolveMissedEvent(
    occurrenceItemId: EntityId,
    assertionFactId: EntityId,
    recordedAtUtc: UtcInstant,
  ): Promise<void>;

  insertPhotoEvidence(photo: PersonalPhotoEvidence): Promise<void>;
  listPhotoEvidence(occurrenceId: EntityId): Promise<PersonalPhotoEvidence[]>;
  insertCountObservation(observation: PersonalCountObservation): Promise<void>;
  listCountObservations(occurrenceId: EntityId): Promise<PersonalCountObservation[]>;

  insertAssertionFact(fact: PersonalConsumptionAssertionFact): Promise<void>;
  getAssertionFact(factId: EntityId): Promise<PersonalConsumptionAssertionFact | null>;
  listAssertionFacts(occurrenceId: EntityId): Promise<PersonalConsumptionAssertionFact[]>;
  insertFactRevocation(revocation: PersonalFactRevocation): Promise<void>;
  isAssertionFactRevoked(factId: EntityId): Promise<boolean>;
  setItemCurrentFromFact(fact: PersonalConsumptionAssertionFact): Promise<void>;
  resetItemCurrent(occurrenceItemId: EntityId): Promise<void>;

  insertInventoryEntry(entry: PersonalInventoryLedgerEntry): Promise<void>;
  listInventoryLedger(medicationId: EntityId): Promise<PersonalInventoryLedgerEntry[]>;
  listAllInventoryLedger(): Promise<PersonalInventoryLedgerEntry[]>;
  findConsumptionEntry(factId: EntityId): Promise<PersonalInventoryLedgerEntry | null>;
  findReversalEntry(entryId: EntityId): Promise<PersonalInventoryLedgerEntry | null>;

  upsertReminderIntent(intent: ReminderIntent): Promise<void>;
  listAllReminderIntents(): Promise<ReminderIntent[]>;
  getReminderIntentByOccurrence(occurrenceId: EntityId): Promise<ReminderIntent | null>;
  cancelReminderIntent(occurrenceId: EntityId, updatedAtUtc: UtcInstant): Promise<void>;
  getReminderProjection(reminderIntentId: EntityId): Promise<ReminderProjection | null>;
  saveReminderProjection(projection: ReminderProjection): Promise<void>;
  markReminderProjectionPending(occurrenceId: EntityId): Promise<void>;

  getFollowUpItem(id: EntityId): Promise<FollowUpItem | null>;
  insertFollowUpItem(item: FollowUpItem, event: FollowUpItemEvent): Promise<void>;
  updateFollowUpItem(
    item: FollowUpItem,
    event: FollowUpItemEvent,
    expectedRowVersion: number,
  ): Promise<void>;
  listPendingFollowUpItems(): Promise<FollowUpItem[]>;
  listAllFollowUpItems(): Promise<FollowUpItem[]>;
  listOpenFollowUpItemsDueBy(cutoffAtUtc: UtcInstant): Promise<FollowUpItem[]>;
  listFollowUpItemEvents(followUpItemId: EntityId): Promise<FollowUpItemEvent[]>;

  getAuxiliaryReminderIntent(
    kind: AuxiliaryReminderKind,
    sourceId: EntityId,
  ): Promise<AuxiliaryReminderIntent | null>;
  upsertAuxiliaryReminderIntent(intent: AuxiliaryReminderIntent): Promise<void>;
  cancelAuxiliaryReminderIntent(
    kind: AuxiliaryReminderKind,
    sourceId: EntityId,
    updatedAtUtc: UtcInstant,
  ): Promise<void>;
  listActiveAuxiliaryReminderIntents(): Promise<AuxiliaryReminderIntent[]>;
  listAllAuxiliaryReminderIntents(): Promise<AuxiliaryReminderIntent[]>;
  getAuxiliaryReminderProjection(
    reminderIntentId: EntityId,
  ): Promise<AuxiliaryReminderProjection | null>;
  saveAuxiliaryReminderProjection(projection: AuxiliaryReminderProjection): Promise<void>;

  getPhotoEvidence(id: EntityId): Promise<PersonalPhotoEvidence | null>;
  listAllPhotoEvidence(): Promise<PersonalPhotoEvidence[]>;
  markPhotoDeletionPending(
    photoId: EntityId,
    requestedAtUtc: UtcInstant,
    reasonCode: string,
  ): Promise<void>;
  finalizePhotoTombstone(photoId: EntityId, deletedAtUtc: UtcInstant): Promise<void>;
  getHistory(occurrenceId: EntityId): Promise<PersonalHistoryEntry | null>;

  getProcessedCommand(
    commandType: string,
    idempotencyKey: string,
  ): Promise<PersonalProcessedCommand | null>;
  saveProcessedCommand(command: PersonalProcessedCommand): Promise<void>;
}

export interface MedicationUnitOfWork {
  run<T>(operation: (repository: MedicationRepository) => Promise<T>): Promise<T>;
}

export interface MedicationApplicationDependencies {
  unitOfWork: MedicationUnitOfWork;
  ids: IdGenerator;
  clock: Clock;
  fingerprinter: PayloadFingerprinter;
  scheduleResolver: ScheduleResolver;
}
