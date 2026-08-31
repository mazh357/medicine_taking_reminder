import {
  assertDetectedObjectCount,
  assertFictitiousMedicationName,
  assertLocalDate,
  assertLocalTime,
  assertUtcInstant,
  assertWindowOffsets,
  deriveDoseLifecycle,
  DomainRuleError,
  err,
  isPositiveQuantity,
  negateQuantity,
  normalizeQuantity,
  ok,
  signedQuantityFromMilliunits,
  quantityToMilliunits,
  toDomainError,
  validateAssertionQuantity,
  type ConsumptionAssertionFact,
  type DoseOccurrence,
  type HistoryEntry,
  type InventoryLedgerEntry,
  type Medication,
  type PhotoEvidence,
  type Regimen,
  type Result,
} from '../domain';
import type {
  AcknowledgeDemoCommand,
  ClearDemoDataCommand,
  ConfirmOccurrenceItemsCommand,
  CreateDailyRegimenCommand,
  CreateDemoMedicationCommand,
  MarkOccurrenceDueCommand,
  MarkOccurrenceMissedCommand,
  MaterializeTodayCommand,
  PrepareBySkippingCommand,
  PrepareWithPhotoCommand,
  RecordCountObservationCommand,
  ReplacePreparedPhotoCommand,
  ReviseItemConfirmationCommand,
  RevokeItemConfirmationCommand,
  RevokeOccurrenceCommand,
  WriteCommand,
} from './commands';
import type { DemoApplicationDependencies, DemoRepository } from './ports';

type CommandResult<T> = Promise<Result<T>>;

export class DemoApplicationService {
  constructor(private readonly dependencies: DemoApplicationDependencies) {}

  acknowledgeDemo(command: AcknowledgeDemoCommand): CommandResult<{ acknowledged: true }> {
    return this.executeIdempotent('AcknowledgeDemo', command, async (repository) => {
      if (!command.disclaimerVersion.trim()) {
        throw new DomainRuleError('VALIDATION_FAILED', 'error.disclaimer_version_required');
      }
      await repository.saveProfile({
        id: 'demo-profile',
        disclaimerVersion: command.disclaimerVersion,
        acknowledgedAtUtc: command.issuedAtUtc,
      });
      return { acknowledged: true as const };
    });
  }

  createDemoMedication(command: CreateDemoMedicationCommand): CommandResult<Medication> {
    return this.executeIdempotent('CreateDemoMedication', command, async (repository) => {
      await this.requireAcknowledgedDemo(repository);
      const displayName = assertFictitiousMedicationName(command.displayName);
      const initialQuantity = normalizeQuantity(command.initialInventoryQuantity);
      if (!isPositiveQuantity(initialQuantity)) {
        throw new DomainRuleError('QUANTITY_INVALID', 'error.initial_inventory_must_be_positive');
      }

      const medication: Medication = {
        id: this.dependencies.ids.next(),
        displayName,
        dosageForm: command.dosageForm,
        inventoryUnit: command.dosageForm,
        status: 'active',
        createdAtUtc: command.issuedAtUtc,
      };
      await repository.insertMedication(medication);
      await repository.insertInventoryEntry({
        id: this.dependencies.ids.next(),
        medicationId: medication.id,
        entryType: 'initial',
        quantityDelta: signedQuantityFromMilliunits(quantityToMilliunits(initialQuantity)),
        unit: medication.inventoryUnit,
        sourceFactType: 'medication',
        sourceFactId: medication.id,
        reversesEntryId: null,
        reasonCode: 'demo_initial_inventory',
        effectiveAtUtc: command.issuedAtUtc,
        recordedAtUtc: command.issuedAtUtc,
        commandId: command.commandId,
      });
      return medication;
    });
  }

