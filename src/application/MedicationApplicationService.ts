import {
  addLocalDays,
  assertDetectedObjectCount,
  assertFollowUpAdvanceDays,
  assertFollowUpNote,
  assertFollowUpTitle,
  assertFollowUpType,
  assertIanaTimeZone,
  assertInventoryForecastLeadDays,
  assertLocalDate,
  assertLocalTime,
  assertMedicationDisplayName,
  assertTextSize,
  assertThemeMode,
  assertUtcInstant,
  assertWindowOffsets,
  deriveDoseLifecycle,
  DomainRuleError,
  err,
  isPositiveQuantity,
  negateQuantity,
  nextLocalDate,
  normalizeNonNegativeQuantity,
  normalizePositiveQuantity,
  ok,
  quantityFromMilliunits,
  quantityToMilliunits,
  signedQuantityFromMilliunits,
  signedQuantityToMilliunits,
  toDomainError,
  validateAssertionQuantity,
  type AppPreferences,
  type AppProfile,
  type AuxiliaryReminderIntent,
  type AuxiliaryReminderKind,
  type AuxiliaryReminderSourceType,
  type FollowUpItem,
  type FollowUpItemEvent,
  type InventoryForecast,
  type InventoryForecastPreference,
  type PersonalDoseOccurrence,
  type PersonalConsumptionAssertionFact,
  type PersonalHistoryEntry,
  type PersonalInventoryLedgerEntry,
  type PersonalMedication,
  type PersonalPhotoEvidence,
  type PersonalRegimen,
  type PlanChangeResult,
  type RegimenVersion,
  type ReminderIntent,
  type Result,
} from '../domain';
import type {
  AppendRetakePhotoCommand,
  CancelFollowUpItemCommand,
  CompleteFollowUpItemCommand,
  CorrectInventoryCommand,
  ConfirmPersonalOccurrenceItemsCommand,
  CreateMedicationCommand,
  CreateRegimenCommand,
  CreateFollowUpItemCommand,
  EditFollowUpItemCommand,
  FinalizePhotoTombstoneCommand,
  InitializeAppProfileCommand,
  MaterializeDateCommand,
  PauseRegimenCommand,
  PersonalWriteCommand,
  PreparePersonalBySkippingCommand,
  PreparePersonalWithPhotoCommand,
  RecordPersonalCountObservationCommand,
  ReconcileOccurrenceTimesCommand,
  ReconcileAuxiliaryRemindersCommand,
  RequestPhotoDeletionCommand,
  ResumeRegimenCommand,
  RevisePersonalItemConfirmationCommand,
  RevokePersonalItemConfirmationCommand,
  RevokePersonalOccurrenceCommand,
  SavePreferencesCommand,
  SetInventoryForecastPreferenceCommand,
  StartOccurrenceEarlyCommand,
  UpdateRegimenPlanCommand,
} from './personalCommands';
import type {
  MedicationApplicationDependencies,
  MedicationRepository,
} from './personalPorts';

type CommandResult<T> = Promise<Result<T>>;

export class MedicationApplicationService {
  constructor(private readonly dependencies: MedicationApplicationDependencies) {}

  initializeProfile(command: InitializeAppProfileCommand): CommandResult<{
    profile: AppProfile;
    preferences: AppPreferences;
  }> {
    return this.executeIdempotent('InitializeAppProfile', command, async (repository) => {
      const existing = await repository.getAppProfile();
      const existingPreferences = await repository.getPreferences();
      if (existing && existingPreferences) {
        return { profile: existing, preferences: existingPreferences };
      }
      if (existing || existingPreferences) {
        throw new DomainRuleError('LEDGER_INVARIANT_VIOLATION', 'error.profile_projection_incomplete');
      }
      const profile: AppProfile = {
        id: 'local-profile',
        createdAtUtc: command.issuedAtUtc,
        updatedAtUtc: command.issuedAtUtc,
        rowVersion: 1,
      };
      const preferences: AppPreferences = {
        profileId: profile.id,
        themeMode: 'system',
        textSize: 'standard',
        updatedAtUtc: command.issuedAtUtc,
        rowVersion: 1,
      };
      await repository.insertAppProfile(profile, preferences);
      return { profile, preferences };
    });
  }

  savePreferences(command: SavePreferencesCommand): CommandResult<AppPreferences> {
    return this.executeIdempotent('SavePreferences', command, async (repository) => {
      assertThemeMode(command.themeMode);
      assertTextSize(command.textSize);
      const current = await repository.getPreferences();
      if (!current) throw new DomainRuleError('NOT_FOUND', 'error.preferences_not_found');
      const next: AppPreferences = {
        ...current,
        themeMode: command.themeMode,
        textSize: command.textSize,
        updatedAtUtc: command.issuedAtUtc,
        rowVersion: current.rowVersion + 1,
      };
      await repository.updatePreferences(next, command.expectedRowVersion);
      return next;
    });
  }

  createMedication(command: CreateMedicationCommand): CommandResult<PersonalMedication> {
    return this.executeIdempotent('CreateMedication', command, async (repository) => {
      await this.requireProfile(repository);
      const displayName = assertMedicationDisplayName(command.displayName);
      const initialInventory = normalizeNonNegativeQuantity(command.initialInventoryQuantity);
      const medication: PersonalMedication = {
        id: this.dependencies.ids.next(),
        displayName,
        quantityUnit: 'count',
        status: 'active',
        createdAtUtc: command.issuedAtUtc,
        updatedAtUtc: command.issuedAtUtc,
        rowVersion: 1,
      };
      await repository.insertMedication(medication);
      await repository.insertInventoryForecastPreference({
        medicationId: medication.id,
        leadDays: 7,
        updatedAtUtc: command.issuedAtUtc,
        rowVersion: 1,
      });
      if (isPositiveQuantity(initialInventory)) {
        await repository.insertInventoryEntry({
          id: this.dependencies.ids.next(),
          medicationId: medication.id,
          entryType: 'initial',
          quantityDelta: signedQuantityFromMilliunits(quantityToMilliunits(initialInventory)),
          quantityUnit: 'count',
          sourceFactType: 'medication',
          sourceFactId: medication.id,
          reversesEntryId: null,
          reasonCode: 'initial_inventory',
          effectiveAtUtc: command.issuedAtUtc,
          recordedAtUtc: command.issuedAtUtc,
          commandId: command.commandId,
        });
      }
      return medication;
    });
  }

  createRegimen(command: CreateRegimenCommand): CommandResult<PersonalRegimen> {
    return this.executeIdempotent('CreateRegimen', command, async (repository) => {
      await this.requireProfile(repository);
      assertLocalDate(command.startLocalDate);
      assertLocalTime(command.localTime);
      assertWindowOffsets(command.onTimeOffsetMinutes, command.recordOffsetMinutes);
      if (!command.name.trim() || !command.timeZone.trim() || command.items.length === 0) {
        throw new DomainRuleError('VALIDATION_FAILED', 'error.regimen_fields_required');
      }
      if (new Set(command.items.map((item) => item.medicationId)).size !== command.items.length) {
        throw new DomainRuleError('VALIDATION_FAILED', 'error.duplicate_regimen_medication');
      }
      const regimenId = this.dependencies.ids.next();
      const versionId = this.dependencies.ids.next();
      const items = [];
      for (const [sortOrder, input] of command.items.entries()) {
        const medication = await repository.getMedication(input.medicationId);
        if (!medication || medication.status !== 'active') {
          throw new DomainRuleError('NOT_FOUND', 'error.medication_not_found');
        }
        items.push({
          id: this.dependencies.ids.next(),
          regimenVersionId: versionId,
          medicationId: medication.id,
          plannedDoseQuantity: normalizePositiveQuantity(input.plannedDoseQuantity),
          quantityUnit: 'count' as const,
          sortOrder,
        });
      }
      const version: RegimenVersion = {
        id: versionId,
        regimenId,
        versionNumber: 1,
        name: command.name.trim(),
        localTime: command.localTime,
        timeZone: command.timeZone.trim(),
        onTimeOffsetMinutes: command.onTimeOffsetMinutes,
        recordOffsetMinutes: command.recordOffsetMinutes,
        captureMode: command.captureMode,
        effectiveLocalDate: command.startLocalDate,
        effectiveToLocalDate: null,
        supersededAtUtc: null,
        supersedesVersionId: null,
        items,
        createdAtUtc: command.issuedAtUtc,
      };
      const regimen: PersonalRegimen = {
        id: regimenId,
        status: 'active',
        statusEffectiveLocalDate: command.startLocalDate,
        currentVersionId: versionId,
        rowVersion: 1,
        createdAtUtc: command.issuedAtUtc,
        updatedAtUtc: command.issuedAtUtc,
      };
      await repository.insertRegimen(regimen, version);
      await repository.appendRegimenRevision({
        id: this.dependencies.ids.next(),
        regimenId,
        revisionType: 'created',
        previousVersionId: null,
        newVersionId: versionId,
        effectiveLocalDate: command.startLocalDate,
        replacedOccurrenceId: null,
        newOccurrenceId: null,
        recordedAtUtc: command.issuedAtUtc,
        commandId: command.commandId,
      });
      return regimen;
    });
  }

