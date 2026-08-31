import type { MedicationRepository } from '../../application';
import {
  DomainRuleError,
  type AuxiliaryReminderIntent,
  type AuxiliaryReminderKind,
  type AuxiliaryReminderProjection,
  type AppPreferences,
  type AppProfile,
  type DoseLifecycle,
  type FollowUpItem,
  type FollowUpItemEvent,
  type InventoryForecastPreference,
  type MedicationDailyPlan,
  type PersonalDoseOccurrence,
  type PersonalDoseOccurrenceItem,
  type PersonalConsumptionAssertionFact,
  type PersonalCountObservation,
  type PersonalFactRevocation,
  type PersonalHistoryEntry,
  type PersonalInventoryLedgerEntry,
  type PersonalMedication,
  type PersonalPhotoEvidence,
  type PersonalProcessedCommand,
  type PersonalRegimen,
  type RegimenRevisionEvent,
  type RegimenVersion,
  type RegimenVersionItem,
  type ReminderIntent,
  type ReminderProjection,
} from '../../domain';
import type { SqlDatabase } from './database';

type Row = Record<string, string | number | null>;

export class SqliteMedicationRepository implements MedicationRepository {
  constructor(private readonly database: SqlDatabase) {}

  async getAppProfile(): Promise<AppProfile | null> {
    const row = await this.database.getFirstAsync<Row>(
      `SELECT * FROM app_profile WHERE id='local-profile'`,
    );
    return row
      ? {
          id: 'local-profile',
          createdAtUtc: String(row.created_at_utc),
          updatedAtUtc: String(row.updated_at_utc),
          rowVersion: Number(row.row_version),
        }
      : null;
  }