  createDailyRegimen(command: CreateDailyRegimenCommand): CommandResult<Regimen> {
    return this.executeIdempotent('CreateDailyRegimen', command, async (repository) => {
      await this.requireAcknowledgedDemo(repository);
      assertLocalTime(command.localTime);
      assertLocalDate(command.startLocalDate);
      assertWindowOffsets(command.onTimeOffsetMinutes, command.recordOffsetMinutes);
      if (!command.timeZone.trim() || !command.name.trim() || command.items.length === 0) {
        throw new DomainRuleError('VALIDATION_FAILED', 'error.regimen_fields_required');
      }
      if (new Set(command.items.map((item) => item.medicationId)).size !== command.items.length) {
        throw new DomainRuleError('VALIDATION_FAILED', 'error.duplicate_regimen_medication');
      }

      const regimenId = this.dependencies.ids.next();
      const items = [];
      for (const [index, input] of command.items.entries()) {
        const medication = await repository.getMedication(input.medicationId);
        if (!medication || medication.status !== 'active') {
          throw new DomainRuleError('NOT_FOUND', 'error.medication_not_found');
        }
        const plannedDoseQuantity = normalizeQuantity(input.plannedDoseQuantity);
        if (!isPositiveQuantity(plannedDoseQuantity)) {
          throw new DomainRuleError('QUANTITY_INVALID', 'error.planned_quantity_must_be_positive');
        }
        items.push({
          id: this.dependencies.ids.next(),
          regimenId,
          medicationId: medication.id,
          plannedDoseQuantity,
          unit: medication.inventoryUnit,
          sortOrder: index,
        });
      }

      const regimen: Regimen = {
        id: regimenId,
        name: command.name.trim(),
        localTime: command.localTime,
        timeZone: command.timeZone,
        onTimeOffsetMinutes: command.onTimeOffsetMinutes,
        recordOffsetMinutes: command.recordOffsetMinutes,
        captureMode: command.captureMode,
        startLocalDate: command.startLocalDate,
        endLocalDate: null,
        status: 'active',
        rowVersion: 1,
        items,
        createdAtUtc: command.issuedAtUtc,
        updatedAtUtc: command.issuedAtUtc,
      };
      await repository.insertRegimen(regimen);
      return regimen;
    });
  }

  materializeToday(command: MaterializeTodayCommand): CommandResult<DoseOccurrence[]> {
    return this.executeIdempotent('MaterializeToday', command, async (repository) => {
      await this.requireAcknowledgedDemo(repository);
      assertLocalDate(command.localDate);
      const regimens = await repository.listActiveRegimensForDate(command.localDate);
      const occurrences: DoseOccurrence[] = [];
      for (const regimen of regimens) {
        const existing = await repository.findOccurrence(regimen.id, command.localDate);
        if (existing) {
          occurrences.push(existing);
          continue;
        }
        const schedule = this.dependencies.scheduleResolver.resolveDailySchedule({
          localDate: command.localDate,
          localTime: regimen.localTime,
          timeZone: regimen.timeZone,
          onTimeOffsetMinutes: regimen.onTimeOffsetMinutes,
          recordOffsetMinutes: regimen.recordOffsetMinutes,
        });
        assertUtcInstant(schedule.scheduledAtUtc);
        assertUtcInstant(schedule.onTimeUntilAtUtc);
        assertUtcInstant(schedule.recordUntilAtUtc);
        if (
          Date.parse(schedule.scheduledAtUtc) >= Date.parse(schedule.onTimeUntilAtUtc) ||
          Date.parse(schedule.onTimeUntilAtUtc) >= Date.parse(schedule.recordUntilAtUtc)
        ) {
          throw new DomainRuleError('WINDOW_ORDER_INVALID', 'error.window_order_invalid');
        }

        const occurrenceId = this.dependencies.ids.next();
        const items = [];
        for (const regimenItem of regimen.items) {
          const medication = await repository.getMedication(regimenItem.medicationId);
          if (!medication) throw new DomainRuleError('NOT_FOUND', 'error.medication_not_found');
          items.push({
            id: this.dependencies.ids.next(),
            occurrenceId,
            regimenItemId: regimenItem.id,
            medicationId: medication.id,
            medicationDisplayName: medication.displayName,
            plannedDoseQuantity: regimenItem.plannedDoseQuantity,
            unit: regimenItem.unit,
            sortOrder: regimenItem.sortOrder,
            assertion: 'pending' as const,
            confirmedConsumptionQuantity: null,
            activeFactId: null,
          });
        }
        const occurrence: DoseOccurrence = {
          id: occurrenceId,
          regimenId: regimen.id,
          localServiceDate: command.localDate,
          scheduledAtUtc: schedule.scheduledAtUtc,
          onTimeUntilAtUtc: schedule.onTimeUntilAtUtc,
          recordUntilAtUtc: schedule.recordUntilAtUtc,
          currentLifecycle: 'scheduled',
          rowVersion: 1,
          items,
          createdAtUtc: command.issuedAtUtc,
        };
        await repository.insertOccurrence(occurrence);
        occurrences.push(occurrence);
      }
      return occurrences;
    });
  }