  materializeDate(command: MaterializeDateCommand): CommandResult<PersonalDoseOccurrence[]> {
    return this.executeIdempotent('MaterializeDate', command, async (repository) => {
      assertLocalDate(command.localDate);
      const regimens = await repository.listRegimensForDate(command.localDate);
      const occurrences: PersonalDoseOccurrence[] = [];
      for (const regimen of regimens) {
        const existing = await repository.findActiveOccurrence(regimen.id, command.localDate);
        if (existing) {
          occurrences.push(existing);
          continue;
        }
        const version = await repository.getEffectiveRegimenVersion(regimen.id, command.localDate);
        if (!version) continue;
        occurrences.push(
          await this.createOccurrence(repository, regimen, version, command.localDate, command),
        );
      }
      return occurrences.sort(
        (left, right) => Date.parse(left.scheduledAtUtc) - Date.parse(right.scheduledAtUtc),
      );
    });
  }

  updateRegimenPlan(command: UpdateRegimenPlanCommand): CommandResult<PlanChangeResult> {
    return this.executeIdempotent('UpdateRegimenPlan', command, async (repository) => {
      assertLocalDate(command.currentLocalDate);
      assertUtcInstant(command.currentAtUtc);
      const regimen = await this.requireRegimen(repository, command.regimenId);
      if (regimen.rowVersion !== command.expectedRowVersion) {
        throw new DomainRuleError('VERSION_CONFLICT', 'error.regimen_version_conflict');
      }
      const currentVersion = await this.requireRegimenVersion(repository, regimen.currentVersionId);
      if (
        command.changes.name == null &&
        command.changes.localTime == null &&
        (!command.changes.itemChanges || command.changes.itemChanges.length === 0)
      ) {
        throw new DomainRuleError('VALIDATION_FAILED', 'error.plan_change_empty');
      }

      const localTime = command.changes.localTime ?? currentVersion.localTime;
      assertLocalTime(localTime);
      const scheduleToday = this.resolveSchedule(currentVersion, command.currentLocalDate, localTime);
      const todayOccurrence = await repository.findActiveOccurrence(regimen.id, command.currentLocalDate);
      const canReplaceToday =
        Date.parse(scheduleToday.scheduledAtUtc) > Date.parse(command.currentAtUtc) &&
        (!todayOccurrence || todayOccurrence.currentLifecycle === 'scheduled');
      const effectiveLocalDate = canReplaceToday
        ? command.currentLocalDate
        : nextLocalDate(command.currentLocalDate);

      const versionId = this.dependencies.ids.next();
      const itemChangeMap = new Map(
        (command.changes.itemChanges ?? []).map((change) => [change.medicationId, change]),
      );
      for (const medicationId of itemChangeMap.keys()) {
        if (!currentVersion.items.some((item) => item.medicationId === medicationId)) {
          throw new DomainRuleError('NOT_FOUND', 'error.regimen_item_not_found');
        }
      }
      const newItems = [];
      for (const item of currentVersion.items) {
        const change = itemChangeMap.get(item.medicationId);
        if (change?.displayName != null) {
          await repository.updateMedicationName(
            item.medicationId,
            assertMedicationDisplayName(change.displayName),
            command.issuedAtUtc,
          );
        }
        newItems.push({
          ...item,
          id: this.dependencies.ids.next(),
          regimenVersionId: versionId,
          plannedDoseQuantity:
            change?.plannedDoseQuantity == null
              ? item.plannedDoseQuantity
              : normalizePositiveQuantity(change.plannedDoseQuantity),
        });
      }
      const nextVersion: RegimenVersion = {
        ...currentVersion,
        id: versionId,
        versionNumber: currentVersion.versionNumber + 1,
        name:
          command.changes.name == null
            ? currentVersion.name
            : this.assertRegimenName(command.changes.name),
        localTime,
        effectiveLocalDate,
        effectiveToLocalDate: null,
        supersededAtUtc: null,
        supersedesVersionId: currentVersion.id,
        items: newItems,
        createdAtUtc: command.issuedAtUtc,
      };
      const nextRegimen: PersonalRegimen = {
        ...regimen,
        currentVersionId: nextVersion.id,
        rowVersion: regimen.rowVersion + 1,
        updatedAtUtc: command.issuedAtUtc,
      };
      await repository.appendRegimenVersion(nextRegimen, nextVersion, command.expectedRowVersion);

      let replacedOccurrenceId: string | undefined;
      let newOccurrenceId: string | undefined;
      if (canReplaceToday) {
        const replacementId = this.dependencies.ids.next();
        if (todayOccurrence) {
          replacedOccurrenceId = todayOccurrence.id;
          await repository.replaceOccurrence(
            todayOccurrence.id,
            replacementId,
            command.commandId,
            command.issuedAtUtc,
          );
          await repository.cancelReminderIntent(todayOccurrence.id, command.issuedAtUtc);
        }
        const replacement = await this.createOccurrence(
          repository,
          nextRegimen,
          nextVersion,
          effectiveLocalDate,
          command,
          replacementId,
        );
        newOccurrenceId = replacement.id;
      } else {
        const futureOccurrences = await repository.listActiveOccurrencesForRegimenFromDate(
          regimen.id,
          effectiveLocalDate,
        );
        for (const occurrence of futureOccurrences) {
          await repository.replaceOccurrence(
            occurrence.id,
            null,
            command.commandId,
            command.issuedAtUtc,
          );
          await repository.cancelReminderIntent(occurrence.id, command.issuedAtUtc);
        }
      }

      await repository.appendRegimenRevision({
        id: this.dependencies.ids.next(),
        regimenId: regimen.id,
        revisionType: 'modified',
        previousVersionId: currentVersion.id,
        newVersionId: nextVersion.id,
        effectiveLocalDate,
        replacedOccurrenceId: replacedOccurrenceId ?? null,
        newOccurrenceId: newOccurrenceId ?? null,
        recordedAtUtc: command.issuedAtUtc,
        commandId: command.commandId,
      });
      return {
        effectiveLocalDate,
        effective: canReplaceToday ? 'today' : 'tomorrow',
        ...(replacedOccurrenceId ? { replacedOccurrenceId } : {}),
        ...(newOccurrenceId ? { newOccurrenceId } : {}),
        notificationRebuildRequired: true,
      };
    });
  }

  pauseRegimen(command: PauseRegimenCommand): CommandResult<PlanChangeResult> {
    return this.setRegimenActivation(command, 'paused');
  }

  resumeRegimen(command: ResumeRegimenCommand): CommandResult<PlanChangeResult> {
    return this.setRegimenActivation(command, 'active');
  }

  correctInventory(command: CorrectInventoryCommand): CommandResult<{
    medicationId: string;
    targetInventoryQuantity: string;
    adjustedBy: string;
  }> {
    return this.executeIdempotent('CorrectInventory', command, async (repository) => {
      const medication = await repository.getMedication(command.medicationId);
      if (!medication) throw new DomainRuleError('NOT_FOUND', 'error.medication_not_found');
      const target = normalizeNonNegativeQuantity(command.targetInventoryQuantity);
      const entries = await repository.listInventoryLedger(medication.id);
      const current = entries.reduce(
        (sum, entry) => sum + signedQuantityToMilliunits(entry.quantityDelta),
        0n,
      );
      const delta = quantityToMilliunits(target) - current;
      if (delta !== 0n) {
        await repository.insertInventoryEntry({
          id: this.dependencies.ids.next(),
          medicationId: medication.id,
          entryType: 'manual_adjustment',
          quantityDelta: signedQuantityFromMilliunits(delta),
          quantityUnit: 'count',
          sourceFactType: 'manual',
          sourceFactId: command.commandId,
          reversesEntryId: null,
          reasonCode: command.reasonCode.trim() || 'inventory_correction',
          effectiveAtUtc: command.issuedAtUtc,
          recordedAtUtc: command.issuedAtUtc,
          commandId: command.commandId,
        });
      }
      return {
        medicationId: medication.id,
        targetInventoryQuantity: target,
        adjustedBy: signedQuantityFromMilliunits(delta),
      };
    });
  }

