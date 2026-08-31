import type {
  ConsumptionAssertionFact,
  CountObservation,
  DemoProfile,
  DoseLifecycle,
  DoseOccurrence,
  EntityId,
  HistoryEntry,
  InventoryLedgerEntry,
  LocalDate,
  Medication,
  PhotoEvidence,
  ProcessedCommand,
  Regimen,
  UtcInstant,
} from '../domain';

export interface IdGenerator {
  next(): EntityId;
}

export interface Clock {
  now(): UtcInstant;
}

export interface PayloadFingerprinter {
  fingerprint(value: unknown): Promise<string> | string;
}

export interface ScheduleResolver {
  resolveDailySchedule(input: {
    localDate: LocalDate;
    localTime: string;
    timeZone: string;
    onTimeOffsetMinutes: number;
    recordOffsetMinutes: number;
  }): {
    scheduledAtUtc: UtcInstant;
    onTimeUntilAtUtc: UtcInstant;
    recordUntilAtUtc: UtcInstant;
  };
}

export interface DemoRepository {
  getProfile(): Promise<DemoProfile | null>;
  saveProfile(profile: DemoProfile): Promise<void>;

  getMedication(id: EntityId): Promise<Medication | null>;
  listMedications(): Promise<Medication[]>;
  insertMedication(medication: Medication): Promise<void>;

  getRegimen(id: EntityId): Promise<Regimen | null>;
  listActiveRegimensForDate(localDate: LocalDate): Promise<Regimen[]>;
  insertRegimen(regimen: Regimen): Promise<void>;

  getOccurrence(id: EntityId): Promise<DoseOccurrence | null>;
  getOccurrenceByItemId(occurrenceItemId: EntityId): Promise<DoseOccurrence | null>;
  findOccurrence(regimenId: EntityId, localDate: LocalDate): Promise<DoseOccurrence | null>;
  listOccurrences(): Promise<DoseOccurrence[]>;
  insertOccurrence(occurrence: DoseOccurrence): Promise<void>;
  updateOccurrenceLifecycle(
    occurrenceId: EntityId,
    lifecycle: DoseLifecycle,
    commandId: EntityId,
    effectiveAtUtc: UtcInstant,
    reasonCode: string,
  ): Promise<void>;

  insertPhotoEvidence(photo: PhotoEvidence): Promise<void>;
  listPhotoEvidence(occurrenceId: EntityId): Promise<PhotoEvidence[]>;
  insertCountObservation(observation: CountObservation): Promise<void>;
  listCountObservations(occurrenceId: EntityId): Promise<CountObservation[]>;

  insertAssertionFact(fact: ConsumptionAssertionFact): Promise<void>;
  getAssertionFact(factId: EntityId): Promise<ConsumptionAssertionFact | null>;
  listAssertionFacts(occurrenceId: EntityId): Promise<ConsumptionAssertionFact[]>;
  revokeAssertionFact(input: {
    id: EntityId;
    factId: EntityId;
    reasonCode: string;
    revisionGroupId: EntityId | null;
    recordedAtUtc: UtcInstant;
    commandId: EntityId;
  }): Promise<void>;
  isAssertionFactRevoked(factId: EntityId): Promise<boolean>;
  setItemCurrentFromFact(fact: ConsumptionAssertionFact): Promise<void>;
  resetItemCurrent(occurrenceItemId: EntityId): Promise<void>;
  hasMissedEvent(occurrenceId: EntityId): Promise<boolean>;
  addMissedEvents(
    occurrenceId: EntityId,
    pendingOccurrenceItemIds: EntityId[],
    recordUntilAtUtc: UtcInstant,
    recordedAtUtc: UtcInstant,
  ): Promise<void>;

  insertInventoryEntry(entry: InventoryLedgerEntry): Promise<void>;
  findConsumptionEntry(factId: EntityId): Promise<InventoryLedgerEntry | null>;
  findReversalEntry(entryId: EntityId): Promise<InventoryLedgerEntry | null>;
  listInventoryLedger(medicationId?: EntityId): Promise<InventoryLedgerEntry[]>;

  getProcessedCommand(commandType: string, idempotencyKey: string): Promise<ProcessedCommand | null>;
  saveProcessedCommand(command: ProcessedCommand): Promise<void>;

  getHistory(occurrenceId: EntityId): Promise<HistoryEntry | null>;
  clearAll(): Promise<void>;
}

export interface UnitOfWork {
  run<T>(operation: (repository: DemoRepository) => Promise<T>): Promise<T>;
}

export interface DemoApplicationDependencies {
  unitOfWork: UnitOfWork;
  ids: IdGenerator;
  clock: Clock;
  fingerprinter: PayloadFingerprinter;
  scheduleResolver: ScheduleResolver;
}