  markOccurrenceDue(command: MarkOccurrenceDueCommand): CommandResult<DoseOccurrence> {
    return this.executeIdempotent('MarkOccurrenceDue', command, async (repository) => {
      const occurrence = await this.requireOccurrence(repository, command.occurrenceId);
      if (occurrence.currentLifecycle !== 'scheduled') {
        if (occurrence.currentLifecycle === 'due') return occurrence;
        throw new DomainRuleError('ILLEGAL_STATE_TRANSITION', 'error.occurrence_not_scheduled');
      }
      if (Date.parse(command.effectiveAtUtc) < Date.parse(occurrence.scheduledAtUtc)) {
        throw new DomainRuleError('ILLEGAL_STATE_TRANSITION', 'error.occurrence_not_due_yet');
      }
      await repository.updateOccurrenceLifecycle(
        occurrence.id,
        'due',
        command.commandId,
        command.effectiveAtUtc,
        'scheduled_time_reached',
      );
      return (await repository.getOccurrence(occurrence.id))!;
    });
  }

  prepareBySkipping(command: PrepareBySkippingCommand): CommandResult<PhotoEvidence> {
    return this.executeIdempotent('PrepareBySkipping', command, async (repository) => {
      const occurrence = await this.requirePreparableOccurrence(
        repository,
        command.occurrenceId,
        command.issuedAtUtc,
        command.commandId,
      );
      const photo: PhotoEvidence = {
        id: this.dependencies.ids.next(),
        occurrenceId: occurrence.id,
        state: 'skipped_with_reason',
        captureMode: 'group',
        privateRelativePath: null,
        skipReasonCode: command.reasonCode,
        capturedAtUtc: null,
        deletedAtUtc: null,
        linkedOccurrenceItemIds: occurrence.items.map((item) => item.id),
        createdAtUtc: command.issuedAtUtc,
      };
      await repository.insertPhotoEvidence(photo);
      await repository.updateOccurrenceLifecycle(
        occurrence.id,
        'prepared',
        command.commandId,
        command.issuedAtUtc,
        'photo_skipped_with_reason',
      );
      return photo;
    });
  }

  prepareWithPhoto(command: PrepareWithPhotoCommand): CommandResult<PhotoEvidence> {
    return this.executeIdempotent('PrepareWithPhoto', command, async (repository) => {
      const occurrence = await this.requirePreparableOccurrence(
        repository,
        command.occurrenceId,
        command.issuedAtUtc,
        command.commandId,
      );
      assertUtcInstant(command.capturedAtUtc);
      const path = command.privateRelativePath.trim();
      if (!path || path.startsWith('/') || path.includes('..') || path.includes(':') || path.includes('\\')) {
        throw new DomainRuleError('VALIDATION_FAILED', 'error.private_relative_path_invalid');
      }
      const regimen = await repository.getRegimen(occurrence.regimenId);
      if (!regimen) throw new DomainRuleError('NOT_FOUND', 'error.regimen_not_found');
      const photo: PhotoEvidence = {
        id: this.dependencies.ids.next(),
        occurrenceId: occurrence.id,
        state: 'captured',
        captureMode: regimen.captureMode,
        privateRelativePath: path,
        skipReasonCode: null,
        capturedAtUtc: command.capturedAtUtc,
        deletedAtUtc: null,
        linkedOccurrenceItemIds: occurrence.items.map((item) => item.id),
        createdAtUtc: command.issuedAtUtc,
      };
      await repository.insertPhotoEvidence(photo);
      await repository.updateOccurrenceLifecycle(
        occurrence.id,
        'prepared',
        command.commandId,
        command.issuedAtUtc,
        'photo_captured',
      );
      return photo;
    });
  }