  setInventoryForecastPreference(
    command: SetInventoryForecastPreferenceCommand,
  ): CommandResult<InventoryForecastPreference> {
    return this.executeIdempotent(
      'SetInventoryForecastPreference',
      command,
      async (repository) => {
        assertInventoryForecastLeadDays(command.leadDays);
        const medication = await repository.getMedication(command.medicationId);
        if (!medication) throw new DomainRuleError('NOT_FOUND', 'error.medication_not_found');
        const current = await repository.getInventoryForecastPreference(medication.id);
        if (!current) {
          throw new DomainRuleError('NOT_FOUND', 'error.inventory_forecast_preference_not_found');
        }
        if (current.rowVersion !== command.expectedRowVersion) {
          throw new DomainRuleError('VERSION_CONFLICT', 'error.inventory_forecast_version_conflict');
        }
        const next: InventoryForecastPreference = {
          ...current,
          leadDays: command.leadDays,
          updatedAtUtc: command.issuedAtUtc,
          rowVersion: current.rowVersion + 1,
        };
        await repository.updateInventoryForecastPreference(next, command.expectedRowVersion);
        if (next.leadDays == null) {
          await repository.cancelAuxiliaryReminderIntent(
            'refill',
            medication.id,
            command.issuedAtUtc,
          );
        }
        return next;
      },
    );
  }

  async getInventoryForecast(
    medicationId: string,
    currentLocalDate: string,
    currentAtUtc: string,
  ): Promise<Result<InventoryForecast>> {
    try {
      assertLocalDate(currentLocalDate);
      assertUtcInstant(currentAtUtc);
      const forecast = await this.dependencies.unitOfWork.run((repository) =>
        this.calculateInventoryForecast(
          repository,
          medicationId,
          currentLocalDate,
          currentAtUtc,
        ),
      );
      return ok(forecast);
    } catch (error) {
      return { ok: false, error: toDomainError(error) };
    }
  }

  createFollowUpItem(command: CreateFollowUpItemCommand): CommandResult<FollowUpItem> {
    return this.executeIdempotent('CreateFollowUpItem', command, async (repository) => {
      const item = await this.buildFollowUpItem(repository, command);
      const event = this.followUpEvent(item, 'created', null, command);
      await repository.insertFollowUpItem(item, event);
      await this.syncFollowUpReminderIntents(repository, item, command.issuedAtUtc);
      return item;
    });
  }

  editFollowUpItem(command: EditFollowUpItemCommand): CommandResult<FollowUpItem> {
    return this.executeIdempotent('EditFollowUpItem', command, async (repository) => {
      const current = await this.requirePendingFollowUpItem(repository, command.followUpItemId);
      if (current.rowVersion !== command.expectedRowVersion) {
        throw new DomainRuleError('VERSION_CONFLICT', 'error.follow_up_version_conflict');
      }
      if (Object.keys(command.changes).length === 0) {
        throw new DomainRuleError('VALIDATION_FAILED', 'error.follow_up_change_empty');
      }
      const next = await this.validateFollowUpItem(repository, {
        ...current,
        type: command.changes.type ?? current.type,
        title: command.changes.title ?? current.title,
        dueAtUtc: command.changes.dueAtUtc ?? current.dueAtUtc,
        timeZone: command.changes.timeZone ?? current.timeZone,
        medicationId:
          command.changes.medicationId === undefined
            ? current.medicationId
            : command.changes.medicationId,
        note: command.changes.note === undefined ? current.note : command.changes.note,
        advanceDays:
          command.changes.advanceDays === undefined
            ? current.advanceDays
            : command.changes.advanceDays,
        updatedAtUtc: command.issuedAtUtc,
        rowVersion: current.rowVersion + 1,
      });
      await repository.updateFollowUpItem(
        next,
        this.followUpEvent(next, 'edited', current.status, command),
        command.expectedRowVersion,
      );
      await this.syncFollowUpReminderIntents(repository, next, command.issuedAtUtc);
      return next;
    });
  }

  completeFollowUpItem(command: CompleteFollowUpItemCommand): CommandResult<FollowUpItem> {
    return this.closeFollowUpItem(command, 'completed');
  }

  cancelFollowUpItem(command: CancelFollowUpItemCommand): CommandResult<FollowUpItem> {
    return this.closeFollowUpItem(command, 'cancelled');
  }

  reconcileAuxiliaryReminders(
    command: ReconcileAuxiliaryRemindersCommand,
  ): CommandResult<AuxiliaryReminderIntent[]> {
    return this.executeIdempotent('ReconcileAuxiliaryReminders', command, async (repository) => {
      assertLocalDate(command.currentLocalDate);
      assertUtcInstant(command.currentAtUtc);
      const activeKeys = new Set<string>();
      const preferences = await repository.listInventoryForecastPreferences();
      for (const preference of preferences) {
        const forecast = await this.calculateInventoryForecast(
          repository,
          preference.medicationId,
          command.currentLocalDate,
          command.currentAtUtc,
        );
        if (
          forecast.leadDays == null ||
          forecast.effectiveTriggerAtUtc == null ||
          forecast.timeZone == null
        ) {
          await repository.cancelAuxiliaryReminderIntent(
            'refill',
            preference.medicationId,
            command.issuedAtUtc,
          );
          continue;
        }
        await this.upsertAuxiliaryReminder(
          repository,
          'refill',
          'medication',
          preference.medicationId,
          forecast.effectiveTriggerAtUtc,
          forecast.timeZone,
          command.issuedAtUtc,
        );
        activeKeys.add(`refill:${preference.medicationId}`);
      }

      const followUps = await repository.listPendingFollowUpItems();
      for (const item of followUps) {
        await this.syncFollowUpReminderIntents(repository, item, command.currentAtUtc);
        activeKeys.add(`follow_up_due:${item.id}`);
        if (item.advanceDays != null) activeKeys.add(`follow_up_advance:${item.id}`);
      }

      for (const intent of await repository.listActiveAuxiliaryReminderIntents()) {
        if (!activeKeys.has(`${intent.kind}:${intent.sourceId}`)) {
          await repository.cancelAuxiliaryReminderIntent(
            intent.kind,
            intent.sourceId,
            command.issuedAtUtc,
          );
        }
      }
      return repository.listActiveAuxiliaryReminderIntents();
    });
  }

  async getOpenFollowUpItemsDueBy(cutoffAtUtc: string): Promise<Result<FollowUpItem[]>> {
    try {
      assertUtcInstant(cutoffAtUtc);
      return ok(
        await this.dependencies.unitOfWork.run((repository) =>
          repository.listOpenFollowUpItemsDueBy(cutoffAtUtc),
        ),
      );
    } catch (error) {
      return { ok: false, error: toDomainError(error) };
    }
  }

  async getFollowUpItemHistory(
    followUpItemId: string,
  ): Promise<Result<FollowUpItemEvent[]>> {
    try {
      const item = await this.dependencies.unitOfWork.run((repository) =>
        repository.getFollowUpItem(followUpItemId),
      );
      if (!item) return err('NOT_FOUND', 'error.follow_up_not_found');
      return ok(
        await this.dependencies.unitOfWork.run((repository) =>
          repository.listFollowUpItemEvents(followUpItemId),
        ),
      );
    } catch (error) {
      return { ok: false, error: toDomainError(error) };
    }
  }

  prepareWithPhoto(command: PreparePersonalWithPhotoCommand): CommandResult<PersonalPhotoEvidence> {
    return this.executeIdempotent('PreparePersonalWithPhoto', command, async (repository) => {
      const occurrence = await this.requirePreparableOccurrence(
        repository,
        command.occurrenceId,
        command.issuedAtUtc,
        command.commandId,
        command.currentLocalDate,
      );
      assertUtcInstant(command.capturedAtUtc);
      if (!command.encryptedMediaId.trim()) {
        throw new DomainRuleError('VALIDATION_FAILED', 'error.encrypted_media_id_required');
      }
      const version = await this.requireRegimenVersion(repository, occurrence.regimenVersionId);
      const linkedOccurrenceItemIds = this.resolveEvidenceLinks(
        occurrence,
        version.captureMode,
        command.occurrenceItemIds,
      );
      const photo: PersonalPhotoEvidence = {
        id: this.dependencies.ids.next(),
        occurrenceId: occurrence.id,
        state: 'captured',
        deletionStatus: 'active',
        captureMode: version.captureMode,
        capturePurpose: 'initial',
        encryptedMediaId: command.encryptedMediaId.trim(),
        skipReasonCode: null,
        capturedAtUtc: command.capturedAtUtc,
        deletionRequestedAtUtc: null,
        deletedAtUtc: null,
        deletionReasonCode: null,
        linkedOccurrenceItemIds,
        createdAtUtc: command.issuedAtUtc,
      };
      await repository.insertPhotoEvidence(photo);
      await this.markPreparedWhenEvidenceComplete(repository, occurrence, command);
      return photo;
    });
  }

