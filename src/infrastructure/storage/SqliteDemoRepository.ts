import type { DemoRepository } from '../../application';
import type {
  ConsumptionAssertionFact,
  CountObservation,
  DemoProfile,
  DoseLifecycle,
  DoseOccurrence,
  DoseOccurrenceItem,
  HistoryEntry,
  InventoryLedgerEntry,
  Medication,
  PhotoEvidence,
  ProcessedCommand,
  Regimen,
  RegimenItem,
  UtcInstant,
} from '../../domain';
import type { SqlDatabase } from './database';

type Row = Record<string, string | number | null>;

export class SqliteDemoRepository implements DemoRepository {
  constructor(private readonly database: SqlDatabase) {}

  async getProfile(): Promise<DemoProfile | null> {
    const row = await this.database.getFirstAsync<Row>(
      `SELECT id, disclaimer_version, acknowledged_at_utc FROM demo_profile WHERE id='demo-profile'`,
    );
    return row
      ? {
          id: 'demo-profile',
          disclaimerVersion: String(row.disclaimer_version),
          acknowledgedAtUtc: String(row.acknowledged_at_utc),
        }
      : null;
  }

  async saveProfile(profile: DemoProfile): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO demo_profile(id, disclaimer_version, acknowledged_at_utc)
       VALUES(?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET disclaimer_version=excluded.disclaimer_version,
         acknowledged_at_utc=excluded.acknowledged_at_utc`,
      profile.id,
      profile.disclaimerVersion,
      profile.acknowledgedAtUtc,
    );
  }

  async getMedication(id: string): Promise<Medication | null> {
    const row = await this.database.getFirstAsync<Row>(`SELECT * FROM medications WHERE id=?`, id);
    return row ? this.mapMedication(row) : null;
  }

  async listMedications(): Promise<Medication[]> {
    return (await this.database.getAllAsync<Row>(`SELECT * FROM medications ORDER BY created_at_utc`)).map(
      (row) => this.mapMedication(row),
    );
  }

  async insertMedication(medication: Medication): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO medications(id, display_name, dosage_form, inventory_unit, status, created_at_utc)
       VALUES(?, ?, ?, ?, ?, ?)`,
      medication.id,
      medication.displayName,
      medication.dosageForm,
      medication.inventoryUnit,
      medication.status,
      medication.createdAtUtc,
    );
  }

  async getRegimen(id: string): Promise<Regimen | null> {
    const row = await this.database.getFirstAsync<Row>(`SELECT * FROM regimens WHERE id=?`, id);
    return row ? this.mapRegimen(row, await this.getRegimenItems(id)) : null;
  }

  async listActiveRegimensForDate(localDate: string): Promise<Regimen[]> {
    const rows = await this.database.getAllAsync<Row>(
      `SELECT * FROM regimens
       WHERE status='active' AND start_local_date<=?
         AND (end_local_date IS NULL OR end_local_date>=?)
       ORDER BY local_time, created_at_utc`,
      localDate,
      localDate,
    );
    return Promise.all(
      rows.map(async (row) => this.mapRegimen(row, await this.getRegimenItems(String(row.id)))),
    );
  }

  async insertRegimen(regimen: Regimen): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO regimens(
         id,name,local_time,time_zone,on_time_offset_minutes,record_offset_minutes,capture_mode,
         start_local_date,end_local_date,status,row_version,created_at_utc,updated_at_utc
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      regimen.id,
      regimen.name,
      regimen.localTime,
      regimen.timeZone,
      regimen.onTimeOffsetMinutes,
      regimen.recordOffsetMinutes,
      regimen.captureMode,
      regimen.startLocalDate,
      regimen.endLocalDate,
      regimen.status,
      regimen.rowVersion,
      regimen.createdAtUtc,
      regimen.updatedAtUtc,
    );
    for (const item of regimen.items) {
      await this.database.runAsync(
        `INSERT INTO regimen_items(id,regimen_id,medication_id,planned_dose_quantity,unit,sort_order)
         VALUES(?,?,?,?,?,?)`,
        item.id,
        item.regimenId,
        item.medicationId,
        item.plannedDoseQuantity,
        item.unit,
        item.sortOrder,
      );
    }
  }

  async getOccurrence(id: string): Promise<DoseOccurrence | null> {
    const row = await this.database.getFirstAsync<Row>(`SELECT * FROM dose_occurrences WHERE id=?`, id);
    return row ? this.mapOccurrence(row, await this.getOccurrenceItems(id)) : null;
  }

  async getOccurrenceByItemId(occurrenceItemId: string): Promise<DoseOccurrence | null> {
    const row = await this.database.getFirstAsync<{ occurrence_id: string }>(
      `SELECT occurrence_id FROM dose_occurrence_items WHERE id=?`,
      occurrenceItemId,
    );
    return row ? this.getOccurrence(row.occurrence_id) : null;
  }

  async findOccurrence(regimenId: string, localDate: string): Promise<DoseOccurrence | null> {
    const row = await this.database.getFirstAsync<{ id: string }>(
      `SELECT id FROM dose_occurrences WHERE regimen_id=? AND local_service_date=?`,
      regimenId,
      localDate,
    );
    return row ? this.getOccurrence(row.id) : null;
  }

  async listOccurrences(): Promise<DoseOccurrence[]> {
    const rows = await this.database.getAllAsync<{ id: string }>(
      `SELECT id FROM dose_occurrences ORDER BY scheduled_at_utc DESC`,
    );
    const values = await Promise.all(rows.map((row) => this.getOccurrence(row.id)));
    return values.filter((value): value is DoseOccurrence => value !== null);
  }

  async insertOccurrence(occurrence: DoseOccurrence): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO dose_occurrences(
         id,regimen_id,local_service_date,scheduled_at_utc,on_time_until_at_utc,
         record_until_at_utc,current_lifecycle,row_version,created_at_utc
       ) VALUES(?,?,?,?,?,?,?,?,?)`,
      occurrence.id,
      occurrence.regimenId,
      occurrence.localServiceDate,
      occurrence.scheduledAtUtc,
      occurrence.onTimeUntilAtUtc,
      occurrence.recordUntilAtUtc,
      occurrence.currentLifecycle,
      occurrence.rowVersion,
      occurrence.createdAtUtc,
    );
    for (const item of occurrence.items) {
      await this.database.runAsync(
        `INSERT INTO dose_occurrence_items(
           id,occurrence_id,regimen_item_id,medication_id,medication_display_name,
           planned_dose_quantity,unit,sort_order
         ) VALUES(?,?,?,?,?,?,?,?)`,
        item.id,
        item.occurrenceId,
        item.regimenItemId,
        item.medicationId,
        item.medicationDisplayName,
        item.plannedDoseQuantity,
        item.unit,
        item.sortOrder,
      );
      await this.database.runAsync(
        `INSERT INTO dose_item_current(
           occurrence_item_id,assertion,confirmed_consumption_quantity,active_fact_id,projection_version
         ) VALUES(?, 'pending', NULL, NULL, 1)`,
        item.id,
      );
    }
    await this.database.runAsync(
      `INSERT INTO dose_lifecycle_events(
         occurrence_id,from_state,to_state,reason_code,effective_at_utc,recorded_at_utc,command_id
       ) VALUES(?,NULL,'scheduled','materialized',?,?,?)`,
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
    effectiveAtUtc: UtcInstant,
    reasonCode: string,
  ): Promise<void> {
    const current = await this.database.getFirstAsync<{ current_lifecycle: string }>(
      `SELECT current_lifecycle FROM dose_occurrences WHERE id=?`,
      occurrenceId,
    );
    if (!current) throw new Error('occurrence not found');
    if (current.current_lifecycle === lifecycle) return;
    await this.database.runAsync(
      `UPDATE dose_occurrences SET current_lifecycle=?, row_version=row_version+1 WHERE id=?`,
      lifecycle,
      occurrenceId,
    );
    await this.database.runAsync(
      `INSERT OR IGNORE INTO dose_lifecycle_events(
         occurrence_id,from_state,to_state,reason_code,effective_at_utc,recorded_at_utc,command_id
       ) VALUES(?,?,?,?,?,?,?)`,
      occurrenceId,
      current.current_lifecycle,
      lifecycle,
      reasonCode,
      effectiveAtUtc,
      effectiveAtUtc,
      commandId,
    );
  }

  async insertPhotoEvidence(photo: PhotoEvidence): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO photo_evidence(
         id,occurrence_id,state,capture_mode,private_relative_path,skip_reason_code,
         captured_at_utc,deleted_at_utc,created_at_utc
       ) VALUES(?,?,?,?,?,?,?,?,?)`,
      photo.id,
      photo.occurrenceId,
      photo.state,
      photo.captureMode,
      photo.privateRelativePath,
      photo.skipReasonCode,
      photo.capturedAtUtc,
      photo.deletedAtUtc,
      photo.createdAtUtc,
    );
    for (const itemId of photo.linkedOccurrenceItemIds) {
      await this.database.runAsync(
        `INSERT INTO photo_item_links(photo_evidence_id, occurrence_item_id) VALUES(?,?)`,
        photo.id,
        itemId,
      );
    }
  }

  async listPhotoEvidence(occurrenceId: string): Promise<PhotoEvidence[]> {
    const rows = await this.database.getAllAsync<Row>(
      `SELECT * FROM photo_evidence WHERE occurrence_id=? ORDER BY created_at_utc`,
      occurrenceId,
    );
    return Promise.all(
      rows.map(async (row) => {
        const links = await this.database.getAllAsync<{ occurrence_item_id: string }>(
          `SELECT occurrence_item_id FROM photo_item_links WHERE photo_evidence_id=? ORDER BY occurrence_item_id`,
          String(row.id),
        );
        return this.mapPhoto(row, links.map((link) => link.occurrence_item_id));
      }),
    );
  }

  async insertCountObservation(observation: CountObservation): Promise<void> {
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

  async listCountObservations(occurrenceId: string): Promise<CountObservation[]> {
    const rows = await this.database.getAllAsync<Row>(
      `SELECT c.* FROM count_observations c
       JOIN photo_evidence p ON p.id=c.photo_evidence_id
       WHERE p.occurrence_id=? ORDER BY c.recorded_at_utc`,
      occurrenceId,
    );
    return rows.map((row) => ({
      id: String(row.id),
      photoEvidenceId: String(row.photo_evidence_id),
      status: String(row.status) as CountObservation['status'],
      detectedObjectCount:
        row.detected_object_count == null ? null : Number(row.detected_object_count),
      unableReasonCode: row.unable_reason_code == null ? null : String(row.unable_reason_code),
      source: String(row.source) as CountObservation['source'],
      algorithmVersion: String(row.algorithm_version),
      recordedAtUtc: String(row.recorded_at_utc),
    }));
  }

  async insertAssertionFact(fact: ConsumptionAssertionFact): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO consumption_assertion_facts(
         id,occurrence_item_id,assertion,confirmed_consumption_quantity,asserted_consumed_at_utc,
         recorded_at_utc,source,supersedes_fact_id,revision_group_id,command_id
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

  async getAssertionFact(factId: string): Promise<ConsumptionAssertionFact | null> {
    const row = await this.database.getFirstAsync<Row>(
      `SELECT * FROM consumption_assertion_facts WHERE id=?`,
      factId,
    );
    return row ? this.mapAssertionFact(row) : null;
  }

  async listAssertionFacts(occurrenceId: string): Promise<ConsumptionAssertionFact[]> {
    return (
      await this.database.getAllAsync<Row>(
        `SELECT f.* FROM consumption_assertion_facts f
         JOIN dose_occurrence_items i ON i.id=f.occurrence_item_id
         WHERE i.occurrence_id=? ORDER BY f.recorded_at_utc`,
        occurrenceId,
      )
    ).map((row) => this.mapAssertionFact(row));
  }

  async revokeAssertionFact(input: {
    id: string;
    factId: string;
    reasonCode: string;
    revisionGroupId: string | null;
    recordedAtUtc: string;
    commandId: string;
  }): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO fact_revocations(
         id,fact_id,reason_code,revision_group_id,recorded_at_utc,command_id
       ) VALUES(?,?,?,?,?,?)`,
      input.id,
      input.factId,
      input.reasonCode,
      input.revisionGroupId,
      input.recordedAtUtc,
      input.commandId,
    );
  }

  async isAssertionFactRevoked(factId: string): Promise<boolean> {
    return (
      (await this.database.getFirstAsync<{ present: number }>(
        `SELECT 1 AS present FROM fact_revocations WHERE fact_id=?`,
        factId,
      )) !== null
    );
  }

  async setItemCurrentFromFact(fact: ConsumptionAssertionFact): Promise<void> {
    await this.database.runAsync(
      `UPDATE dose_item_current
       SET assertion=?, confirmed_consumption_quantity=?, active_fact_id=?,
           projection_version=projection_version+1
       WHERE occurrence_item_id=?`,
      fact.assertion,
      fact.confirmedConsumptionQuantity,
      fact.id,
      fact.occurrenceItemId,
    );
  }

  async resetItemCurrent(occurrenceItemId: string): Promise<void> {
    await this.database.runAsync(
      `UPDATE dose_item_current
       SET assertion='pending', confirmed_consumption_quantity=NULL, active_fact_id=NULL,
           projection_version=projection_version+1
       WHERE occurrence_item_id=?`,
      occurrenceItemId,
    );
  }

  async hasMissedEvent(occurrenceId: string): Promise<boolean> {
    return (
      (await this.database.getFirstAsync<{ present: number }>(
        `SELECT 1 AS present FROM dose_item_missed_events m
         JOIN dose_occurrence_items i ON i.id=m.occurrence_item_id
         WHERE i.occurrence_id=? LIMIT 1`,
        occurrenceId,
      )) !== null
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
           occurrence_item_id,record_until_at_utc,recorded_at_utc
         ) VALUES(?,?,?)`,
        itemId,
        recordUntilAtUtc,
        recordedAtUtc,
      );
    }
  }

  async insertInventoryEntry(entry: InventoryLedgerEntry): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO inventory_ledger(
         id,medication_id,entry_type,quantity_delta,unit,source_fact_type,source_fact_id,
         reverses_entry_id,reason_code,effective_at_utc,recorded_at_utc,command_id
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      entry.id,
      entry.medicationId,
      entry.entryType,
      entry.quantityDelta,
      entry.unit,
      entry.sourceFactType,
      entry.sourceFactId,
      entry.reversesEntryId,
      entry.reasonCode,
      entry.effectiveAtUtc,
      entry.recordedAtUtc,
      entry.commandId,
    );
  }

  async findConsumptionEntry(factId: string): Promise<InventoryLedgerEntry | null> {
    const row = await this.database.getFirstAsync<Row>(
      `SELECT * FROM inventory_ledger
       WHERE source_fact_type='consumption_assertion' AND source_fact_id=? AND entry_type='consumption'`,
      factId,
    );
    return row ? this.mapLedger(row) : null;
  }

  async findReversalEntry(entryId: string): Promise<InventoryLedgerEntry | null> {
    const row = await this.database.getFirstAsync<Row>(
      `SELECT * FROM inventory_ledger WHERE reverses_entry_id=?`,
      entryId,
    );
    return row ? this.mapLedger(row) : null;
  }

  async listInventoryLedger(medicationId?: string): Promise<InventoryLedgerEntry[]> {
    const rows = medicationId
      ? await this.database.getAllAsync<Row>(
          `SELECT * FROM inventory_ledger WHERE medication_id=? ORDER BY recorded_at_utc,id`,
          medicationId,
        )
      : await this.database.getAllAsync<Row>(
          `SELECT * FROM inventory_ledger ORDER BY recorded_at_utc,id`,
        );
    return rows.map((row) => this.mapLedger(row));
  }

  async getProcessedCommand(commandType: string, idempotencyKey: string): Promise<ProcessedCommand | null> {
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

  async saveProcessedCommand(command: ProcessedCommand): Promise<void> {
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

  async getHistory(occurrenceId: string): Promise<HistoryEntry | null> {
    const occurrence = await this.getOccurrence(occurrenceId);
    if (!occurrence) return null;
    const medicationIds = new Set(occurrence.items.map((item) => item.medicationId));
    return {
      occurrence,
      photos: await this.listPhotoEvidence(occurrenceId),
      countObservations: await this.listCountObservations(occurrenceId),
      assertionFacts: await this.listAssertionFacts(occurrenceId),
      inventoryEntries: (await this.listInventoryLedger()).filter((entry) =>
        medicationIds.has(entry.medicationId),
      ),
    };
  }

  async clearAll(): Promise<void> {
    const tables = [
      'processed_commands',
      'inventory_ledger',
      'dose_item_missed_events',
      'fact_revocations',
      'consumption_assertion_facts',
      'count_observations',
      'photo_item_links',
      'photo_evidence',
      'dose_lifecycle_events',
      'dose_item_current',
      'dose_occurrence_items',
      'dose_occurrences',
      'regimen_items',
      'regimens',
      'medications',
      'demo_profile',
    ];
    for (const table of tables) await this.database.execAsync(`DELETE FROM ${table};`);
  }

  private async getRegimenItems(regimenId: string): Promise<RegimenItem[]> {
    return (
      await this.database.getAllAsync<Row>(
        `SELECT * FROM regimen_items WHERE regimen_id=? ORDER BY sort_order`,
        regimenId,
      )
    ).map((row) => ({
      id: String(row.id),
      regimenId: String(row.regimen_id),
      medicationId: String(row.medication_id),
      plannedDoseQuantity: String(row.planned_dose_quantity) as RegimenItem['plannedDoseQuantity'],
      unit: String(row.unit) as RegimenItem['unit'],
      sortOrder: Number(row.sort_order),
    }));
  }

  private async getOccurrenceItems(occurrenceId: string): Promise<DoseOccurrenceItem[]> {
    return (
      await this.database.getAllAsync<Row>(
        `SELECT i.*,c.assertion,c.confirmed_consumption_quantity,c.active_fact_id
         FROM dose_occurrence_items i JOIN dose_item_current c ON c.occurrence_item_id=i.id
         WHERE i.occurrence_id=? ORDER BY i.sort_order`,
        occurrenceId,
      )
    ).map((row) => ({
      id: String(row.id),
      occurrenceId: String(row.occurrence_id),
      regimenItemId: String(row.regimen_item_id),
      medicationId: String(row.medication_id),
      medicationDisplayName: String(row.medication_display_name),
      plannedDoseQuantity: String(row.planned_dose_quantity) as DoseOccurrenceItem['plannedDoseQuantity'],
      unit: String(row.unit) as DoseOccurrenceItem['unit'],
      sortOrder: Number(row.sort_order),
      assertion: String(row.assertion) as DoseOccurrenceItem['assertion'],
      confirmedConsumptionQuantity:
        row.confirmed_consumption_quantity == null
          ? null
          : (String(row.confirmed_consumption_quantity) as DoseOccurrenceItem['confirmedConsumptionQuantity']),
      activeFactId: row.active_fact_id == null ? null : String(row.active_fact_id),
    }));
  }

  private mapMedication(row: Row): Medication {
    return {
      id: String(row.id),
      displayName: String(row.display_name),
      dosageForm: String(row.dosage_form) as Medication['dosageForm'],
      inventoryUnit: String(row.inventory_unit) as Medication['inventoryUnit'],
      status: String(row.status) as Medication['status'],
      createdAtUtc: String(row.created_at_utc),
    };
  }

  private mapRegimen(row: Row, items: RegimenItem[]): Regimen {
    return {
      id: String(row.id),
      name: String(row.name),
      localTime: String(row.local_time),
      timeZone: String(row.time_zone),
      onTimeOffsetMinutes: Number(row.on_time_offset_minutes),
      recordOffsetMinutes: Number(row.record_offset_minutes),
      captureMode: String(row.capture_mode) as Regimen['captureMode'],
      startLocalDate: String(row.start_local_date),
      endLocalDate: row.end_local_date == null ? null : String(row.end_local_date),
      status: String(row.status) as Regimen['status'],
      rowVersion: Number(row.row_version),
      items,
      createdAtUtc: String(row.created_at_utc),
      updatedAtUtc: String(row.updated_at_utc),
    };
  }

  private mapOccurrence(row: Row, items: DoseOccurrenceItem[]): DoseOccurrence {
    return {
      id: String(row.id),
      regimenId: String(row.regimen_id),
      localServiceDate: String(row.local_service_date),
      scheduledAtUtc: String(row.scheduled_at_utc),
      onTimeUntilAtUtc: String(row.on_time_until_at_utc),
      recordUntilAtUtc: String(row.record_until_at_utc),
      currentLifecycle: String(row.current_lifecycle) as DoseOccurrence['currentLifecycle'],
      rowVersion: Number(row.row_version),
      items,
      createdAtUtc: String(row.created_at_utc),
    };
  }

  private mapPhoto(row: Row, linkedOccurrenceItemIds: string[]): PhotoEvidence {
    return {
      id: String(row.id),
      occurrenceId: String(row.occurrence_id),
      state: String(row.state) as PhotoEvidence['state'],
      captureMode: String(row.capture_mode) as PhotoEvidence['captureMode'],
      privateRelativePath:
        row.private_relative_path == null ? null : String(row.private_relative_path),
      skipReasonCode: row.skip_reason_code == null ? null : String(row.skip_reason_code),
      capturedAtUtc: row.captured_at_utc == null ? null : String(row.captured_at_utc),
      deletedAtUtc: row.deleted_at_utc == null ? null : String(row.deleted_at_utc),
      linkedOccurrenceItemIds,
      createdAtUtc: String(row.created_at_utc),
    };
  }

  private mapAssertionFact(row: Row): ConsumptionAssertionFact {
    return {
      id: String(row.id),
      occurrenceItemId: String(row.occurrence_item_id),
      assertion: String(row.assertion) as ConsumptionAssertionFact['assertion'],
      confirmedConsumptionQuantity: String(
        row.confirmed_consumption_quantity,
      ) as ConsumptionAssertionFact['confirmedConsumptionQuantity'],
      assertedConsumedAtUtc:
        row.asserted_consumed_at_utc == null ? null : String(row.asserted_consumed_at_utc),
      recordedAtUtc: String(row.recorded_at_utc),
      source: String(row.source) as ConsumptionAssertionFact['source'],
      supersedesFactId: row.supersedes_fact_id == null ? null : String(row.supersedes_fact_id),
      revisionGroupId: row.revision_group_id == null ? null : String(row.revision_group_id),
      commandId: String(row.command_id),
    };
  }

  private mapLedger(row: Row): InventoryLedgerEntry {
    return {
      id: String(row.id),
      medicationId: String(row.medication_id),
      entryType: String(row.entry_type) as InventoryLedgerEntry['entryType'],
      quantityDelta: String(row.quantity_delta) as InventoryLedgerEntry['quantityDelta'],
      unit: String(row.unit) as InventoryLedgerEntry['unit'],
      sourceFactType: String(row.source_fact_type) as InventoryLedgerEntry['sourceFactType'],
      sourceFactId: String(row.source_fact_id),
      reversesEntryId: row.reverses_entry_id == null ? null : String(row.reverses_entry_id),
      reasonCode: row.reason_code == null ? null : String(row.reason_code),
      effectiveAtUtc: String(row.effective_at_utc),
      recordedAtUtc: String(row.recorded_at_utc),
      commandId: String(row.command_id),
    };
  }
}