  replacePreparedPhoto(command: ReplacePreparedPhotoCommand): CommandResult<PhotoEvidence> {
    return this.executeIdempotent('ReplacePreparedPhoto', command, async (repository) => {
      const occurrence = await this.requireOccurrence(repository, command.occurrenceId);
      if (occurrence.currentLifecycle !== 'prepared') {
        throw new DomainRuleError(
          'ILLEGAL_STATE_TRANSITION',
          'error.occurrence_photo_not_replaceable',
        );
      }
      const existingEvidence = await repository.listPhotoEvidence(occurrence.id);
      if (existingEvidence.length === 0) {
        throw new DomainRuleError('EVIDENCE_REQUIRED', 'error.photo_evidence_missing');
      }
      assertUtcInstant(command.capturedAtUtc);
      const path = command.privateRelativePath.trim();
      if (!path || path.startsWith('/') || path.includes('..') || path.includes(':') || path.includes('\\')) {
        throw new DomainRuleError('VALIDATION_FAILED', 'error.private_relative_path_invalid');
      }
      const regimen = await repository.getRegimen(occurrence.regimenId);
      if (!regimen) throw new DomainRuleError('NOT_FOUND', 'error.regimen_not_found');
      const photo: PhotoEvidence = {
        id: this.dependencies.ids.next(),
        occurrenceId: occurrence.id,
        state: 'captured',
        captureMode: regimen.captureMode,
        privateRelativePath: path,
        skipReasonCode: null,
        capturedAtUtc: command.capturedAtUtc,
        deletedAtUtc: null,
        linkedOccurrenceItemIds: occurrence.items.map((item) => item.id),
        createdAtUtc: command.issuedAtUtc,
      };
      await repository.insertPhotoEvidence(photo);
      return photo;
    });
  }

  recordCountObservation(command: RecordCountObservationCommand): CommandResult<{ observationId: string }> {
    return this.executeIdempotent('RecordCountObservation', command, async (repository) => {
      const photos = await repository.listPhotoEvidence(command.occurrenceId);
      const photo = photos.find((candidate) => candidate.id === command.photoEvidenceId);
      if (!photo || photo.state !== 'captured') {
        throw new DomainRuleError('NOT_FOUND', 'error.captured_photo_not_found');
      }
      assertDetectedObjectCount(command.detectedObjectCount);
      if (
        (command.status === 'counted' && command.detectedObjectCount == null) ||
        (command.status === 'unable' && !command.unableReasonCode)
      ) {
        throw new DomainRuleError('VALIDATION_FAILED', 'error.count_observation_invalid');
      }
      const id = this.dependencies.ids.next();
      await repository.insertCountObservation({
        id,
        photoEvidenceId: photo.id,
        status: command.status,
        detectedObjectCount: command.status === 'counted' ? command.detectedObjectCount : null,
        unableReasonCode: command.status === 'unable' ? command.unableReasonCode : null,
        source: command.source,
        algorithmVersion: command.algorithmVersion,
        recordedAtUtc: command.issuedAtUtc,
      });
      return { observationId: id };
    });
  }