  prepareBySkipping(
    command: PreparePersonalBySkippingCommand,
  ): CommandResult<PersonalPhotoEvidence> {
    return this.executeIdempotent('PreparePersonalBySkipping', command, async (repository) => {
      const occurrence = await this.requirePreparableOccurrence(
        repository,
        command.occurrenceId,
        command.issuedAtUtc,
        command.commandId,
        command.currentLocalDate,
      );
      const version = await this.requireRegimenVersion(repository, occurrence.regimenVersionId);
      const linkedOccurrenceItemIds = this.resolveEvidenceLinks(
        occurrence,
        version.captureMode,
        command.occurrenceItemIds,
      );
      const photo: PersonalPhotoEvidence = {
        id: this.dependencies.ids.next(),
        occurrenceId: occurrence.id,
        state: 'skipped_with_reason',
        deletionStatus: 'active',
        captureMode: version.captureMode,
        capturePurpose: 'initial',
        encryptedMediaId: null,
        skipReasonCode: command.reasonCode,
        capturedAtUtc: null,
        deletionRequestedAtUtc: null,
        deletedAtUtc: null,
        deletionReasonCode: null,
        linkedOccurrenceItemIds,
        createdAtUtc: command.issuedAtUtc,
      };
      await repository.insertPhotoEvidence(photo);
      await this.markPreparedWhenEvidenceComplete(repository, occurrence, command);
      return photo;
    });
  }

  startOccurrenceEarly(
    command: StartOccurrenceEarlyCommand,
  ): CommandResult<PersonalDoseOccurrence> {
    return this.executeIdempotent('StartOccurrenceEarly', command, async (repository) => {
      const occurrence = await this.requireOccurrence(repository, command.occurrenceId);
      if (
        occurrence.planProjectionState !== 'active' ||
        occurrence.currentLifecycle !== 'scheduled' ||
        occurrence.localServiceDate !== command.currentLocalDate
      ) {
        throw new DomainRuleError(
          'ILLEGAL_STATE_TRANSITION',
          'error.occurrence_not_early_startable',
        );
      }
      if (Date.parse(command.issuedAtUtc) >= Date.parse(occurrence.scheduledAtUtc)) {
        throw new DomainRuleError('ILLEGAL_STATE_TRANSITION', 'error.occurrence_already_due');
      }
      await repository.updateOccurrenceLifecycle(
        occurrence.id,
        'due',
        command.commandId,
        command.issuedAtUtc,
        'user_confirmed_early_start',
      );
      return (await repository.getOccurrence(occurrence.id))!;
    });
  }

  appendRetakePhoto(
    command: AppendRetakePhotoCommand,
  ): CommandResult<PersonalPhotoEvidence> {
    return this.executeIdempotent('AppendRetakePhoto', command, async (repository) => {
      const occurrence = await this.requireOccurrence(repository, command.occurrenceId);
      if (
        occurrence.planProjectionState !== 'active' ||
        occurrence.currentLifecycle === 'revoked' ||
        occurrence.items.some((item) => item.assertion === 'pending')
      ) {
        throw new DomainRuleError('ILLEGAL_STATE_TRANSITION', 'error.occurrence_not_retakeable');
      }
      assertUtcInstant(command.capturedAtUtc);
      if (!command.encryptedMediaId.trim()) {
        throw new DomainRuleError('VALIDATION_FAILED', 'error.encrypted_media_id_required');
      }
      const version = await this.requireRegimenVersion(repository, occurrence.regimenVersionId);
      const photo: PersonalPhotoEvidence = {
        id: this.dependencies.ids.next(),
        occurrenceId: occurrence.id,
        state: 'captured',
        deletionStatus: 'active',
        captureMode: version.captureMode,
        capturePurpose: 'retake',
        encryptedMediaId: command.encryptedMediaId.trim(),
        skipReasonCode: null,
        capturedAtUtc: command.capturedAtUtc,
        deletionRequestedAtUtc: null,
        deletedAtUtc: null,
        deletionReasonCode: null,
        linkedOccurrenceItemIds: occurrence.items.map((item) => item.id),
        createdAtUtc: command.issuedAtUtc,
      };
      await repository.insertPhotoEvidence(photo);
      return photo;
    });
  }

  recordCountObservation(
    command: RecordPersonalCountObservationCommand,
  ): CommandResult<{ observationId: string }> {
    return this.executeIdempotent('RecordPersonalCountObservation', command, async (repository) => {
      const photo = await repository.getPhotoEvidence(command.photoEvidenceId);
      if (
        !photo ||
        photo.occurrenceId !== command.occurrenceId ||
        photo.state !== 'captured' ||
        photo.deletionStatus !== 'active'
      ) {
        throw new DomainRuleError('NOT_FOUND', 'error.captured_photo_not_found');
      }
      assertDetectedObjectCount(command.detectedObjectCount);
      if (
        (command.status === 'counted' && command.detectedObjectCount == null) ||
        (command.status === 'unable' && !command.unableReasonCode?.trim()) ||
        !command.algorithmVersion.trim()
      ) {
        throw new DomainRuleError('VALIDATION_FAILED', 'error.count_observation_invalid');
      }
      const observationId = this.dependencies.ids.next();
      await repository.insertCountObservation({
        id: observationId,
        photoEvidenceId: photo.id,
        status: command.status,
        detectedObjectCount: command.status === 'counted' ? command.detectedObjectCount : null,
        unableReasonCode:
          command.status === 'unable' ? command.unableReasonCode!.trim() : null,
        source: command.source,
        algorithmVersion: command.algorithmVersion.trim(),
        recordedAtUtc: command.issuedAtUtc,
      });
      return { observationId };
    });
  }

  confirmOccurrenceItems(
    command: ConfirmPersonalOccurrenceItemsCommand,
  ): CommandResult<PersonalDoseOccurrence> {
    return this.executeIdempotent('ConfirmPersonalOccurrenceItems', command, async (repository) => {
      const occurrence = await this.requireOccurrence(repository, command.occurrenceId);
      if (!['prepared', 'missed'].includes(occurrence.currentLifecycle)) {
        throw new DomainRuleError('EVIDENCE_REQUIRED', 'error.occurrence_not_prepared');
      }
      if (
        command.items.length === 0 ||
        new Set(command.items.map((item) => item.occurrenceItemId)).size !== command.items.length
      ) {
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
        const confirmedConsumptionQuantity = validateAssertionQuantity(
          input.assertion,
          input.confirmedConsumptionQuantity,
          item.plannedDoseQuantity,
        );
        const fact: PersonalConsumptionAssertionFact = {
          id: this.dependencies.ids.next(),
          occurrenceItemId: item.id,
          assertion: input.assertion,
          confirmedConsumptionQuantity,
          assertedConsumedAtUtc: isPositiveQuantity(confirmedConsumptionQuantity)
            ? command.confirmedAtUtc
            : null,
          recordedAtUtc: command.issuedAtUtc,
          source,
          supersedesFactId: null,
          revisionGroupId: null,
          commandId: command.commandId,
        };
        await repository.insertAssertionFact(fact);
        await repository.setItemCurrentFromFact(fact);
        if (isPositiveQuantity(confirmedConsumptionQuantity)) {
          await repository.insertInventoryEntry(
            this.consumptionEntry(command, item.medicationId, fact),
          );
        }
        if (source === 'missed_backfill') {
          await repository.resolveMissedEvent(item.id, fact.id, command.issuedAtUtc);
        }
      }
      return this.recalculateLifecycle(
        repository,
        occurrence.id,
        command.confirmedAtUtc,
        command.commandId,
      );
    });
  }

