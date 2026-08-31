import type { DemoRepository, UnitOfWork } from '../../application';
import type {
  ConsumptionAssertionFact,
  CountObservation,
  DemoProfile,
  DoseLifecycle,
  DoseOccurrence,
  HistoryEntry,
  InventoryLedgerEntry,
  Medication,
  PhotoEvidence,
  ProcessedCommand,
  Regimen,
} from '../../domain';

interface InMemoryState {
  profile: DemoProfile | null;
  medications: Medication[];
  regimens: Regimen[];
  occurrences: DoseOccurrence[];
  photos: PhotoEvidence[];
  countObservations: CountObservation[];
  assertionFacts: ConsumptionAssertionFact[];
  revocations: { factId: string }[];
  missedItemIds: string[];
  inventoryLedger: InventoryLedgerEntry[];
  processedCommands: ProcessedCommand[];
}

const emptyState = (): InMemoryState => ({
  profile: null,
  medications: [],
  regimens: [],
  occurrences: [],
  photos: [],
  countObservations: [],
  assertionFacts: [],
  revocations: [],
  missedItemIds: [],
  inventoryLedger: [],
  processedCommands: [],
});

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export class InMemoryDemoUnitOfWork implements UnitOfWork {
  private state = emptyState();

  async run<T>(operation: (repository: DemoRepository) => Promise<T>): Promise<T> {
    const working = clone(this.state);
    const result = await operation(new InMemoryDemoRepository(working));
    this.state = working;
    return result;
  }

  snapshot(): Readonly<InMemoryState> {
    return clone(this.state);
  }
}

export class InMemoryDemoRepository implements DemoRepository {
  constructor(private readonly state: InMemoryState) {}

  async getProfile() { return clone(this.state.profile); }
  async saveProfile(profile: DemoProfile) { this.state.profile = clone(profile); }
  async getMedication(id: string) { return clone(this.state.medications.find((x) => x.id === id) ?? null); }
  async listMedications() { return clone(this.state.medications); }
  async insertMedication(value: Medication) { this.state.medications.push(clone(value)); }
  async getRegimen(id: string) { return clone(this.state.regimens.find((x) => x.id === id) ?? null); }
  async listActiveRegimensForDate(date: string) {
    return clone(this.state.regimens.filter((x) => x.status === 'active' && x.startLocalDate <= date && (!x.endLocalDate || x.endLocalDate >= date)));
  }
  async insertRegimen(value: Regimen) { this.state.regimens.push(clone(value)); }
  async getOccurrence(id: string) { return clone(this.state.occurrences.find((x) => x.id === id) ?? null); }
  async getOccurrenceByItemId(itemId: string) { return clone(this.state.occurrences.find((x) => x.items.some((item) => item.id === itemId)) ?? null); }
  async findOccurrence(regimenId: string, date: string) { return clone(this.state.occurrences.find((x) => x.regimenId === regimenId && x.localServiceDate === date) ?? null); }
  async listOccurrences() { return clone(this.state.occurrences); }
  async insertOccurrence(value: DoseOccurrence) { this.state.occurrences.push(clone(value)); }
  async updateOccurrenceLifecycle(id: string, lifecycle: DoseLifecycle) {
    const occurrence = this.state.occurrences.find((x) => x.id === id);
    if (!occurrence) throw new Error('occurrence not found');
    occurrence.currentLifecycle = lifecycle;
    occurrence.rowVersion += 1;
  }
  async insertPhotoEvidence(value: PhotoEvidence) { this.state.photos.push(clone(value)); }
  async listPhotoEvidence(occurrenceId: string) { return clone(this.state.photos.filter((x) => x.occurrenceId === occurrenceId)); }
  async insertCountObservation(value: CountObservation) { this.state.countObservations.push(clone(value)); }
  async listCountObservations(occurrenceId: string) {
    const photoIds = new Set(this.state.photos.filter((x) => x.occurrenceId === occurrenceId).map((x) => x.id));
    return clone(this.state.countObservations.filter((x) => photoIds.has(x.photoEvidenceId)));
  }
  async insertAssertionFact(value: ConsumptionAssertionFact) { this.state.assertionFacts.push(clone(value)); }
  async getAssertionFact(id: string) { return clone(this.state.assertionFacts.find((x) => x.id === id) ?? null); }
  async listAssertionFacts(occurrenceId: string) {
    const occurrence = this.state.occurrences.find((x) => x.id === occurrenceId);
    const ids = new Set(occurrence?.items.map((x) => x.id) ?? []);
    return clone(this.state.assertionFacts.filter((x) => ids.has(x.occurrenceItemId)));
  }
  async revokeAssertionFact(input: { factId: string }) { this.state.revocations.push({ factId: input.factId }); }
  async isAssertionFactRevoked(id: string) { return this.state.revocations.some((x) => x.factId === id); }
  async setItemCurrentFromFact(fact: ConsumptionAssertionFact) {
    const occurrence = this.state.occurrences.find((x) => x.items.some((item) => item.id === fact.occurrenceItemId));
    const item = occurrence?.items.find((x) => x.id === fact.occurrenceItemId);
    if (!item) throw new Error('item not found');
    item.assertion = fact.assertion;
    item.confirmedConsumptionQuantity = fact.confirmedConsumptionQuantity;
    item.activeFactId = fact.id;
  }
  async resetItemCurrent(id: string) {
    const occurrence = this.state.occurrences.find((x) => x.items.some((item) => item.id === id));
    const item = occurrence?.items.find((x) => x.id === id);
    if (!item) throw new Error('item not found');
    item.assertion = 'pending';
    item.confirmedConsumptionQuantity = null;
    item.activeFactId = null;
  }
  async hasMissedEvent(occurrenceId: string) {
    const occurrence = this.state.occurrences.find((x) => x.id === occurrenceId);
    return occurrence ? occurrence.items.some((item) => this.state.missedItemIds.includes(item.id)) : false;
  }
  async addMissedEvents(_occurrenceId: string, itemIds: string[]) {
    for (const id of itemIds) if (!this.state.missedItemIds.includes(id)) this.state.missedItemIds.push(id);
  }
  async insertInventoryEntry(value: InventoryLedgerEntry) { this.state.inventoryLedger.push(clone(value)); }
  async findConsumptionEntry(factId: string) { return clone(this.state.inventoryLedger.find((x) => x.entryType === 'consumption' && x.sourceFactId === factId) ?? null); }
  async findReversalEntry(entryId: string) { return clone(this.state.inventoryLedger.find((x) => x.reversesEntryId === entryId) ?? null); }
  async listInventoryLedger(medicationId?: string) { return clone(this.state.inventoryLedger.filter((x) => !medicationId || x.medicationId === medicationId)); }
  async getProcessedCommand(type: string, key: string) { return clone(this.state.processedCommands.find((x) => x.commandType === type && x.idempotencyKey === key) ?? null); }
  async saveProcessedCommand(value: ProcessedCommand) { this.state.processedCommands.push(clone(value)); }
  async getHistory(occurrenceId: string): Promise<HistoryEntry | null> {
    const occurrence = await this.getOccurrence(occurrenceId);
    if (!occurrence) return null;
    const medicationIds = new Set(occurrence.items.map((x) => x.medicationId));
    return {
      occurrence,
      photos: await this.listPhotoEvidence(occurrenceId),
      countObservations: await this.listCountObservations(occurrenceId),
      assertionFacts: await this.listAssertionFacts(occurrenceId),
      inventoryEntries: clone(this.state.inventoryLedger.filter((x) => medicationIds.has(x.medicationId))),
    };
  }
  async clearAll() { Object.assign(this.state, emptyState()); }
}