  confirmOccurrenceItems(command: ConfirmOccurrenceItemsCommand): CommandResult<DoseOccurrence> {
    return this.executeIdempotent('ConfirmOccurrenceItems', command, async (repository) => {
      const occurrence = await this.requireOccurrence(repository, command.occurrenceId);
      if (!['prepared', 'missed'].includes(occurrence.currentLifecycle)) {
        throw new DomainRuleError('EVIDENCE_REQUIRED', 'error.occurrence_not_prepared');
      }
      if (command.items.length === 0 || new Set(command.items.map((item) => item.occurrenceItemId)).size !== command.items.length) {
        throw new DomainRuleError('VALIDATION_FAILED', 'error.confirmation_items_invalid');
      }
      assertUtcInstant(command.confirmedAtUtc);
      const source = occurrence.currentLifecycle === 'missed' ? 'missed_backfill' : 'initial';
      for (const input of command.items) {
        const item = occurrence.items.find((candidate) => candidate.id === input.occurrenceItemId);
        if (!item) throw new DomainRuleError('NOT_FOUND', 'error.occurrence_item_not_found');
        if (item.activeFactId) {
          throw new DomainRuleError('ILLEGAL_STATE_TRANSITION', 'error.item_requires_revision');
        }
        const quantity = validateAssertionQuantity(
          input.assertion,
          input.confirmedConsumptionQuantity,
          item.plannedDoseQuantity,
        );
        const fact: ConsumptionAssertionFact = {
          id: this.dependencies.ids.next(),
          occurrenceItemId: item.id,
          assertion: input.assertion,
          confirmedConsumptionQuantity: quantity,
          assertedConsumedAtUtc: isPositiveQuantity(quantity) ? command.confirmedAtUtc : null,
          recordedAtUtc: command.issuedAtUtc,
          source,
          supersedesFactId: null,
          revisionGroupId: null,
          commandId: command.commandId,
        };
        await repository.insertAssertionFact(fact);
        await repository.setItemCurrentFromFact(fact);
        if (isPositiveQuantity(quantity)) {
          await repository.insertInventoryEntry(
            this.consumptionEntry(command, item.medicationId, item.unit, fact),
          );
        }
      }
      return this.recalculateLifecycle(repository, occurrence.id, command.confirmedAtUtc, command.commandId);
    });
  }

  markOccurrenceMissed(command: MarkOccurrenceMissedCommand): CommandResult<DoseOccurrence> {
    return this.executeIdempotent('MarkOccurrenceMissed', command, async (repository) => {
      const occurrence = await this.requireOccurrence(repository, command.occurrenceId);
      if (Date.parse(command.effectiveAtUtc) < Date.parse(occurrence.recordUntilAtUtc)) {
        throw new DomainRuleError('ILLEGAL_STATE_TRANSITION', 'error.record_window_not_ended');
      }
      const pending = occurrence.items.filter((item) => item.assertion === 'pending').map((item) => item.id);
      if (pending.length === 0) return occurrence;
      await repository.addMissedEvents(
        occurrence.id,
        pending,
        occurrence.recordUntilAtUtc,
        command.effectiveAtUtc,
      );
      await repository.updateOccurrenceLifecycle(
        occurrence.id,
        'missed',
        command.commandId,
        command.effectiveAtUtc,
        'record_window_ended',
      );
      return (await repository.getOccurrence(occurrence.id))!;
    });
  }