  async insertAppProfile(profile: AppProfile, preferences: AppPreferences): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO app_profile(id,created_at_utc,updated_at_utc,row_version) VALUES(?,?,?,?)`,
      profile.id,
      profile.createdAtUtc,
      profile.updatedAtUtc,
      profile.rowVersion,
    );
    await this.database.runAsync(
      `INSERT INTO app_preferences(profile_id,theme_mode,text_size,updated_at_utc,row_version)
       VALUES(?,?,?,?,?)`,
      preferences.profileId,
      preferences.themeMode,
      preferences.textSize,
      preferences.updatedAtUtc,
      preferences.rowVersion,
    );
  }

  async getPreferences(): Promise<AppPreferences | null> {
    const row = await this.database.getFirstAsync<Row>(
      `SELECT * FROM app_preferences WHERE profile_id='local-profile'`,
    );
    return row
      ? {
          profileId: 'local-profile',
          themeMode: String(row.theme_mode) as AppPreferences['themeMode'],
          textSize: String(row.text_size) as AppPreferences['textSize'],
          updatedAtUtc: String(row.updated_at_utc),
          rowVersion: Number(row.row_version),
        }
      : null;
  }

  async updatePreferences(
    preferences: AppPreferences,
    expectedRowVersion: number,
  ): Promise<void> {
    const result = await this.database.runAsync(
      `UPDATE app_preferences SET theme_mode=?,text_size=?,updated_at_utc=?,row_version=?
       WHERE profile_id=? AND row_version=?`,
      preferences.themeMode,
      preferences.textSize,
      preferences.updatedAtUtc,
      preferences.rowVersion,
      preferences.profileId,
      expectedRowVersion,
    );
    if (result.changes !== 1) this.versionConflict();
  }

  async getMedication(id: string): Promise<PersonalMedication | null> {
    const row = await this.database.getFirstAsync<Row>(`SELECT * FROM medications WHERE id=?`, id);
    return row ? this.mapMedication(row) : null;
  }

  async listMedications(): Promise<PersonalMedication[]> {
    return (await this.database.getAllAsync<Row>(
      `SELECT * FROM medications ORDER BY created_at_utc,id`,
    )).map((row) => this.mapMedication(row));
  }

  async insertMedication(medication: PersonalMedication): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO medications(
         id,display_name,quantity_unit,status,created_at_utc,updated_at_utc,row_version
       ) VALUES(?,?,?,?,?,?,?)`,
      medication.id,
      medication.displayName,
      medication.quantityUnit,
      medication.status,
      medication.createdAtUtc,
      medication.updatedAtUtc,
      medication.rowVersion,
    );
  }

  async updateMedicationName(
    medicationId: string,
    displayName: string,
    updatedAtUtc: string,
  ): Promise<void> {
    const result = await this.database.runAsync(
      `UPDATE medications SET display_name=?,updated_at_utc=?,row_version=row_version+1 WHERE id=?`,
      displayName,
      updatedAtUtc,
      medicationId,
    );
    if (result.changes !== 1) throw new DomainRuleError('NOT_FOUND', 'error.medication_not_found');
  }

  async getInventoryForecastPreference(
    medicationId: string,
  ): Promise<InventoryForecastPreference | null> {
    const row = await this.database.getFirstAsync<Row>(
      `SELECT * FROM inventory_forecast_preferences WHERE medication_id=?`,
      medicationId,
    );
    return row ? this.mapInventoryForecastPreference(row) : null;
  }

  async listInventoryForecastPreferences(): Promise<InventoryForecastPreference[]> {
    return (await this.database.getAllAsync<Row>(
      `SELECT * FROM inventory_forecast_preferences ORDER BY medication_id`,
    )).map((row) => this.mapInventoryForecastPreference(row));
  }

  async insertInventoryForecastPreference(
    preference: InventoryForecastPreference,
  ): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO inventory_forecast_preferences(
         medication_id,lead_days,updated_at_utc,row_version
       ) VALUES(?,?,?,?)`,
      preference.medicationId,
      preference.leadDays,
      preference.updatedAtUtc,
      preference.rowVersion,
    );
  }

  async updateInventoryForecastPreference(
    preference: InventoryForecastPreference,
    expectedRowVersion: number,
  ): Promise<void> {
    const result = await this.database.runAsync(
      `UPDATE inventory_forecast_preferences
       SET lead_days=?,updated_at_utc=?,row_version=?
       WHERE medication_id=? AND row_version=?`,
      preference.leadDays,
      preference.updatedAtUtc,
      preference.rowVersion,
      preference.medicationId,
      expectedRowVersion,
    );
    if (result.changes !== 1) this.versionConflict();
  }

  async listActiveDailyPlansForMedication(
    medicationId: string,
    localDate: string,
  ): Promise<MedicationDailyPlan[]> {
    return (await this.database.getAllAsync<Row>(
      `SELECT r.id AS regimen_id,v.id AS regimen_version_id,i.medication_id,
         i.planned_dose_quantity,v.local_time,v.time_zone,v.effective_local_date
       FROM regimens r
       JOIN regimen_versions v ON v.regimen_id=r.id
       JOIN regimen_version_items i ON i.regimen_version_id=v.id
       WHERE i.medication_id=? AND (
         (r.status='active' AND r.status_effective_local_date<=?)
         OR (r.status='paused' AND r.status_effective_local_date>?)
       )
         AND v.superseded_at_utc IS NULL AND v.effective_local_date<=?
         AND (v.effective_to_local_date IS NULL OR v.effective_to_local_date>=?)
       ORDER BY v.local_time,r.id`,
      medicationId,
      localDate,
      localDate,
      localDate,
      localDate,
    )).map((row) => ({
      regimenId: String(row.regimen_id),
      regimenVersionId: String(row.regimen_version_id),
      medicationId: String(row.medication_id),
      plannedDoseQuantity: String(row.planned_dose_quantity) as MedicationDailyPlan['plannedDoseQuantity'],
      localTime: String(row.local_time),
      timeZone: String(row.time_zone),
      effectiveLocalDate: String(row.effective_local_date),
    }));
  }

  async getRegimen(id: string): Promise<PersonalRegimen | null> {
    const row = await this.database.getFirstAsync<Row>(`SELECT * FROM regimens WHERE id=?`, id);
    return row ? this.mapRegimen(row) : null;
  }

  async getRegimenVersion(id: string): Promise<RegimenVersion | null> {
    const row = await this.database.getFirstAsync<Row>(
      `SELECT * FROM regimen_versions WHERE id=?`,
      id,
    );
    return row ? this.mapRegimenVersion(row, await this.getVersionItems(id)) : null;
  }

  async getEffectiveRegimenVersion(
    regimenId: string,
    localDate: string,
  ): Promise<RegimenVersion | null> {
    const row = await this.database.getFirstAsync<Row>(
      `SELECT * FROM regimen_versions WHERE regimen_id=? AND superseded_at_utc IS NULL
       AND effective_local_date<=? AND (effective_to_local_date IS NULL OR effective_to_local_date>=?)
       ORDER BY effective_local_date DESC,version_number DESC LIMIT 1`,
      regimenId,
      localDate,
      localDate,
    );
    return row ? this.mapRegimenVersion(row, await this.getVersionItems(String(row.id))) : null;
  }

  async listRegimensForDate(localDate: string): Promise<PersonalRegimen[]> {
    const rows = await this.database.getAllAsync<Row>(
      `SELECT r.* FROM regimens r
       WHERE EXISTS(
         SELECT 1 FROM regimen_versions v
         WHERE v.regimen_id=r.id AND v.effective_local_date<=?
       ) AND (
         (r.status='active' AND r.status_effective_local_date<=?)
         OR (r.status='paused' AND r.status_effective_local_date>?)
       ) ORDER BY r.created_at_utc,r.id`,
      localDate,
      localDate,
      localDate,
    );
    return rows.map((row) => this.mapRegimen(row));
  }

  async insertRegimen(regimen: PersonalRegimen, version: RegimenVersion): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO regimens(
         id,status,status_effective_local_date,current_version_id,row_version,created_at_utc,updated_at_utc
       ) VALUES(?,?,?,?,?,?,?)`,
      regimen.id,
      regimen.status,
      regimen.statusEffectiveLocalDate,
      regimen.currentVersionId,
      regimen.rowVersion,
      regimen.createdAtUtc,
      regimen.updatedAtUtc,
    );
    await this.insertRegimenVersion(version);
  }

  async appendRegimenVersion(
    regimen: PersonalRegimen,
    version: RegimenVersion,
    expectedRowVersion: number,
  ): Promise<void> {
    await this.insertRegimenVersion(version);
    const result = await this.database.runAsync(
      `UPDATE regimens SET current_version_id=?,row_version=?,updated_at_utc=?
       WHERE id=? AND row_version=?`,
      regimen.currentVersionId,
      regimen.rowVersion,
      regimen.updatedAtUtc,
      regimen.id,
      expectedRowVersion,
    );
    if (result.changes !== 1) this.versionConflict();
  }

  async setRegimenStatus(input: {
    regimenId: string;
    status: PersonalRegimen['status'];
    effectiveLocalDate: string;
    expectedRowVersion: number;
    updatedAtUtc: string;
  }): Promise<void> {
    const result = await this.database.runAsync(
      `UPDATE regimens SET status=?,status_effective_local_date=?,updated_at_utc=?,row_version=row_version+1
       WHERE id=? AND row_version=?`,
      input.status,
      input.effectiveLocalDate,
      input.updatedAtUtc,
      input.regimenId,
      input.expectedRowVersion,
    );
    if (result.changes !== 1) this.versionConflict();
  }

  async appendRegimenRevision(event: RegimenRevisionEvent): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO regimen_revision_events(
         id,regimen_id,revision_type,previous_version_id,new_version_id,effective_local_date,
         replaced_occurrence_id,new_occurrence_id,recorded_at_utc,command_id
       ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      event.id,
      event.regimenId,
      event.revisionType,
      event.previousVersionId,
      event.newVersionId,
      event.effectiveLocalDate,
      event.replacedOccurrenceId,
      event.newOccurrenceId,
      event.recordedAtUtc,
      event.commandId,
    );
  }

  async getOccurrence(id: string): Promise<PersonalDoseOccurrence | null> {
    const row = await this.database.getFirstAsync<Row>(`SELECT * FROM dose_occurrences WHERE id=?`, id);
    return row ? this.mapOccurrence(row, await this.getOccurrenceItems(id)) : null;
  }

  async getOccurrenceByItemId(occurrenceItemId: string): Promise<PersonalDoseOccurrence | null> {
    const row = await this.database.getFirstAsync<{ occurrence_id: string }>(
      `SELECT occurrence_id FROM dose_occurrence_items WHERE id=?`,
      occurrenceItemId,
    );
    return row ? this.getOccurrence(row.occurrence_id) : null;
  }

  async findActiveOccurrence(
    regimenId: string,
    localDate: string,
  ): Promise<PersonalDoseOccurrence | null> {
    const row = await this.database.getFirstAsync<{ id: string }>(
      `SELECT id FROM dose_occurrences
       WHERE regimen_id=? AND local_service_date=? AND plan_projection_state='active'`,
      regimenId,
      localDate,
    );
    return row ? this.getOccurrence(row.id) : null;
  }

  async listActiveOccurrencesForDate(localDate: string): Promise<PersonalDoseOccurrence[]> {
    const rows = await this.database.getAllAsync<{ id: string }>(
      `SELECT id FROM dose_occurrences WHERE local_service_date=? AND plan_projection_state='active'
       ORDER BY scheduled_at_utc,id`,
      localDate,
    );
    return this.loadOccurrences(rows);
  }

  async listAllOccurrencesForDate(localDate: string): Promise<PersonalDoseOccurrence[]> {
    const rows = await this.database.getAllAsync<{ id: string }>(
      `SELECT id FROM dose_occurrences WHERE local_service_date=?
       ORDER BY scheduled_at_utc,plan_projection_state,id`,
      localDate,
    );
    return this.loadOccurrences(rows);
  }

  async listAllOccurrences(): Promise<PersonalDoseOccurrence[]> {
    const rows = await this.database.getAllAsync<{ id: string }>(
      `SELECT id FROM dose_occurrences
       ORDER BY local_service_date DESC,scheduled_at_utc,plan_projection_state,id`,
    );
    return this.loadOccurrences(rows);
  }

  async listActiveOccurrencesForRegimenFromDate(
    regimenId: string,
    localDate: string,
  ): Promise<PersonalDoseOccurrence[]> {
    const rows = await this.database.getAllAsync<{ id: string }>(
      `SELECT id FROM dose_occurrences
       WHERE regimen_id=? AND local_service_date>=? AND plan_projection_state='active'
       ORDER BY local_service_date,scheduled_at_utc,id`,
      regimenId,
      localDate,
    );
    return this.loadOccurrences(rows);
  }

  async insertOccurrence(occurrence: PersonalDoseOccurrence): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO dose_occurrences(
         id,regimen_id,regimen_version_id,local_service_date,scheduled_at_utc,
         on_time_until_at_utc,record_until_at_utc,current_lifecycle,plan_projection_state,
         replaced_by_occurrence_id,row_version,created_at_utc
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      occurrence.id,
      occurrence.regimenId,
      occurrence.regimenVersionId,
      occurrence.localServiceDate,
      occurrence.scheduledAtUtc,
      occurrence.onTimeUntilAtUtc,
      occurrence.recordUntilAtUtc,
      occurrence.currentLifecycle,
      occurrence.planProjectionState,
      occurrence.replacedByOccurrenceId,
      occurrence.rowVersion,
      occurrence.createdAtUtc,
    );
    for (const item of occurrence.items) {
      await this.database.runAsync(
        `INSERT INTO dose_occurrence_items(
           id,occurrence_id,regimen_version_item_id,medication_id,medication_display_name,
           planned_dose_quantity,quantity_unit,sort_order
         ) VALUES(?,?,?,?,?,?,?,?)`,
        item.id,
        item.occurrenceId,
        item.regimenVersionItemId,
        item.medicationId,
        item.medicationDisplayName,
        item.plannedDoseQuantity,
        item.quantityUnit,
        item.sortOrder,
      );
      await this.database.runAsync(
        `INSERT INTO dose_item_current(
           occurrence_item_id,assertion,confirmed_consumption_quantity,active_fact_id,projection_version
         ) VALUES(?,'pending',NULL,NULL,1)`,
        item.id,
      );
    }
    await this.database.runAsync(
      `INSERT INTO dose_lifecycle_events(
         id,occurrence_id,from_state,to_state,reason_code,effective_at_utc,recorded_at_utc,command_id
       ) VALUES(?,?,NULL,'scheduled','materialized',?,?,?)`,
      `materialize:${occurrence.id}`,
      occurrence.id,
      occurrence.createdAtUtc,
      occurrence.createdAtUtc,
      `materialize:${occurrence.id}`,
    );
  }

  async updateOccurrenceLifecycle(
    occurrenceId: string,
    lifecycle: DoseLifecycle,
    commandId: string,
    effectiveAtUtc: string,
    reasonCode: string,
  ): Promise<void> {
    const current = await this.database.getFirstAsync<{ current_lifecycle: string }>(
      `SELECT current_lifecycle FROM dose_occurrences WHERE id=?`,
      occurrenceId,
    );
    if (!current) throw new DomainRuleError('NOT_FOUND', 'error.occurrence_not_found');
    if (current.current_lifecycle === lifecycle) return;
    await this.database.runAsync(
      `UPDATE dose_occurrences SET current_lifecycle=?,row_version=row_version+1 WHERE id=?`,
      lifecycle,
      occurrenceId,
    );
    await this.database.runAsync(
      `INSERT OR IGNORE INTO dose_lifecycle_events(
         id,occurrence_id,from_state,to_state,reason_code,effective_at_utc,recorded_at_utc,command_id
       ) VALUES(?,?,?,?,?,?,?,?)`,
      `${commandId}:${lifecycle}`,
      occurrenceId,
      current.current_lifecycle,
      lifecycle,
      reasonCode,
      effectiveAtUtc,
      effectiveAtUtc,
      commandId,
    );
  }

  async replaceOccurrence(
    occurrenceId: string,
    replacementOccurrenceId: string | null,
    commandId: string,
    effectiveAtUtc: string,
  ): Promise<void> {
    const current = await this.database.getFirstAsync<{ current_lifecycle: string }>(
      `SELECT current_lifecycle FROM dose_occurrences
       WHERE id=? AND plan_projection_state='active'`,
      occurrenceId,
    );
    if (!current) return;
    await this.database.runAsync(
      `UPDATE dose_occurrences SET plan_projection_state='replaced',replaced_by_occurrence_id=?,
       current_lifecycle='revoked',row_version=row_version+1 WHERE id=?`,
      replacementOccurrenceId,
      occurrenceId,
    );
    await this.database.runAsync(
      `INSERT OR IGNORE INTO dose_lifecycle_events(
         id,occurrence_id,from_state,to_state,reason_code,effective_at_utc,recorded_at_utc,command_id
       ) VALUES(?,?,?,?,?,?,?,?)`,
      `${commandId}:plan-replaced:${occurrenceId}`,
      occurrenceId,
      current.current_lifecycle,
      'revoked',
      'plan_replaced',
      effectiveAtUtc,
      effectiveAtUtc,
      commandId,
    );
  }

  async addMissedEvents(
    _occurrenceId: string,
    pendingOccurrenceItemIds: string[],
    recordUntilAtUtc: string,
    recordedAtUtc: string,
  ): Promise<void> {
    for (const itemId of pendingOccurrenceItemIds) {
      await this.database.runAsync(
        `INSERT OR IGNORE INTO dose_item_missed_events(
           id,occurrence_item_id,record_until_at_utc,recorded_at_utc
         ) VALUES(?,?,?,?)`,
        `missed:${itemId}`,
        itemId,
        recordUntilAtUtc,
        recordedAtUtc,
      );
    }
  }

  async hasMissedEvent(occurrenceId: string): Promise<boolean> {
    const row = await this.database.getFirstAsync<{ found: number }>(
      `SELECT 1 AS found FROM dose_item_missed_events m
       JOIN dose_occurrence_items i ON i.id=m.occurrence_item_id
       WHERE i.occurrence_id=? LIMIT 1`,
      occurrenceId,
    );
    return row != null;
  }

  async resolveMissedEvent(
    occurrenceItemId: string,
    assertionFactId: string,
    recordedAtUtc: string,
  ): Promise<void> {
    const missed = await this.database.getFirstAsync<{ id: string }>(
      `SELECT id FROM dose_item_missed_events WHERE occurrence_item_id=?`,
      occurrenceItemId,
    );
    if (!missed) return;
    await this.database.runAsync(
      `INSERT OR IGNORE INTO dose_item_missed_resolutions(
         id,missed_event_id,assertion_fact_id,recorded_at_utc
       ) VALUES(?,?,?,?)`,
      `resolved:${missed.id}`,
      missed.id,
      assertionFactId,
      recordedAtUtc,
    );
  }

  async insertPhotoEvidence(photo: PersonalPhotoEvidence): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO photo_evidence(
         id,occurrence_id,state,deletion_status,capture_mode,capture_purpose,encrypted_media_id,skip_reason_code,
         captured_at_utc,deletion_requested_at_utc,deleted_at_utc,deletion_reason_code,created_at_utc
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      photo.id,
      photo.occurrenceId,
      photo.state,
      photo.deletionStatus,
      photo.captureMode,
      photo.capturePurpose,
      photo.encryptedMediaId,
      photo.skipReasonCode,
      photo.capturedAtUtc,
      photo.deletionRequestedAtUtc,
      photo.deletedAtUtc,
      photo.deletionReasonCode,
      photo.createdAtUtc,
    );
    for (const occurrenceItemId of photo.linkedOccurrenceItemIds) {
      await this.database.runAsync(
        `INSERT INTO photo_item_links(photo_evidence_id,occurrence_item_id) VALUES(?,?)`,
        photo.id,
        occurrenceItemId,
      );
    }
  }

  async listPhotoEvidence(occurrenceId: string): Promise<PersonalPhotoEvidence[]> {
    const rows = await this.database.getAllAsync<Row>(
      `SELECT * FROM photo_evidence WHERE occurrence_id=? ORDER BY created_at_utc,id`,
      occurrenceId,
    );
    return Promise.all(
      rows.map(async (row) => this.mapPhoto(row, await this.getPhotoLinks(String(row.id)))),
    );
  }

  async insertCountObservation(observation: PersonalCountObservation): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO count_observations(
         id,photo_evidence_id,status,detected_object_count,unable_reason_code,source,
         algorithm_version,recorded_at_utc
       ) VALUES(?,?,?,?,?,?,?,?)`,
      observation.id,
      observation.photoEvidenceId,
      observation.status,
      observation.detectedObjectCount,
      observation.unableReasonCode,
      observation.source,
      observation.algorithmVersion,
      observation.recordedAtUtc,
    );
  }

  async listCountObservations(occurrenceId: string): Promise<PersonalCountObservation[]> {
    return (await this.database.getAllAsync<Row>(
      `SELECT o.* FROM count_observations o
       JOIN photo_evidence p ON p.id=o.photo_evidence_id
       WHERE p.occurrence_id=? ORDER BY o.recorded_at_utc,o.id`,
      occurrenceId,
    )).map((row) => this.mapCountObservation(row));
  }

  async insertAssertionFact(fact: PersonalConsumptionAssertionFact): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO consumption_assertion_facts(
         id,occurrence_item_id,assertion,confirmed_consumption_quantity,
         asserted_consumed_at_utc,recorded_at_utc,source,supersedes_fact_id,
         revision_group_id,command_id
       ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      fact.id,
      fact.occurrenceItemId,
      fact.assertion,
      fact.confirmedConsumptionQuantity,
      fact.assertedConsumedAtUtc,
      fact.recordedAtUtc,
      fact.source,
      fact.supersedesFactId,
      fact.revisionGroupId,
      fact.commandId,
    );
  }

  async getAssertionFact(factId: string): Promise<PersonalConsumptionAssertionFact | null> {
    const row = await this.database.getFirstAsync<Row>(
      `SELECT * FROM consumption_assertion_facts WHERE id=?`,
      factId,
    );
    return row ? this.mapAssertionFact(row) : null;
  }

  async listAssertionFacts(occurrenceId: string): Promise<PersonalConsumptionAssertionFact[]> {
    return (await this.database.getAllAsync<Row>(
      `SELECT f.* FROM consumption_assertion_facts f
       JOIN dose_occurrence_items i ON i.id=f.occurrence_item_id
       WHERE i.occurrence_id=? ORDER BY f.recorded_at_utc,f.id`,
      occurrenceId,
    )).map((row) => this.mapAssertionFact(row));
  }

  async insertFactRevocation(revocation: PersonalFactRevocation): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO fact_revocations(
         id,fact_id,reason_code,revision_group_id,recorded_at_utc,command_id
       ) VALUES(?,?,?,?,?,?)`,
      revocation.id,
      revocation.factId,
      revocation.reasonCode,
      revocation.revisionGroupId,
      revocation.recordedAtUtc,
      revocation.commandId,
    );
  }

  async isAssertionFactRevoked(factId: string): Promise<boolean> {
    const row = await this.database.getFirstAsync<{ found: number }>(
      `SELECT 1 AS found FROM fact_revocations WHERE fact_id=?`,
      factId,
    );
    return row != null;
  }

  async setItemCurrentFromFact(fact: PersonalConsumptionAssertionFact): Promise<void> {
    const result = await this.database.runAsync(
      `UPDATE dose_item_current SET assertion=?,confirmed_consumption_quantity=?,active_fact_id=?,
       projection_version=projection_version+1 WHERE occurrence_item_id=?`,
      fact.assertion,
      fact.confirmedConsumptionQuantity,
      fact.id,
      fact.occurrenceItemId,
    );
    if (result.changes !== 1) {
      throw new DomainRuleError('NOT_FOUND', 'error.occurrence_item_not_found');
    }
  }

  async resetItemCurrent(occurrenceItemId: string): Promise<void> {
    const result = await this.database.runAsync(
      `UPDATE dose_item_current SET assertion='pending',confirmed_consumption_quantity=NULL,
       active_fact_id=NULL,projection_version=projection_version+1 WHERE occurrence_item_id=?`,
      occurrenceItemId,
    );
    if (result.changes !== 1) {
      throw new DomainRuleError('NOT_FOUND', 'error.occurrence_item_not_found');
    }
  }

  async insertInventoryEntry(entry: PersonalInventoryLedgerEntry): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO inventory_ledger(
         id,medication_id,entry_type,quantity_delta,quantity_unit,source_fact_type,source_fact_id,
         reverses_entry_id,reason_code,effective_at_utc,recorded_at_utc,command_id
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      entry.id,
      entry.medicationId,
      entry.entryType,
      entry.quantityDelta,
      entry.quantityUnit,
      entry.sourceFactType,
      entry.sourceFactId,
      entry.reversesEntryId,
      entry.reasonCode,
      entry.effectiveAtUtc,
      entry.recordedAtUtc,
      entry.commandId,
    );
  }

  async listInventoryLedger(medicationId: string): Promise<PersonalInventoryLedgerEntry[]> {
    return (await this.database.getAllAsync<Row>(
      `SELECT * FROM inventory_ledger WHERE medication_id=? ORDER BY recorded_at_utc,id`,
      medicationId,
    )).map((row) => this.mapLedger(row));
  }

  async listAllInventoryLedger(): Promise<PersonalInventoryLedgerEntry[]> {
    return (await this.database.getAllAsync<Row>(
      `SELECT * FROM inventory_ledger ORDER BY recorded_at_utc,id`,
    )).map((row) => this.mapLedger(row));
  }

  async findConsumptionEntry(factId: string): Promise<PersonalInventoryLedgerEntry | null> {
    const row = await this.database.getFirstAsync<Row>(
      `SELECT * FROM inventory_ledger
       WHERE source_fact_type='consumption_assertion' AND source_fact_id=?
         AND entry_type='consumption'`,
      factId,
    );
    return row ? this.mapLedger(row) : null;
  }

  async findReversalEntry(entryId: string): Promise<PersonalInventoryLedgerEntry | null> {
    const row = await this.database.getFirstAsync<Row>(
      `SELECT * FROM inventory_ledger WHERE reverses_entry_id=? AND entry_type='reversal'`,
      entryId,
    );
    return row ? this.mapLedger(row) : null;
  }

  async upsertReminderIntent(intent: ReminderIntent): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO reminder_intents(
         id,regimen_id,occurrence_id,scheduled_at_utc,time_zone,privacy_mode,status,
         projection_version,created_at_utc,updated_at_utc
       ) VALUES(?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(occurrence_id) DO UPDATE SET scheduled_at_utc=excluded.scheduled_at_utc,
         time_zone=excluded.time_zone,status=excluded.status,
         projection_version=reminder_intents.projection_version+1,
         updated_at_utc=excluded.updated_at_utc`,
      intent.id,
      intent.regimenId,
      intent.occurrenceId,
      intent.scheduledAtUtc,
      intent.timeZone,
      intent.privacyMode,
      intent.status,
      intent.projectionVersion,
      intent.createdAtUtc,
      intent.updatedAtUtc,
    );
  }

  async getReminderIntentByOccurrence(occurrenceId: string): Promise<ReminderIntent | null> {
    const row = await this.database.getFirstAsync<Row>(
      `SELECT * FROM reminder_intents WHERE occurrence_id=?`,
      occurrenceId,
    );
    return row ? this.mapReminderIntent(row) : null;
  }

  async listAllReminderIntents(): Promise<ReminderIntent[]> {
    return (await this.database.getAllAsync<Row>(
      `SELECT * FROM reminder_intents ORDER BY scheduled_at_utc,id`,
    )).map((row) => this.mapReminderIntent(row));
  }

  async cancelReminderIntent(occurrenceId: string, updatedAtUtc: string): Promise<void> {
    await this.database.runAsync(
      `UPDATE reminder_intents SET status='cancelled',projection_version=projection_version+1,
       updated_at_utc=? WHERE occurrence_id=? AND status<>'cancelled'`,
      updatedAtUtc,
      occurrenceId,
    );
    await this.database.runAsync(
      `UPDATE reminder_projections SET status='cancel_pending',failure_code=NULL,
       row_version=row_version+1 WHERE reminder_intent_id=(
         SELECT id FROM reminder_intents WHERE occurrence_id=?
       ) AND status<>'cancelled'`,
      occurrenceId,
    );
  }

  async getReminderProjection(reminderIntentId: string): Promise<ReminderProjection | null> {
    const row = await this.database.getFirstAsync<Row>(
      `SELECT * FROM reminder_projections WHERE reminder_intent_id=?`,
      reminderIntentId,
    );
    return row ? this.mapReminderProjection(row) : null;
  }

  async saveReminderProjection(projection: ReminderProjection): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO reminder_projections(
         reminder_intent_id,system_notification_id,status,failure_code,last_reconciled_at_utc,row_version
       ) VALUES(?,?,?,?,?,?)
       ON CONFLICT(reminder_intent_id) DO UPDATE SET
         system_notification_id=excluded.system_notification_id,status=excluded.status,
         failure_code=excluded.failure_code,last_reconciled_at_utc=excluded.last_reconciled_at_utc,
         row_version=reminder_projections.row_version+1`,
      projection.reminderIntentId,
      projection.systemNotificationId,
      projection.status,
      projection.failureCode,
      projection.lastReconciledAtUtc,
      projection.rowVersion,
    );
  }

  async markReminderProjectionPending(occurrenceId: string): Promise<void> {
    await this.database.runAsync(
      `UPDATE reminder_projections SET status='pending_rebuild',failure_code=NULL,
       row_version=row_version+1 WHERE reminder_intent_id=(
         SELECT id FROM reminder_intents WHERE occurrence_id=?
       )`,
      occurrenceId,
    );
  }

  async getFollowUpItem(id: string): Promise<FollowUpItem | null> {
    const row = await this.database.getFirstAsync<Row>(
      `SELECT * FROM follow_up_items WHERE id=?`,
      id,
    );
    return row ? this.mapFollowUpItem(row) : null;
  }

  async insertFollowUpItem(item: FollowUpItem, event: FollowUpItemEvent): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO follow_up_items(
         id,type,title,due_at_utc,time_zone,medication_id,note,advance_days,status,
         completed_at_utc,cancelled_at_utc,created_at_utc,updated_at_utc,row_version
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      item.id,
      item.type,
      item.title,
      item.dueAtUtc,
      item.timeZone,
      item.medicationId,
      item.note,
      item.advanceDays,
      item.status,
      item.completedAtUtc,
      item.cancelledAtUtc,
      item.createdAtUtc,
      item.updatedAtUtc,
      item.rowVersion,
    );
    await this.insertFollowUpEvent(event);
  }

  async updateFollowUpItem(
    item: FollowUpItem,
    event: FollowUpItemEvent,
    expectedRowVersion: number,
  ): Promise<void> {
    const result = await this.database.runAsync(
      `UPDATE follow_up_items SET type=?,title=?,due_at_utc=?,time_zone=?,medication_id=?,
         note=?,advance_days=?,status=?,completed_at_utc=?,cancelled_at_utc=?,updated_at_utc=?,
         row_version=? WHERE id=? AND row_version=?`,
      item.type,
      item.title,
      item.dueAtUtc,
      item.timeZone,
      item.medicationId,
      item.note,
      item.advanceDays,
      item.status,
      item.completedAtUtc,
      item.cancelledAtUtc,
      item.updatedAtUtc,
      item.rowVersion,
      item.id,
      expectedRowVersion,
    );
    if (result.changes !== 1) this.versionConflict();
    await this.insertFollowUpEvent(event);
  }

  async listPendingFollowUpItems(): Promise<FollowUpItem[]> {
    return (await this.database.getAllAsync<Row>(
      `SELECT * FROM follow_up_items WHERE status='pending' ORDER BY due_at_utc,id`,
    )).map((row) => this.mapFollowUpItem(row));
  }

  async listAllFollowUpItems(): Promise<FollowUpItem[]> {
    return (await this.database.getAllAsync<Row>(
      `SELECT * FROM follow_up_items ORDER BY due_at_utc,id`,
    )).map((row) => this.mapFollowUpItem(row));
  }

  async listOpenFollowUpItemsDueBy(cutoffAtUtc: string): Promise<FollowUpItem[]> {
    return (await this.database.getAllAsync<Row>(
      `SELECT * FROM follow_up_items
       WHERE status='pending' AND due_at_utc<=? ORDER BY due_at_utc,id`,
      cutoffAtUtc,
    )).map((row) => this.mapFollowUpItem(row));
  }

  async listFollowUpItemEvents(followUpItemId: string): Promise<FollowUpItemEvent[]> {
    return (await this.database.getAllAsync<Row>(
      `SELECT * FROM follow_up_item_events WHERE follow_up_item_id=?
       ORDER BY recorded_at_utc,id`,
      followUpItemId,
    )).map((row) => this.mapFollowUpItemEvent(row));
  }

  async getAuxiliaryReminderIntent(
    kind: AuxiliaryReminderKind,
    sourceId: string,
  ): Promise<AuxiliaryReminderIntent | null> {
    const row = await this.database.getFirstAsync<Row>(
      `SELECT * FROM auxiliary_reminder_intents WHERE kind=? AND source_id=?`,
      kind,
      sourceId,
    );
    return row ? this.mapAuxiliaryReminderIntent(row) : null;
  }

  async upsertAuxiliaryReminderIntent(intent: AuxiliaryReminderIntent): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO auxiliary_reminder_intents(
         id,kind,source_type,source_id,medication_id,follow_up_item_id,trigger_at_utc,time_zone,
         status,projection_version,created_at_utc,updated_at_utc
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(kind,source_type,source_id) DO UPDATE SET
         trigger_at_utc=excluded.trigger_at_utc,time_zone=excluded.time_zone,status='active',
         projection_version=auxiliary_reminder_intents.projection_version+1,
         updated_at_utc=excluded.updated_at_utc`,
      intent.id,
      intent.kind,
      intent.sourceType,
      intent.sourceId,
      intent.sourceType === 'medication' ? intent.sourceId : null,
      intent.sourceType === 'follow_up_item' ? intent.sourceId : null,
      intent.triggerAtUtc,
      intent.timeZone,
      intent.status,
      intent.projectionVersion,
      intent.createdAtUtc,
      intent.updatedAtUtc,
    );
  }

  async cancelAuxiliaryReminderIntent(
    kind: AuxiliaryReminderKind,
    sourceId: string,
    updatedAtUtc: string,
  ): Promise<void> {
    await this.database.runAsync(
      `UPDATE auxiliary_reminder_intents SET status='cancelled',
         projection_version=projection_version+1,updated_at_utc=?
       WHERE kind=? AND source_id=? AND status<>'cancelled'`,
      updatedAtUtc,
      kind,
      sourceId,
    );
    await this.database.runAsync(
      `UPDATE auxiliary_reminder_projections SET status='cancel_pending',failure_code=NULL,
         row_version=row_version+1
       WHERE reminder_intent_id=(
         SELECT id FROM auxiliary_reminder_intents WHERE kind=? AND source_id=?
       ) AND status<>'cancelled'`,
      kind,
      sourceId,
    );
  }

  async listActiveAuxiliaryReminderIntents(): Promise<AuxiliaryReminderIntent[]> {
    return (await this.database.getAllAsync<Row>(
      `SELECT * FROM auxiliary_reminder_intents WHERE status='active'
       ORDER BY trigger_at_utc,kind,id`,
    )).map((row) => this.mapAuxiliaryReminderIntent(row));
  }

  async listAllAuxiliaryReminderIntents(): Promise<AuxiliaryReminderIntent[]> {
    return (await this.database.getAllAsync<Row>(
      `SELECT * FROM auxiliary_reminder_intents ORDER BY trigger_at_utc,kind,id`,
    )).map((row) => this.mapAuxiliaryReminderIntent(row));
  }

  async getAuxiliaryReminderProjection(
    reminderIntentId: string,
  ): Promise<AuxiliaryReminderProjection | null> {
    const row = await this.database.getFirstAsync<Row>(
      `SELECT * FROM auxiliary_reminder_projections WHERE reminder_intent_id=?`,
      reminderIntentId,
    );
    return row ? this.mapAuxiliaryReminderProjection(row) : null;
  }

  async saveAuxiliaryReminderProjection(
    projection: AuxiliaryReminderProjection,
  ): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO auxiliary_reminder_projections(
         reminder_intent_id,system_notification_id,status,failure_code,
         last_reconciled_at_utc,row_version
       ) VALUES(?,?,?,?,?,?)
       ON CONFLICT(reminder_intent_id) DO UPDATE SET
         system_notification_id=excluded.system_notification_id,status=excluded.status,
         failure_code=excluded.failure_code,last_reconciled_at_utc=excluded.last_reconciled_at_utc,
         row_version=auxiliary_reminder_projections.row_version+1`,
      projection.reminderIntentId,
      projection.systemNotificationId,
      projection.status,
      projection.failureCode,
      projection.lastReconciledAtUtc,
      projection.rowVersion,
    );
  }

  async getPhotoEvidence(id: string): Promise<PersonalPhotoEvidence | null> {
    const row = await this.database.getFirstAsync<Row>(`SELECT * FROM photo_evidence WHERE id=?`, id);
    return row ? this.mapPhoto(row, await this.getPhotoLinks(id)) : null;
  }

  async listAllPhotoEvidence(): Promise<PersonalPhotoEvidence[]> {
    const rows = await this.database.getAllAsync<Row>(
      `SELECT * FROM photo_evidence ORDER BY created_at_utc,id`,
    );
    return Promise.all(
      rows.map(async (row) => this.mapPhoto(row, await this.getPhotoLinks(String(row.id)))),
    );
  }

  async markPhotoDeletionPending(
    photoId: string,
    requestedAtUtc: string,
    reasonCode: string,
  ): Promise<void> {
    const result = await this.database.runAsync(
      `UPDATE photo_evidence SET deletion_status='pending',deletion_requested_at_utc=?,
       deletion_reason_code=? WHERE id=? AND state='captured' AND deletion_status='active'`,
      requestedAtUtc,
      reasonCode,
      photoId,
    );
    if (result.changes !== 1) {
      throw new DomainRuleError('ILLEGAL_STATE_TRANSITION', 'error.photo_not_deletable');
    }
  }

  async finalizePhotoTombstone(photoId: string, deletedAtUtc: string): Promise<void> {
    const result = await this.database.runAsync(
      `UPDATE photo_evidence SET state='deleted_tombstone',deletion_status='deleted',
       encrypted_media_id=NULL,deleted_at_utc=? WHERE id=? AND deletion_status='pending'`,
      deletedAtUtc,
      photoId,
    );
    if (result.changes !== 1) {
      throw new DomainRuleError('ILLEGAL_STATE_TRANSITION', 'error.photo_deletion_not_pending');
    }
  }

  async getHistory(occurrenceId: string): Promise<PersonalHistoryEntry | null> {
    const occurrence = await this.getOccurrence(occurrenceId);
    if (!occurrence) return null;
    const medicationIds = [...new Set(occurrence.items.map((item) => item.medicationId))];
    const inventoryEntries = (
      await Promise.all(medicationIds.map((id) => this.listInventoryLedger(id)))
    )
      .flat()
      .filter(
        (entry) =>
          occurrence.items.some((item) => item.activeFactId === entry.sourceFactId) ||
          entry.sourceFactType === 'consumption_assertion' ||
          entry.sourceFactType === 'inventory_ledger',
      );
    const assertionFacts = await this.listAssertionFacts(occurrenceId);
    const assertionFactIds = new Set(assertionFacts.map((fact) => fact.id));
    const occurrenceLedger = inventoryEntries.filter((entry) => {
      if (entry.sourceFactType === 'consumption_assertion') {
        return assertionFactIds.has(entry.sourceFactId);
      }
      if (entry.sourceFactType === 'inventory_ledger') {
        return inventoryEntries.some(
          (candidate) =>
            candidate.id === entry.sourceFactId &&
            candidate.sourceFactType === 'consumption_assertion' &&
            assertionFactIds.has(candidate.sourceFactId),
        );
      }
      return false;
    });
    return {
      occurrence,
      photos: await this.listPhotoEvidence(occurrenceId),
      countObservations: await this.listCountObservations(occurrenceId),
      assertionFacts,
      inventoryEntries: occurrenceLedger,
    };
  }

  async getProcessedCommand(
    commandType: string,
    idempotencyKey: string,
  ): Promise<PersonalProcessedCommand | null> {
    const row = await this.database.getFirstAsync<Row>(
      `SELECT * FROM processed_commands WHERE command_type=? AND idempotency_key=?`,
      commandType,
      idempotencyKey,
    );
    return row
      ? {
          commandType: String(row.command_type),
          idempotencyKey: String(row.idempotency_key),
          payloadFingerprint: String(row.payload_fingerprint),
          resultJson: String(row.result_json),
          processedAtUtc: String(row.processed_at_utc),
        }
      : null;
  }

  async saveProcessedCommand(command: PersonalProcessedCommand): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO processed_commands(
         command_type,idempotency_key,payload_fingerprint,result_json,processed_at_utc
       ) VALUES(?,?,?,?,?)`,
      command.commandType,
      command.idempotencyKey,
      command.payloadFingerprint,
      command.resultJson,
      command.processedAtUtc,
    );
  }

  private async insertRegimenVersion(version: RegimenVersion): Promise<void> {
    await this.database.runAsync(
      `UPDATE regimen_versions SET superseded_at_utc=?
       WHERE regimen_id=? AND superseded_at_utc IS NULL AND effective_local_date>=?`,
      version.createdAtUtc,
      version.regimenId,
      version.effectiveLocalDate,
    );
    await this.database.runAsync(
      `UPDATE regimen_versions SET effective_to_local_date=date(?,'-1 day')
       WHERE regimen_id=? AND superseded_at_utc IS NULL AND effective_local_date<?
         AND (effective_to_local_date IS NULL OR effective_to_local_date>=?)`,
      version.effectiveLocalDate,
      version.regimenId,
      version.effectiveLocalDate,
      version.effectiveLocalDate,
    );
    await this.database.runAsync(
      `INSERT INTO regimen_versions(
         id,regimen_id,version_number,name,local_time,time_zone,on_time_offset_minutes,
         record_offset_minutes,capture_mode,effective_local_date,effective_to_local_date,
         superseded_at_utc,supersedes_version_id,created_at_utc
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      version.id,
      version.regimenId,
      version.versionNumber,
      version.name,
      version.localTime,
      version.timeZone,
      version.onTimeOffsetMinutes,
      version.recordOffsetMinutes,
      version.captureMode,
      version.effectiveLocalDate,
      version.effectiveToLocalDate,
      version.supersededAtUtc,
      version.supersedesVersionId,
      version.createdAtUtc,
    );
    for (const item of version.items) {
      await this.database.runAsync(
        `INSERT INTO regimen_version_items(
           id,regimen_version_id,medication_id,planned_dose_quantity,quantity_unit,sort_order
         ) VALUES(?,?,?,?,?,?)`,
        item.id,
        item.regimenVersionId,
        item.medicationId,
        item.plannedDoseQuantity,
        item.quantityUnit,
        item.sortOrder,
      );
    }
  }

  private async insertFollowUpEvent(event: FollowUpItemEvent): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO follow_up_item_events(
         id,follow_up_item_id,event_type,previous_status,new_status,snapshot_json,
         recorded_at_utc,command_id
       ) VALUES(?,?,?,?,?,?,?,?)`,
      event.id,
      event.followUpItemId,
      event.eventType,
      event.previousStatus,
      event.newStatus,
      event.snapshotJson,
      event.recordedAtUtc,
      event.commandId,
    );
  }

  private async getVersionItems(regimenVersionId: string): Promise<RegimenVersionItem[]> {
    return (await this.database.getAllAsync<Row>(
      `SELECT * FROM regimen_version_items WHERE regimen_version_id=? ORDER BY sort_order,id`,
      regimenVersionId,
    )).map((row) => ({
      id: String(row.id),
      regimenVersionId: String(row.regimen_version_id),
      medicationId: String(row.medication_id),
      plannedDoseQuantity: String(row.planned_dose_quantity) as RegimenVersionItem['plannedDoseQuantity'],
      quantityUnit: 'count',
      sortOrder: Number(row.sort_order),
    }));
  }

  private async getOccurrenceItems(occurrenceId: string): Promise<PersonalDoseOccurrenceItem[]> {
    return (await this.database.getAllAsync<Row>(
      `SELECT i.*,c.assertion,c.confirmed_consumption_quantity,c.active_fact_id
       FROM dose_occurrence_items i
       JOIN dose_item_current c ON c.occurrence_item_id=i.id
       WHERE i.occurrence_id=? ORDER BY i.sort_order,i.id`,
      occurrenceId,
    )).map((row) => ({
      id: String(row.id),
      occurrenceId: String(row.occurrence_id),
      regimenVersionItemId: String(row.regimen_version_item_id),
      medicationId: String(row.medication_id),
      medicationDisplayName: String(row.medication_display_name),
      plannedDoseQuantity: String(row.planned_dose_quantity) as PersonalDoseOccurrenceItem['plannedDoseQuantity'],
      quantityUnit: 'count',
      sortOrder: Number(row.sort_order),
      assertion: String(row.assertion) as PersonalDoseOccurrenceItem['assertion'],
      confirmedConsumptionQuantity:
        row.confirmed_consumption_quantity == null
          ? null
          : (String(row.confirmed_consumption_quantity) as PersonalDoseOccurrenceItem['confirmedConsumptionQuantity']),
      activeFactId: row.active_fact_id == null ? null : String(row.active_fact_id),
    }));
  }

  private async loadOccurrences(rows: { id: string }[]): Promise<PersonalDoseOccurrence[]> {
    const values = await Promise.all(rows.map((row) => this.getOccurrence(row.id)));
    return values.filter((value): value is PersonalDoseOccurrence => value !== null);
  }

  private async getPhotoLinks(photoId: string): Promise<string[]> {
    return (await this.database.getAllAsync<{ occurrence_item_id: string }>(
      `SELECT occurrence_item_id FROM photo_item_links
       WHERE photo_evidence_id=? ORDER BY occurrence_item_id`,
      photoId,
    )).map((row) => row.occurrence_item_id);
  }

  private mapMedication(row: Row): PersonalMedication {
    return {
      id: String(row.id),
      displayName: String(row.display_name),
      quantityUnit: 'count',
      status: String(row.status) as PersonalMedication['status'],
      createdAtUtc: String(row.created_at_utc),
      updatedAtUtc: String(row.updated_at_utc),
      rowVersion: Number(row.row_version),
    };
  }

  private mapInventoryForecastPreference(row: Row): InventoryForecastPreference {
    return {
      medicationId: String(row.medication_id),
      leadDays:
        row.lead_days == null
          ? null
          : (Number(row.lead_days) as InventoryForecastPreference['leadDays']),
      updatedAtUtc: String(row.updated_at_utc),
      rowVersion: Number(row.row_version),
    };
  }

  private mapFollowUpItem(row: Row): FollowUpItem {
    return {
      id: String(row.id),
      type: String(row.type) as FollowUpItem['type'],
      title: String(row.title),
      dueAtUtc: String(row.due_at_utc),
      timeZone: String(row.time_zone),
      medicationId: row.medication_id == null ? null : String(row.medication_id),
      note: String(row.note),
      advanceDays:
        row.advance_days == null ? null : (Number(row.advance_days) as FollowUpItem['advanceDays']),
      status: String(row.status) as FollowUpItem['status'],
      completedAtUtc: row.completed_at_utc == null ? null : String(row.completed_at_utc),
      cancelledAtUtc: row.cancelled_at_utc == null ? null : String(row.cancelled_at_utc),
      createdAtUtc: String(row.created_at_utc),
      updatedAtUtc: String(row.updated_at_utc),
      rowVersion: Number(row.row_version),
    };
  }

  private mapFollowUpItemEvent(row: Row): FollowUpItemEvent {
    return {
      id: String(row.id),
      followUpItemId: String(row.follow_up_item_id),
      eventType: String(row.event_type) as FollowUpItemEvent['eventType'],
      previousStatus:
        row.previous_status == null
          ? null
          : (String(row.previous_status) as FollowUpItemEvent['previousStatus']),
      newStatus: String(row.new_status) as FollowUpItemEvent['newStatus'],
      snapshotJson: String(row.snapshot_json),
      recordedAtUtc: String(row.recorded_at_utc),
      commandId: String(row.command_id),
    };
  }

  private mapAuxiliaryReminderIntent(row: Row): AuxiliaryReminderIntent {
    return {
      id: String(row.id),
      kind: String(row.kind) as AuxiliaryReminderIntent['kind'],
      sourceType: String(row.source_type) as AuxiliaryReminderIntent['sourceType'],
      sourceId: String(row.source_id),
      triggerAtUtc: String(row.trigger_at_utc),
      timeZone: String(row.time_zone),
      status: String(row.status) as AuxiliaryReminderIntent['status'],
      projectionVersion: Number(row.projection_version),
      createdAtUtc: String(row.created_at_utc),
      updatedAtUtc: String(row.updated_at_utc),
    };
  }

  private mapAuxiliaryReminderProjection(row: Row): AuxiliaryReminderProjection {
    return {
      reminderIntentId: String(row.reminder_intent_id),
      systemNotificationId:
        row.system_notification_id == null ? null : String(row.system_notification_id),
      status: String(row.status) as AuxiliaryReminderProjection['status'],
      failureCode: row.failure_code == null ? null : String(row.failure_code),
      lastReconciledAtUtc:
        row.last_reconciled_at_utc == null ? null : String(row.last_reconciled_at_utc),
      rowVersion: Number(row.row_version),
    };
  }

  private mapRegimen(row: Row): PersonalRegimen {
    return {
      id: String(row.id),
      status: String(row.status) as PersonalRegimen['status'],
      statusEffectiveLocalDate: String(row.status_effective_local_date),
      currentVersionId: String(row.current_version_id),
      rowVersion: Number(row.row_version),
      createdAtUtc: String(row.created_at_utc),
      updatedAtUtc: String(row.updated_at_utc),
    };
  }

  private mapRegimenVersion(row: Row, items: RegimenVersionItem[]): RegimenVersion {
    return {
      id: String(row.id),
      regimenId: String(row.regimen_id),
      versionNumber: Number(row.version_number),
      name: String(row.name),
      localTime: String(row.local_time),
      timeZone: String(row.time_zone),
      onTimeOffsetMinutes: Number(row.on_time_offset_minutes),
      recordOffsetMinutes: Number(row.record_offset_minutes),
      captureMode: String(row.capture_mode) as RegimenVersion['captureMode'],
      effectiveLocalDate: String(row.effective_local_date),
      effectiveToLocalDate:
        row.effective_to_local_date == null ? null : String(row.effective_to_local_date),
      supersededAtUtc:
        row.superseded_at_utc == null ? null : String(row.superseded_at_utc),
      supersedesVersionId:
        row.supersedes_version_id == null ? null : String(row.supersedes_version_id),
      items,
      createdAtUtc: String(row.created_at_utc),
    };
  }

  private mapOccurrence(
    row: Row,
    items: PersonalDoseOccurrenceItem[],
  ): PersonalDoseOccurrence {
    return {
      id: String(row.id),
      regimenId: String(row.regimen_id),
      regimenVersionId: String(row.regimen_version_id),
      localServiceDate: String(row.local_service_date),
      scheduledAtUtc: String(row.scheduled_at_utc),
      onTimeUntilAtUtc: String(row.on_time_until_at_utc),
      recordUntilAtUtc: String(row.record_until_at_utc),
      currentLifecycle: String(row.current_lifecycle) as PersonalDoseOccurrence['currentLifecycle'],
      planProjectionState: String(row.plan_projection_state) as PersonalDoseOccurrence['planProjectionState'],
      replacedByOccurrenceId:
        row.replaced_by_occurrence_id == null ? null : String(row.replaced_by_occurrence_id),
      rowVersion: Number(row.row_version),
      items,
      createdAtUtc: String(row.created_at_utc),
    };
  }

  private mapLedger(row: Row): PersonalInventoryLedgerEntry {
    return {
      id: String(row.id),
      medicationId: String(row.medication_id),
      entryType: String(row.entry_type) as PersonalInventoryLedgerEntry['entryType'],
      quantityDelta: String(row.quantity_delta) as PersonalInventoryLedgerEntry['quantityDelta'],
      quantityUnit: 'count',
      sourceFactType: String(row.source_fact_type) as PersonalInventoryLedgerEntry['sourceFactType'],
      sourceFactId: String(row.source_fact_id),
      reversesEntryId: row.reverses_entry_id == null ? null : String(row.reverses_entry_id),
      reasonCode: row.reason_code == null ? null : String(row.reason_code),
      effectiveAtUtc: String(row.effective_at_utc),
      recordedAtUtc: String(row.recorded_at_utc),
      commandId: String(row.command_id),
    };
  }

  private mapCountObservation(row: Row): PersonalCountObservation {
    return {
      id: String(row.id),
      photoEvidenceId: String(row.photo_evidence_id),
      status: String(row.status) as PersonalCountObservation['status'],
      detectedObjectCount:
        row.detected_object_count == null ? null : Number(row.detected_object_count),
      unableReasonCode:
        row.unable_reason_code == null ? null : String(row.unable_reason_code),
      source: String(row.source) as PersonalCountObservation['source'],
      algorithmVersion: String(row.algorithm_version),
      recordedAtUtc: String(row.recorded_at_utc),
    };
  }

  private mapAssertionFact(row: Row): PersonalConsumptionAssertionFact {
    return {
      id: String(row.id),
      occurrenceItemId: String(row.occurrence_item_id),
      assertion: String(row.assertion) as PersonalConsumptionAssertionFact['assertion'],
      confirmedConsumptionQuantity: String(
        row.confirmed_consumption_quantity,
      ) as PersonalConsumptionAssertionFact['confirmedConsumptionQuantity'],
      assertedConsumedAtUtc:
        row.asserted_consumed_at_utc == null ? null : String(row.asserted_consumed_at_utc),
      recordedAtUtc: String(row.recorded_at_utc),
      source: String(row.source) as PersonalConsumptionAssertionFact['source'],
      supersedesFactId:
        row.supersedes_fact_id == null ? null : String(row.supersedes_fact_id),
      revisionGroupId:
        row.revision_group_id == null ? null : String(row.revision_group_id),
      commandId: String(row.command_id),
    };
  }

  private mapReminderIntent(row: Row): ReminderIntent {
    return {
      id: String(row.id),
      regimenId: String(row.regimen_id),
      occurrenceId: String(row.occurrence_id),
      scheduledAtUtc: String(row.scheduled_at_utc),
      timeZone: String(row.time_zone),
      privacyMode: 'neutral',
      status: String(row.status) as ReminderIntent['status'],
      projectionVersion: Number(row.projection_version),
      createdAtUtc: String(row.created_at_utc),
      updatedAtUtc: String(row.updated_at_utc),
    };
  }

  private mapReminderProjection(row: Row): ReminderProjection {
    return {
      reminderIntentId: String(row.reminder_intent_id),
      systemNotificationId:
        row.system_notification_id == null ? null : String(row.system_notification_id),
      status: String(row.status) as ReminderProjection['status'],
      failureCode: row.failure_code == null ? null : String(row.failure_code),
      lastReconciledAtUtc:
        row.last_reconciled_at_utc == null ? null : String(row.last_reconciled_at_utc),
      rowVersion: Number(row.row_version),
    };
  }

  private mapPhoto(row: Row, linkedOccurrenceItemIds: string[]): PersonalPhotoEvidence {
    return {
      id: String(row.id),
      occurrenceId: String(row.occurrence_id),
      state: String(row.state) as PersonalPhotoEvidence['state'],
      deletionStatus: String(row.deletion_status) as PersonalPhotoEvidence['deletionStatus'],
      captureMode: String(row.capture_mode) as PersonalPhotoEvidence['captureMode'],
      capturePurpose: String(row.capture_purpose ?? 'initial') as PersonalPhotoEvidence['capturePurpose'],
      encryptedMediaId: row.encrypted_media_id == null ? null : String(row.encrypted_media_id),
      skipReasonCode: row.skip_reason_code == null ? null : String(row.skip_reason_code),
      capturedAtUtc: row.captured_at_utc == null ? null : String(row.captured_at_utc),
      deletionRequestedAtUtc:
        row.deletion_requested_at_utc == null ? null : String(row.deletion_requested_at_utc),
      deletedAtUtc: row.deleted_at_utc == null ? null : String(row.deleted_at_utc),
      deletionReasonCode:
        row.deletion_reason_code == null ? null : String(row.deletion_reason_code),
      linkedOccurrenceItemIds,
      createdAtUtc: String(row.created_at_utc),
    };
  }

  private versionConflict(): never {
    throw new DomainRuleError('VERSION_CONFLICT', 'error.version_conflict');
  }
}