  reviseItemConfirmation(
    command: RevisePersonalItemConfirmationCommand,
  ): CommandResult<PersonalDoseOccurrence> {
    return this.executeIdempotent('RevisePersonalItemConfirmation', command, async (repository) => {
      const oldFact = await repository.getAssertionFact(command.factId);
      if (!oldFact) throw new DomainRuleError('NOT_FOUND', 'error.assertion_fact_not_found');
      if (await repository.isAssertionFactRevoked(oldFact.id)) {
        throw new DomainRuleError('ALREADY_REVOKED', 'error.assertion_fact_already_revoked');
      }
      const occurrence = await repository.getOccurrenceByItemId(oldFact.occurrenceItemId);
      if (!occurrence) throw new DomainRuleError('NOT_FOUND', 'error.occurrence_not_found');
      const item = occurrence.items.find((candidate) => candidate.id === oldFact.occurrenceItemId);
      if (!item || item.activeFactId !== oldFact.id) {
        throw new DomainRuleError('ILLEGAL_STATE_TRANSITION', 'error.assertion_fact_not_current');
      }
      assertUtcInstant(command.confirmedAtUtc);
      const confirmedConsumptionQuantity = validateAssertionQuantity(
        command.assertion,
        command.confirmedConsumptionQuantity,
        item.plannedDoseQuantity,
      );
      const revisionGroupId = this.dependencies.ids.next();
      await repository.insertFactRevocation({
        id: this.dependencies.ids.next(),
        factId: oldFact.id,
        reasonCode: command.reasonCode.trim() || 'confirmation_revised',
        revisionGroupId,
        recordedAtUtc: command.issuedAtUtc,
        commandId: command.commandId,
      });
      await this.reverseConsumptionIfPresent(repository, oldFact, command, 'confirmation_revised');
      const newFact: PersonalConsumptionAssertionFact = {
        id: this.dependencies.ids.next(),
        occurrenceItemId: item.id,
        assertion: command.assertion,
        confirmedConsumptionQuantity,
        assertedConsumedAtUtc: isPositiveQuantity(confirmedConsumptionQuantity)
          ? command.confirmedAtUtc
          : null,
        recordedAtUtc: command.issuedAtUtc,
        source: 'correction',
        supersedesFactId: oldFact.id,
        revisionGroupId,
        commandId: command.commandId,
      };
      await repository.insertAssertionFact(newFact);
      await repository.setItemCurrentFromFact(newFact);
      if (isPositiveQuantity(confirmedConsumptionQuantity)) {
        await repository.insertInventoryEntry(
          this.consumptionEntry(command, item.medicationId, newFact),
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

  revokeItemConfirmation(
    command: RevokePersonalItemConfirmationCommand,
  ): CommandResult<PersonalDoseOccurrence> {
    return this.executeIdempotent('RevokePersonalItemConfirmation', command, async (repository) => {
      const fact = await repository.getAssertionFact(command.factId);
      if (!fact) throw new DomainRuleError('NOT_FOUND', 'error.assertion_fact_not_found');
      const occurrence = await repository.getOccurrenceByItemId(fact.occurrenceItemId);
      if (!occurrence) throw new DomainRuleError('NOT_FOUND', 'error.occurrence_not_found');
      if (await repository.isAssertionFactRevoked(fact.id)) return occurrence;
      const item = occurrence.items.find((candidate) => candidate.id === fact.occurrenceItemId);
      if (!item || item.activeFactId !== fact.id) {
        throw new DomainRuleError('ILLEGAL_STATE_TRANSITION', 'error.assertion_fact_not_current');
      }
      await repository.insertFactRevocation({
        id: this.dependencies.ids.next(),
        factId: fact.id,
        reasonCode: command.reasonCode.trim() || 'confirmation_revoked',
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

  revokeOccurrence(
    command: RevokePersonalOccurrenceCommand,
  ): CommandResult<PersonalDoseOccurrence> {
    return this.executeIdempotent('RevokePersonalOccurrence', command, async (repository) => {
      const occurrence = await this.requireOccurrence(repository, command.occurrenceId);
      if (
        occurrence.currentLifecycle === 'revoked' &&
        occurrence.items.every((item) => !item.activeFactId)
      ) {
        return occurrence;
      }
      for (const item of occurrence.items) {
        if (!item.activeFactId) continue;
        const fact = await repository.getAssertionFact(item.activeFactId);
        if (!fact) {
          throw new DomainRuleError('LEDGER_INVARIANT_VIOLATION', 'error.active_fact_not_found');
        }
        if (!(await repository.isAssertionFactRevoked(fact.id))) {
          await repository.insertFactRevocation({
            id: this.dependencies.ids.next(),
            factId: fact.id,
            reasonCode: command.reasonCode.trim() || 'occurrence_revoked',
            revisionGroupId: null,
            recordedAtUtc: command.issuedAtUtc,
            commandId: command.commandId,
          });
          await this.reverseConsumptionIfPresent(repository, fact, command, 'occurrence_revoked');
        }
        await repository.resetItemCurrent(item.id);
      }
      await repository.updateOccurrenceLifecycle(
        occurrence.id,
        'revoked',
        command.commandId,
        command.issuedAtUtc,
        command.reasonCode.trim() || 'occurrence_revoked',
      );
      return (await repository.getOccurrence(occurrence.id))!;
    });
  }

  async getToday(localDate: string): Promise<Result<PersonalDoseOccurrence[]>> {
    try {
      assertLocalDate(localDate);
      const occurrences = await this.dependencies.unitOfWork.run((repository) =>
        repository.listAllOccurrencesForDate(localDate),
      );
      return ok(
        occurrences.sort(
          (left, right) => Date.parse(left.scheduledAtUtc) - Date.parse(right.scheduledAtUtc),
        ),
      );
    } catch (error) {
      return { ok: false, error: toDomainError(error) };
    }
  }

  async getHistory(occurrenceId: string): Promise<Result<PersonalHistoryEntry>> {
    try {
      const history = await this.dependencies.unitOfWork.run((repository) =>
        repository.getHistory(occurrenceId),
      );
      if (!history) {
        return err('NOT_FOUND', 'error.occurrence_not_found');
      }
      return ok(history);
    } catch (error) {
      return { ok: false, error: toDomainError(error) };
    }
  }

  async getInventoryBalance(medicationId: string): Promise<Result<string>> {
    try {
      const ledger = await this.dependencies.unitOfWork.run((repository) =>
        repository.listInventoryLedger(medicationId),
      );
      return ok(
        signedQuantityFromMilliunits(
          ledger.reduce(
            (total, entry) => total + signedQuantityToMilliunits(entry.quantityDelta),
            0n,
          ),
        ),
      );
    } catch (error) {
      return { ok: false, error: toDomainError(error) };
    }
  }

  reconcileOccurrenceTimes(
    command: ReconcileOccurrenceTimesCommand,
  ): CommandResult<PersonalDoseOccurrence[]> {
    return this.executeIdempotent('ReconcileOccurrenceTimes', command, async (repository) => {
      assertLocalDate(command.localDate);
      assertUtcInstant(command.currentAtUtc);
      const occurrences = await repository.listActiveOccurrencesForDate(command.localDate);
      const changedIds = new Set<string>();
      for (const original of occurrences) {
        let occurrence = original;
        if (
          occurrence.currentLifecycle === 'scheduled' &&
          Date.parse(command.currentAtUtc) >= Date.parse(occurrence.scheduledAtUtc)
        ) {
          await repository.updateOccurrenceLifecycle(
            occurrence.id,
            'due',
            command.commandId,
            command.currentAtUtc,
            'time_reconciliation_due',
          );
          changedIds.add(occurrence.id);
          occurrence = (await repository.getOccurrence(occurrence.id))!;
        }
        if (
          ['scheduled', 'due', 'prepared'].includes(occurrence.currentLifecycle) &&
          Date.parse(command.currentAtUtc) >= Date.parse(occurrence.recordUntilAtUtc)
        ) {
          const pendingIds = occurrence.items
            .filter((item) => item.assertion === 'pending')
            .map((item) => item.id);
          if (pendingIds.length > 0) {
            await repository.addMissedEvents(
              occurrence.id,
              pendingIds,
              occurrence.recordUntilAtUtc,
              command.currentAtUtc,
            );
            await repository.updateOccurrenceLifecycle(
              occurrence.id,
              'missed',
              command.commandId,
              command.currentAtUtc,
              'time_reconciliation_missed',
            );
            changedIds.add(occurrence.id);
          }
        }
      }
      const changed = await Promise.all(
        [...changedIds].map(async (id) => (await repository.getOccurrence(id))!),
      );
      return changed.sort(
        (left, right) => Date.parse(left.scheduledAtUtc) - Date.parse(right.scheduledAtUtc),
      );
    });
  }

  requestPhotoDeletion(
    command: RequestPhotoDeletionCommand,
  ): CommandResult<PersonalPhotoEvidence> {
    return this.executeIdempotent('RequestPhotoDeletion', command, async (repository) => {
      const photo = await repository.getPhotoEvidence(command.photoEvidenceId);
      if (!photo) throw new DomainRuleError('NOT_FOUND', 'error.photo_not_found');
      if (photo.state === 'deleted_tombstone' || photo.deletionStatus === 'pending') return photo;
      if (photo.state !== 'captured') {
        throw new DomainRuleError('ILLEGAL_STATE_TRANSITION', 'error.photo_not_deletable');
      }
      await repository.markPhotoDeletionPending(
        photo.id,
        command.issuedAtUtc,
        command.reasonCode.trim() || 'user_requested',
      );
      return (await repository.getPhotoEvidence(photo.id))!;
    });
  }

  finalizePhotoTombstone(
    command: FinalizePhotoTombstoneCommand,
  ): CommandResult<PersonalPhotoEvidence> {
    return this.executeIdempotent('FinalizePhotoTombstone', command, async (repository) => {
      if (!command.mediaDeletionVerified) {
        throw new DomainRuleError('VALIDATION_FAILED', 'error.media_deletion_not_verified');
      }
      const photo = await repository.getPhotoEvidence(command.photoEvidenceId);
      if (!photo) throw new DomainRuleError('NOT_FOUND', 'error.photo_not_found');
      if (photo.state === 'deleted_tombstone') return photo;
      if (photo.deletionStatus !== 'pending') {
        throw new DomainRuleError('ILLEGAL_STATE_TRANSITION', 'error.photo_deletion_not_pending');
      }
      await repository.finalizePhotoTombstone(photo.id, command.issuedAtUtc);
      return (await repository.getPhotoEvidence(photo.id))!;
    });
  }

  private async calculateInventoryForecast(
    repository: MedicationRepository,
    medicationId: string,
    currentLocalDate: string,
    currentAtUtc: string,
  ): Promise<InventoryForecast> {
    const medication = await repository.getMedication(medicationId);
    if (!medication) throw new DomainRuleError('NOT_FOUND', 'error.medication_not_found');
    const preference = await repository.getInventoryForecastPreference(medicationId);
    const leadDays = preference ? preference.leadDays : 7;
    const ledger = await repository.listInventoryLedger(medicationId);
    const balanceMilliunits = ledger.reduce(
      (sum, entry) => sum + signedQuantityToMilliunits(entry.quantityDelta),
      0n,
    );
    const balanceQuantity = signedQuantityFromMilliunits(balanceMilliunits);
    const unavailable = (
      reason: InventoryForecast['unavailableReason'],
    ): InventoryForecast => ({
      medicationId,
      balanceQuantity,
      dailyDoseQuantity: null,
      fullDoses: null,
      nextPlannedLocalDate: null,
      estimatedShortageLocalDate: null,
      timeZone: null,
      leadDays,
      nominalTriggerAtUtc: null,
      effectiveTriggerAtUtc: null,
      unavailableReason: reason,
    });
    if (medication.status !== 'active') return unavailable('medication_inactive');
    const plans = await repository.listActiveDailyPlansForMedication(
      medicationId,
      currentLocalDate,
    );
    if (plans.length === 0) return unavailable('no_active_daily_plan');
    const timeZones = [...new Set(plans.map((plan) => plan.timeZone))];
    if (timeZones.length !== 1) return unavailable('multiple_time_zones');
    const timeZone = timeZones[0]!;
    const dailyDoseMilliunits = plans.reduce(
      (sum, plan) => sum + quantityToMilliunits(plan.plannedDoseQuantity),
      0n,
    );
    if (dailyDoseMilliunits <= 0n) {
      throw new DomainRuleError('LEDGER_INVARIANT_VIOLATION', 'error.daily_dose_invalid');
    }
    const nextDates = plans.map((plan) => {
      const todaySchedule = this.resolveAuxiliaryLocalTime(
        currentLocalDate,
        plan.localTime,
        plan.timeZone,
      );
      return Date.parse(todaySchedule) > Date.parse(currentAtUtc)
        ? currentLocalDate
        : addLocalDays(currentLocalDate, 1);
    });
    const nextPlannedLocalDate = nextDates.sort()[0]!;
    const nonNegativeBalance = balanceMilliunits > 0n ? balanceMilliunits : 0n;
    const fullDosesBigInt = nonNegativeBalance / dailyDoseMilliunits;
    if (fullDosesBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new DomainRuleError('LEDGER_INVARIANT_VIOLATION', 'error.forecast_range_invalid');
    }
    const fullDoses = Number(fullDosesBigInt);
    const estimatedShortageLocalDate = addLocalDays(nextPlannedLocalDate, fullDoses);
    const dailyDoseQuantity = quantityFromMilliunits(dailyDoseMilliunits);
    const nominalTriggerAtUtc = leadDays == null
      ? null
      : this.resolveAuxiliaryLocalTime(
          addLocalDays(estimatedShortageLocalDate, -leadDays),
          '09:00',
          timeZone,
        );
    const effectiveTriggerAtUtc = nominalTriggerAtUtc == null
      ? null
      : Date.parse(nominalTriggerAtUtc) <= Date.parse(currentAtUtc)
        ? currentAtUtc
        : nominalTriggerAtUtc;
    return {
      medicationId,
      balanceQuantity,
      dailyDoseQuantity,
      fullDoses,
      nextPlannedLocalDate,
      estimatedShortageLocalDate,
      timeZone,
      leadDays,
      nominalTriggerAtUtc,
      effectiveTriggerAtUtc,
      unavailableReason: null,
    };
  }

  private async buildFollowUpItem(
    repository: MedicationRepository,
    command: CreateFollowUpItemCommand,
  ): Promise<FollowUpItem> {
    return this.validateFollowUpItem(repository, {
      id: this.dependencies.ids.next(),
      type: command.type,
      title: command.title,
      dueAtUtc: command.dueAtUtc,
      timeZone: command.timeZone,
      medicationId: command.medicationId ?? null,
      note: command.note ?? '',
      advanceDays: command.advanceDays,
      status: 'pending',
      completedAtUtc: null,
      cancelledAtUtc: null,
      createdAtUtc: command.issuedAtUtc,
      updatedAtUtc: command.issuedAtUtc,
      rowVersion: 1,
    });
  }

  private async validateFollowUpItem(
    repository: MedicationRepository,
    item: FollowUpItem,
  ): Promise<FollowUpItem> {
    assertFollowUpType(item.type);
    assertUtcInstant(item.dueAtUtc);
    assertFollowUpAdvanceDays(item.advanceDays);
    const title = assertFollowUpTitle(item.title);
    const note = assertFollowUpNote(item.note);
    const timeZone = assertIanaTimeZone(item.timeZone);
    if (item.medicationId != null && !(await repository.getMedication(item.medicationId))) {
      throw new DomainRuleError('NOT_FOUND', 'error.medication_not_found');
    }
    return { ...item, title, note, timeZone };
  }

  private followUpEvent(
    item: FollowUpItem,
    eventType: FollowUpItemEvent['eventType'],
    previousStatus: FollowUpItemEvent['previousStatus'],
    command: PersonalWriteCommand,
  ): FollowUpItemEvent {
    return {
      id: this.dependencies.ids.next(),
      followUpItemId: item.id,
      eventType,
      previousStatus,
      newStatus: item.status,
      snapshotJson: JSON.stringify(item),
      recordedAtUtc: command.issuedAtUtc,
      commandId: command.commandId,
    };
  }

  private async requirePendingFollowUpItem(
    repository: MedicationRepository,
    id: string,
  ): Promise<FollowUpItem> {
    const item = await repository.getFollowUpItem(id);
    if (!item) throw new DomainRuleError('NOT_FOUND', 'error.follow_up_not_found');
    if (item.status !== 'pending') {
      throw new DomainRuleError('ILLEGAL_STATE_TRANSITION', 'error.follow_up_not_pending');
    }
    return item;
  }

  private closeFollowUpItem(
    command: CompleteFollowUpItemCommand | CancelFollowUpItemCommand,
    status: 'completed' | 'cancelled',
  ): CommandResult<FollowUpItem> {
    const commandType = status === 'completed' ? 'CompleteFollowUpItem' : 'CancelFollowUpItem';
    return this.executeIdempotent(commandType, command, async (repository) => {
      const current = await this.requirePendingFollowUpItem(repository, command.followUpItemId);
      if (current.rowVersion !== command.expectedRowVersion) {
        throw new DomainRuleError('VERSION_CONFLICT', 'error.follow_up_version_conflict');
      }
      const next: FollowUpItem = {
        ...current,
        status,
        completedAtUtc: status === 'completed' ? command.issuedAtUtc : null,
        cancelledAtUtc: status === 'cancelled' ? command.issuedAtUtc : null,
        updatedAtUtc: command.issuedAtUtc,
        rowVersion: current.rowVersion + 1,
      };
      await repository.updateFollowUpItem(
        next,
        this.followUpEvent(next, status, current.status, command),
        command.expectedRowVersion,
      );
      await repository.cancelAuxiliaryReminderIntent(
        'follow_up_advance',
        current.id,
        command.issuedAtUtc,
      );
      await repository.cancelAuxiliaryReminderIntent(
        'follow_up_due',
        current.id,
        command.issuedAtUtc,
      );
      return next;
    });
  }

  private async syncFollowUpReminderIntents(
    repository: MedicationRepository,
    item: FollowUpItem,
    currentAtUtc: string,
  ): Promise<void> {
    if (item.status !== 'pending') return;
    const dueTrigger =
      Date.parse(item.dueAtUtc) <= Date.parse(currentAtUtc) ? currentAtUtc : item.dueAtUtc;
    await this.upsertAuxiliaryReminder(
      repository,
      'follow_up_due',
      'follow_up_item',
      item.id,
      dueTrigger,
      item.timeZone,
      currentAtUtc,
    );
    if (item.advanceDays == null) {
      await repository.cancelAuxiliaryReminderIntent(
        'follow_up_advance',
        item.id,
        currentAtUtc,
      );
      return;
    }
    const dueLocalDate = this.localDateForInstant(item.dueAtUtc, item.timeZone);
    const nominalAdvance = this.resolveAuxiliaryLocalTime(
      addLocalDays(dueLocalDate, -item.advanceDays),
      '09:00',
      item.timeZone,
    );
    await this.upsertAuxiliaryReminder(
      repository,
      'follow_up_advance',
      'follow_up_item',
      item.id,
      Date.parse(nominalAdvance) <= Date.parse(currentAtUtc) ? currentAtUtc : nominalAdvance,
      item.timeZone,
      currentAtUtc,
    );
  }

  private async upsertAuxiliaryReminder(
    repository: MedicationRepository,
    kind: AuxiliaryReminderKind,
    sourceType: AuxiliaryReminderSourceType,
    sourceId: string,
    triggerAtUtc: string,
    timeZone: string,
    updatedAtUtc: string,
  ): Promise<AuxiliaryReminderIntent> {
    const existing = await repository.getAuxiliaryReminderIntent(kind, sourceId);
    const bothAlreadyDue =
      existing?.status === 'active' &&
      Date.parse(existing.triggerAtUtc) <= Date.parse(updatedAtUtc) &&
      Date.parse(triggerAtUtc) <= Date.parse(updatedAtUtc);
    if (
      existing?.status === 'active' &&
      (existing.triggerAtUtc === triggerAtUtc || bothAlreadyDue) &&
      existing.timeZone === timeZone
    ) {
      const projection = await repository.getAuxiliaryReminderProjection(existing.id);
      if (!projection) {
        await repository.saveAuxiliaryReminderProjection({
          reminderIntentId: existing.id,
          systemNotificationId: null,
          status: 'pending_rebuild',
          failureCode: null,
          lastReconciledAtUtc: null,
          rowVersion: 1,
        });
      }
      return existing;
    }
    const intent: AuxiliaryReminderIntent = {
      id: existing?.id ?? this.dependencies.ids.next(),
      kind,
      sourceType,
      sourceId,
      triggerAtUtc,
      timeZone,
      status: 'active',
      projectionVersion: existing ? existing.projectionVersion + 1 : 1,
      createdAtUtc: existing?.createdAtUtc ?? updatedAtUtc,
      updatedAtUtc,
    };
    await repository.upsertAuxiliaryReminderIntent(intent);
    const previousProjection = existing
      ? await repository.getAuxiliaryReminderProjection(existing.id)
      : null;
    await repository.saveAuxiliaryReminderProjection({
      reminderIntentId: intent.id,
      systemNotificationId: previousProjection?.systemNotificationId ?? null,
      status: 'pending_rebuild',
      failureCode: null,
      lastReconciledAtUtc: null,
      rowVersion: 1,
    });
    return intent;
  }

  private resolveAuxiliaryLocalTime(
    localDate: string,
    localTime: string,
    timeZone: string,
  ): string {
    const schedule = this.dependencies.scheduleResolver.resolveDailySchedule({
      localDate,
      localTime,
      timeZone,
      onTimeOffsetMinutes: 1,
      recordOffsetMinutes: 2,
    });
    assertUtcInstant(schedule.scheduledAtUtc);
    return schedule.scheduledAtUtc;
  }

  private localDateForInstant(utcInstant: string, timeZone: string): string {
    assertUtcInstant(utcInstant);
    assertIanaTimeZone(timeZone);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(utcInstant));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const localDate = `${values.year}-${values.month}-${values.day}`;
    assertLocalDate(localDate);
    return localDate;
  }

  private async requireOccurrence(
    repository: MedicationRepository,
    id: string,
  ): Promise<PersonalDoseOccurrence> {
    const occurrence = await repository.getOccurrence(id);
    if (!occurrence) throw new DomainRuleError('NOT_FOUND', 'error.occurrence_not_found');
    return occurrence;
  }

  private async requirePreparableOccurrence(
    repository: MedicationRepository,
    id: string,
    effectiveAtUtc: string,
    commandId: string,
    currentLocalDate: string,
  ): Promise<PersonalDoseOccurrence> {
    let occurrence = await this.requireOccurrence(repository, id);
    if (occurrence.planProjectionState !== 'active') {
      throw new DomainRuleError('ILLEGAL_STATE_TRANSITION', 'error.occurrence_replaced');
    }
    if (occurrence.localServiceDate !== currentLocalDate) {
      throw new DomainRuleError('ILLEGAL_STATE_TRANSITION', 'error.occurrence_not_today');
    }
    if (occurrence.currentLifecycle === 'scheduled') {
      if (Date.parse(effectiveAtUtc) < Date.parse(occurrence.scheduledAtUtc)) {
        throw new DomainRuleError('ILLEGAL_STATE_TRANSITION', 'error.occurrence_not_due_yet');
      }
      await repository.updateOccurrenceLifecycle(
        occurrence.id,
        'due',
        commandId,
        effectiveAtUtc,
        'preparation_started_after_schedule',
      );
      occurrence = (await repository.getOccurrence(occurrence.id))!;
    }
    if (
      !['due', 'prepared', 'missed'].includes(occurrence.currentLifecycle) ||
      (occurrence.currentLifecycle === 'missed' &&
        occurrence.items.every((item) => item.assertion !== 'pending'))
    ) {
      throw new DomainRuleError('ILLEGAL_STATE_TRANSITION', 'error.occurrence_not_preparable');
    }
    return occurrence;
  }

  private resolveEvidenceLinks(
    occurrence: PersonalDoseOccurrence,
    captureMode: RegimenVersion['captureMode'],
    requestedIds: string[] | undefined,
  ): string[] {
    const validIds = new Set(occurrence.items.map((item) => item.id));
    const links = captureMode === 'group' ? [...validIds] : [...new Set(requestedIds ?? [])];
    if (
      links.length === 0 ||
      links.some((id) => !validIds.has(id)) ||
      (captureMode === 'per_item' && links.length !== 1)
    ) {
      throw new DomainRuleError('VALIDATION_FAILED', 'error.photo_item_links_invalid');
    }
    return links;
  }

  private async markPreparedWhenEvidenceComplete(
    repository: MedicationRepository,
    occurrence: PersonalDoseOccurrence,
    command: PersonalWriteCommand,
  ): Promise<void> {
    const evidence = await repository.listPhotoEvidence(occurrence.id);
    const covered = new Set(evidence.flatMap((photo) => photo.linkedOccurrenceItemIds));
    if (
      occurrence.currentLifecycle === 'due' &&
      occurrence.items.every((item) => covered.has(item.id))
    ) {
      await repository.updateOccurrenceLifecycle(
        occurrence.id,
        'prepared',
        command.commandId,
        command.issuedAtUtc,
        'evidence_coverage_complete',
      );
    }
  }

  private consumptionEntry(
    command: PersonalWriteCommand,
    medicationId: string,
    fact: PersonalConsumptionAssertionFact,
  ): PersonalInventoryLedgerEntry {
    return {
      id: this.dependencies.ids.next(),
      medicationId,
      entryType: 'consumption',
      quantityDelta: negateQuantity(fact.confirmedConsumptionQuantity),
      quantityUnit: 'count',
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
    repository: MedicationRepository,
    fact: PersonalConsumptionAssertionFact,
    command: PersonalWriteCommand,
    reasonCode = 'confirmation_revoked',
  ): Promise<void> {
    const original = await repository.findConsumptionEntry(fact.id);
    if (!original || (await repository.findReversalEntry(original.id))) return;
    await repository.insertInventoryEntry({
      id: this.dependencies.ids.next(),
      medicationId: original.medicationId,
      entryType: 'reversal',
      quantityDelta: signedQuantityFromMilliunits(
        -signedQuantityToMilliunits(original.quantityDelta),
      ),
      quantityUnit: 'count',
      sourceFactType: 'inventory_ledger',
      sourceFactId: original.id,
      reversesEntryId: original.id,
      reasonCode,
      effectiveAtUtc: command.issuedAtUtc,
      recordedAtUtc: command.issuedAtUtc,
      commandId: command.commandId,
    });
  }

  private async recalculateLifecycle(
    repository: MedicationRepository,
    occurrenceId: string,
    effectiveAtUtc: string,
    commandId: string,
  ): Promise<PersonalDoseOccurrence> {
    const current = await this.requireOccurrence(repository, occurrenceId);
    if (current.currentLifecycle === 'revoked') return current;
    if (
      current.currentLifecycle === 'missed' &&
      current.items.some((item) => item.assertion === 'pending')
    ) {
      return current;
    }
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

  private async setRegimenActivation(
    command: PauseRegimenCommand | ResumeRegimenCommand,
    status: PersonalRegimen['status'],
  ): CommandResult<PlanChangeResult> {
    const commandType = status === 'paused' ? 'PauseRegimen' : 'ResumeRegimen';
    return this.executeIdempotent(commandType, command, async (repository) => {
      assertLocalDate(command.currentLocalDate);
      assertUtcInstant(command.currentAtUtc);
      const regimen = await this.requireRegimen(repository, command.regimenId);
      if (regimen.rowVersion !== command.expectedRowVersion) {
        throw new DomainRuleError('VERSION_CONFLICT', 'error.regimen_version_conflict');
      }
      if (regimen.status === status && regimen.statusEffectiveLocalDate <= command.currentLocalDate) {
        return {
          effectiveLocalDate: command.currentLocalDate,
          effective: 'today',
          notificationRebuildRequired: false,
        };
      }
      const version =
        (await repository.getEffectiveRegimenVersion(regimen.id, command.currentLocalDate)) ??
        (await this.requireRegimenVersion(repository, regimen.currentVersionId));
      const scheduleToday = this.resolveSchedule(version, command.currentLocalDate);
      const todayOccurrence = await repository.findActiveOccurrence(regimen.id, command.currentLocalDate);
      const todayStillFuture = Date.parse(scheduleToday.scheduledAtUtc) > Date.parse(command.currentAtUtc);
      const todayHasNotStarted =
        !todayOccurrence ||
        (todayOccurrence.currentLifecycle === 'scheduled' &&
          Date.parse(todayOccurrence.scheduledAtUtc) > Date.parse(command.currentAtUtc));
      const effectiveToday = todayStillFuture && todayHasNotStarted;
      const effectiveLocalDate = effectiveToday
        ? command.currentLocalDate
        : nextLocalDate(command.currentLocalDate);

      await repository.setRegimenStatus({
        regimenId: regimen.id,
        status,
        effectiveLocalDate,
        expectedRowVersion: command.expectedRowVersion,
        updatedAtUtc: command.issuedAtUtc,
      });

      let replacedOccurrenceId: string | undefined;
      let newOccurrenceId: string | undefined;
      if (status === 'paused') {
        const affected = await repository.listActiveOccurrencesForRegimenFromDate(
          regimen.id,
          effectiveLocalDate,
        );
        for (const occurrence of affected) {
          if (
            occurrence.localServiceDate === command.currentLocalDate &&
            occurrence.currentLifecycle !== 'scheduled'
          ) {
            continue;
          }
          await repository.replaceOccurrence(
            occurrence.id,
            null,
            command.commandId,
            command.issuedAtUtc,
          );
          await repository.cancelReminderIntent(occurrence.id, command.issuedAtUtc);
          replacedOccurrenceId ??= occurrence.id;
        }
      } else if (effectiveToday && !todayOccurrence) {
        const refreshed = (await repository.getRegimen(regimen.id))!;
        const occurrence = await this.createOccurrence(
          repository,
          refreshed,
          version,
          command.currentLocalDate,
          command,
        );
        newOccurrenceId = occurrence.id;
      }

      await repository.appendRegimenRevision({
        id: this.dependencies.ids.next(),
        regimenId: regimen.id,
        revisionType: status === 'paused' ? 'paused' : 'resumed',
        previousVersionId: version.id,
        newVersionId: version.id,
        effectiveLocalDate,
        replacedOccurrenceId: replacedOccurrenceId ?? null,
        newOccurrenceId: newOccurrenceId ?? null,
        recordedAtUtc: command.issuedAtUtc,
        commandId: command.commandId,
      });
      return {
        effectiveLocalDate,
        effective: effectiveToday ? 'today' : 'tomorrow',
        ...(replacedOccurrenceId ? { replacedOccurrenceId } : {}),
        ...(newOccurrenceId ? { newOccurrenceId } : {}),
        notificationRebuildRequired: true,
      };
    });
  }

  private async createOccurrence(
    repository: MedicationRepository,
    regimen: PersonalRegimen,
    version: RegimenVersion,
    localDate: string,
    command: PersonalWriteCommand,
    occurrenceId = this.dependencies.ids.next(),
  ): Promise<PersonalDoseOccurrence> {
    const schedule = this.resolveSchedule(version, localDate);
    const items = [];
    for (const versionItem of version.items) {
      const medication = await repository.getMedication(versionItem.medicationId);
      if (!medication) throw new DomainRuleError('NOT_FOUND', 'error.medication_not_found');
      items.push({
        id: this.dependencies.ids.next(),
        occurrenceId,
        regimenVersionItemId: versionItem.id,
        medicationId: medication.id,
        medicationDisplayName: medication.displayName,
        plannedDoseQuantity: versionItem.plannedDoseQuantity,
        quantityUnit: 'count' as const,
        sortOrder: versionItem.sortOrder,
        assertion: 'pending' as const,
        confirmedConsumptionQuantity: null,
        activeFactId: null,
      });
    }
    const occurrence: PersonalDoseOccurrence = {
      id: occurrenceId,
      regimenId: regimen.id,
      regimenVersionId: version.id,
      localServiceDate: localDate,
      scheduledAtUtc: schedule.scheduledAtUtc,
      onTimeUntilAtUtc: schedule.onTimeUntilAtUtc,
      recordUntilAtUtc: schedule.recordUntilAtUtc,
      currentLifecycle: 'scheduled',
      planProjectionState: 'active',
      replacedByOccurrenceId: null,
      rowVersion: 1,
      items,
      createdAtUtc: command.issuedAtUtc,
    };
    await repository.insertOccurrence(occurrence);
    const reminder: ReminderIntent = {
      id: this.dependencies.ids.next(),
      regimenId: regimen.id,
      occurrenceId: occurrence.id,
      scheduledAtUtc: occurrence.scheduledAtUtc,
      timeZone: version.timeZone,
      privacyMode: 'neutral',
      status: 'active',
      projectionVersion: 1,
      createdAtUtc: command.issuedAtUtc,
      updatedAtUtc: command.issuedAtUtc,
    };
    await repository.upsertReminderIntent(reminder);
    await repository.saveReminderProjection({
      reminderIntentId: reminder.id,
      systemNotificationId: null,
      status: 'pending_rebuild',
      failureCode: null,
      lastReconciledAtUtc: null,
      rowVersion: 1,
    });
    return occurrence;
  }

  private resolveSchedule(version: RegimenVersion, localDate: string, localTime = version.localTime) {
    const schedule = this.dependencies.scheduleResolver.resolveDailySchedule({
      localDate,
      localTime,
      timeZone: version.timeZone,
      onTimeOffsetMinutes: version.onTimeOffsetMinutes,
      recordOffsetMinutes: version.recordOffsetMinutes,
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
    return schedule;
  }

  private assertRegimenName(value: string): string {
    const normalized = value.trim();
    if (!normalized || Array.from(normalized).length > 60 || /[\u0000-\u001f\u007f-\u009f]/u.test(normalized)) {
      throw new DomainRuleError('VALIDATION_FAILED', 'error.regimen_name_invalid');
    }
    return normalized;
  }

  private async requireProfile(repository: MedicationRepository): Promise<AppProfile> {
    const profile = await repository.getAppProfile();
    if (!profile) throw new DomainRuleError('NOT_FOUND', 'error.app_profile_not_initialized');
    return profile;
  }

  private async requireRegimen(
    repository: MedicationRepository,
    id: string,
  ): Promise<PersonalRegimen> {
    const regimen = await repository.getRegimen(id);
    if (!regimen) throw new DomainRuleError('NOT_FOUND', 'error.regimen_not_found');
    return regimen;
  }

  private async requireRegimenVersion(
    repository: MedicationRepository,
    id: string,
  ): Promise<RegimenVersion> {
    const version = await repository.getRegimenVersion(id);
    if (!version) throw new DomainRuleError('NOT_FOUND', 'error.regimen_version_not_found');
    return version;
  }

  private async executeIdempotent<T>(
    commandType: string,
    command: PersonalWriteCommand,
    operation: (repository: MedicationRepository) => Promise<T>,
  ): CommandResult<T> {
    try {
      assertUtcInstant(command.issuedAtUtc);
      if (!command.commandId || !command.idempotencyKey || command.payloadSchemaVersion !== 2) {
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

  private businessPayload(command: PersonalWriteCommand): Record<string, unknown> {
    const { commandId: _id, idempotencyKey: _key, issuedAtUtc: _at, ...payload } = command;
    return payload;
  }
}