  revokeItemConfirmation(command: RevokeItemConfirmationCommand): CommandResult<DoseOccurrence> {
    return this.executeIdempotent('RevokeItemConfirmation', command, async (repository) => {
      const fact = await repository.getAssertionFact(command.factId);
      if (!fact) throw new DomainRuleError('NOT_FOUND', 'error.assertion_fact_not_found');
      if (await repository.isAssertionFactRevoked(fact.id)) {
        const current = await repository.getOccurrenceByItemId(fact.occurrenceItemId);
        if (!current) throw new DomainRuleError('NOT_FOUND', 'error.occurrence_not_found');
        return current;
      }
      const occurrence = await repository.getOccurrenceByItemId(fact.occurrenceItemId);
      if (!occurrence) throw new DomainRuleError('NOT_FOUND', 'error.occurrence_not_found');
      await repository.revokeAssertionFact({
        id: this.dependencies.ids.next(),
        factId: fact.id,
        reasonCode: command.reasonCode,
        revisionGroupId: null,
        recordedAtUtc: command.issuedAtUtc,
        commandId: command.commandId,
      });
      await this.reverseConsumptionIfPresent(repository, fact, command);
      await repository.resetItemCurrent(fact.occurrenceItemId);
      return this.recalculateLifecycle(
        repository,
        occurrence.id,
        command.issuedAtUtc,
        command.commandId,
      );
    });
  }

  revokeOccurrence(command: RevokeOccurrenceCommand): CommandResult<DoseOccurrence> {
    return this.executeIdempotent('RevokeOccurrence', command, async (repository) => {
      const occurrence = await this.requireOccurrence(repository, command.occurrenceId);
      if (occurrence.currentLifecycle === 'revoked' && occurrence.items.every((item) => !item.activeFactId)) {
        return occurrence;
      }

      for (const item of occurrence.items) {
        if (!item.activeFactId) continue;
        const fact = await repository.getAssertionFact(item.activeFactId);
        if (!fact) {
          throw new DomainRuleError('LEDGER_INVARIANT_VIOLATION', 'error.active_fact_not_found');
        }
        if (!(await repository.isAssertionFactRevoked(fact.id))) {
          await repository.revokeAssertionFact({
            id: this.dependencies.ids.next(),
            factId: fact.id,
            reasonCode: command.reasonCode,
            revisionGroupId: null,
            recordedAtUtc: command.issuedAtUtc,
            commandId: command.commandId,
          });
          await this.reverseConsumptionIfPresent(
            repository,
            fact,
            command,
            'occurrence_revoked',
          );
        }
        await repository.resetItemCurrent(item.id);
      }

      await repository.updateOccurrenceLifecycle(
        occurrence.id,
        'revoked',
        command.commandId,
        command.issuedAtUtc,
        command.reasonCode,
      );
      return (await repository.getOccurrence(occurrence.id))!;
    });
  }

  reviseItemConfirmation(command: ReviseItemConfirmationCommand): CommandResult<DoseOccurrence> {
    return this.executeIdempotent('ReviseItemConfirmation', command, async (repository) => {
      const oldFact = await repository.getAssertionFact(command.factId);
      if (!oldFact) throw new DomainRuleError('NOT_FOUND', 'error.assertion_fact_not_found');
      if (await repository.isAssertionFactRevoked(oldFact.id)) {
        throw new DomainRuleError('ALREADY_REVOKED', 'error.assertion_fact_already_revoked');
      }
      const occurrence = await repository.getOccurrenceByItemId(oldFact.occurrenceItemId);
      if (!occurrence) throw new DomainRuleError('NOT_FOUND', 'error.occurrence_not_found');
      const item = occurrence.items.find((candidate) => candidate.id === oldFact.occurrenceItemId)!;
      const quantity = validateAssertionQuantity(
        command.assertion,
        command.confirmedConsumptionQuantity,
        item.plannedDoseQuantity,
      );
      const revisionGroupId = this.dependencies.ids.next();
      await repository.revokeAssertionFact({
        id: this.dependencies.ids.next(),
        factId: oldFact.id,
        reasonCode: command.reasonCode,
        revisionGroupId,
        recordedAtUtc: command.issuedAtUtc,
        commandId: command.commandId,
      });
      await this.reverseConsumptionIfPresent(repository, oldFact, command, 'confirmation_revised');
      const newFact: ConsumptionAssertionFact = {
        id: this.dependencies.ids.next(),
        occurrenceItemId: item.id,
        assertion: command.assertion,
        confirmedConsumptionQuantity: quantity,
        assertedConsumedAtUtc: isPositiveQuantity(quantity) ? command.confirmedAtUtc : null,
        recordedAtUtc: command.issuedAtUtc,
        source: 'correction',
        supersedesFactId: oldFact.id,
        revisionGroupId,
        commandId: command.commandId,
      };
      await repository.insertAssertionFact(newFact);
      await repository.setItemCurrentFromFact(newFact);
      if (isPositiveQuantity(quantity)) {
        await repository.insertInventoryEntry(
          this.consumptionEntry(command, item.medicationId, item.unit, newFact),
        );
      }
      return this.recalculateLifecycle(
        repository,
        occurrence.id,
        command.confirmedAtUtc,
        command.commandId,
      );
    });
  }

  async getHistory(occurrenceId: string): Promise<Result<HistoryEntry>> {
    try {
      const history = await this.dependencies.unitOfWork.run((repository) =>
        repository.getHistory(occurrenceId),
      );
      return history ? ok(history) : err('NOT_FOUND', 'error.occurrence_not_found');
    } catch (error) {
      return { ok: false, error: toDomainError(error) };
    }
  }

  async getInventoryBalance(medicationId: string): Promise<Result<string>> {
    try {
      const ledger = await this.dependencies.unitOfWork.run((repository) =>
        repository.listInventoryLedger(medicationId),
      );
      const balance = signedQuantityFromMilliunits(
        ledger.reduce((total, entry) => total + this.signedDelta(entry.quantityDelta), 0n),
      );
      return ok(balance);
    } catch (error) {
      return { ok: false, error: toDomainError(error) };
    }
  }

  async clearAllDemoData(command: ClearDemoDataCommand): Promise<Result<{ cleared: true }>> {
    try {
      if (!command.confirmed) {
        return err('VALIDATION_FAILED', 'error.clear_confirmation_required');
      }
      await this.dependencies.unitOfWork.run((repository) => repository.clearAll());
      return ok({ cleared: true });
    } catch (error) {
      return { ok: false, error: toDomainError(error) };
    }
  }

  private async executeIdempotent<T>(
    commandType: string,
    command: WriteCommand,
    operation: (repository: DemoRepository) => Promise<T>,
  ): CommandResult<T> {
    try {
      assertUtcInstant(command.issuedAtUtc);
      if (!command.commandId || !command.idempotencyKey || command.payloadSchemaVersion !== 1) {
        throw new DomainRuleError('VALIDATION_FAILED', 'error.command_metadata_invalid');
      }
      const payloadFingerprint = await this.dependencies.fingerprinter.fingerprint(
        this.businessPayload(command),
      );
      const value = await this.dependencies.unitOfWork.run(async (repository) => {
        const processed = await repository.getProcessedCommand(commandType, command.idempotencyKey);
        if (processed) {
          if (processed.payloadFingerprint !== payloadFingerprint) {
            throw new DomainRuleError('IDEMPOTENCY_CONFLICT', 'error.idempotency_conflict');
          }
          return JSON.parse(processed.resultJson) as T;
        }
        const result = await operation(repository);
        await repository.saveProcessedCommand({
          commandType,
          idempotencyKey: command.idempotencyKey,
          payloadFingerprint,
          resultJson: JSON.stringify(result),
          processedAtUtc: this.dependencies.clock.now(),
        });
        return result;
      });
      return ok(value);
    } catch (error) {
      return { ok: false, error: toDomainError(error) };
    }
  }

  private businessPayload(command: WriteCommand): Record<string, unknown> {
    const { commandId: _commandId, idempotencyKey: _key, issuedAtUtc: _issued, ...payload } = command;
    return payload;
  }

  private async requireAcknowledgedDemo(repository: DemoRepository): Promise<void> {
    if (!(await repository.getProfile())) {
      throw new DomainRuleError('VALIDATION_FAILED', 'error.demo_disclaimer_not_acknowledged');
    }
  }

  private async requireOccurrence(repository: DemoRepository, id: string): Promise<DoseOccurrence> {
    const occurrence = await repository.getOccurrence(id);
    if (!occurrence) throw new DomainRuleError('NOT_FOUND', 'error.occurrence_not_found');
    return occurrence;
  }

  private async requirePreparableOccurrence(
    repository: DemoRepository,
    id: string,
    effectiveAtUtc: string,
    commandId: string,
  ): Promise<DoseOccurrence> {
    let occurrence = await this.requireOccurrence(repository, id);
    if (occurrence.currentLifecycle === 'scheduled') {
      if (Date.parse(effectiveAtUtc) < Date.parse(occurrence.scheduledAtUtc)) {
        throw new DomainRuleError('ILLEGAL_STATE_TRANSITION', 'error.occurrence_not_due_yet');
      }
      await repository.updateOccurrenceLifecycle(
        occurrence.id,
        'due',
        commandId,
        effectiveAtUtc,
        'opened_at_or_after_scheduled_time',
      );
      occurrence = (await repository.getOccurrence(occurrence.id))!;
    }
    if (occurrence.currentLifecycle !== 'due') {
      throw new DomainRuleError('ILLEGAL_STATE_TRANSITION', 'error.occurrence_not_preparable');
    }
    return occurrence;
  }

  private consumptionEntry(
    command: WriteCommand,
    medicationId: string,
    unit: InventoryLedgerEntry['unit'],
    fact: ConsumptionAssertionFact,
  ): InventoryLedgerEntry {
    return {
      id: this.dependencies.ids.next(),
      medicationId,
      entryType: 'consumption',
      quantityDelta: negateQuantity(fact.confirmedConsumptionQuantity),
      unit,
      sourceFactType: 'consumption_assertion',
      sourceFactId: fact.id,
      reversesEntryId: null,
      reasonCode: null,
      effectiveAtUtc: fact.assertedConsumedAtUtc ?? command.issuedAtUtc,
      recordedAtUtc: command.issuedAtUtc,
      commandId: command.commandId,
    };
  }

  private async reverseConsumptionIfPresent(
    repository: DemoRepository,
    fact: ConsumptionAssertionFact,
    command: WriteCommand,
    reasonCode = 'confirmation_revoked',
  ): Promise<void> {
    const original = await repository.findConsumptionEntry(fact.id);
    if (!original || (await repository.findReversalEntry(original.id))) return;
    await repository.insertInventoryEntry({
      id: this.dependencies.ids.next(),
      medicationId: original.medicationId,
      entryType: 'reversal',
      quantityDelta: signedQuantityFromMilliunits(-this.signedDelta(original.quantityDelta)),
      unit: original.unit,
      sourceFactType: 'inventory_ledger',
      sourceFactId: original.id,
      reversesEntryId: original.id,
      reasonCode,
      effectiveAtUtc: command.issuedAtUtc,
      recordedAtUtc: command.issuedAtUtc,
      commandId: command.commandId,
    });
  }

  private signedDelta(value: string): bigint {
    const negative = value.startsWith('-');
    const absolute = quantityToMilliunits(normalizeQuantity(negative ? value.slice(1) : value));
    return negative ? -absolute : absolute;
  }

  private async recalculateLifecycle(
    repository: DemoRepository,
    occurrenceId: string,
    effectiveAtUtc: string,
    commandId: string,
  ): Promise<DoseOccurrence> {
    const current = await this.requireOccurrence(repository, occurrenceId);
    const next = deriveDoseLifecycle(
      current.currentLifecycle,
      current.items,
      effectiveAtUtc,
      current.onTimeUntilAtUtc,
      await repository.hasMissedEvent(occurrenceId),
    );
    if (next !== current.currentLifecycle) {
      await repository.updateOccurrenceLifecycle(
        current.id,
        next,
        commandId,
        effectiveAtUtc,
        'item_projection_recalculated',
      );
    }
    return (await repository.getOccurrence(occurrenceId))!;
  }
}
