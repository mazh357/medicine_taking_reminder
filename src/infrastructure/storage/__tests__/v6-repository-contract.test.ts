import { describe, expect, it } from 'vitest';

import type { SqlDatabase, SqlRunResult, SqlValue } from '../database';
import { SqliteMedicationRepository } from '../SqliteMedicationRepository';

class RecordingDatabase implements SqlDatabase {
  readonly runCalls: { sql: string; params: SqlValue[] }[] = [];
  readonly allCalls: { sql: string; params: SqlValue[] }[] = [];

  async execAsync(): Promise<void> {}

  async runAsync(sql: string, ...params: SqlValue[]): Promise<SqlRunResult> {
    this.runCalls.push({ sql, params });
    return { changes: 1 };
  }

  async getFirstAsync<T>(): Promise<T | null> {
    return null;
  }

  async getAllAsync<T>(sql: string, ...params: SqlValue[]): Promise<T[]> {
    this.allCalls.push({ sql, params });
    return [];
  }

  async withTransactionAsync<T>(operation: () => Promise<T>): Promise<T> {
    return operation();
  }
}

describe('personal v6 repository contract', () => {
  it('persists medication status with an effective date and optimistic version', async () => {
    const database = new RecordingDatabase();
    const repository = new SqliteMedicationRepository(database);
    await repository.setMedicationStatus({
      medicationId: 'medication-1',
      status: 'inactive',
      effectiveLocalDate: '2026-09-03',
      expectedRowVersion: 4,
      updatedAtUtc: '2026-09-02T10:00:00.000Z',
    });

    expect(database.runCalls[0]?.sql).toContain('status_effective_local_date=?');
    expect(database.runCalls[0]?.params).toEqual([
      'inactive',
      '2026-09-03',
      '2026-09-02T10:00:00.000Z',
      'medication-1',
      4,
    ]);
  });

  it('appends a retirement fact before updating its regimen projection', async () => {
    const database = new RecordingDatabase();
    const repository = new SqliteMedicationRepository(database);
    await repository.retireRegimen(
      {
        regimenId: 'regimen-1',
        effectiveLocalDate: '2026-09-03',
        recordedAtUtc: '2026-09-02T10:00:00.000Z',
        commandId: 'command-retire',
      },
      2,
      '2026-09-02T10:00:00.000Z',
    );

    expect(database.runCalls).toHaveLength(2);
    expect(database.runCalls[0]?.sql).toContain('INSERT INTO regimen_retirement_facts');
    expect(database.runCalls[0]?.params).toEqual([
      'command-retire',
      'regimen-1',
      '2026-09-03',
      '2026-09-02T10:00:00.000Z',
    ]);
    expect(database.runCalls[1]?.sql).toContain('retirement_effective_local_date=?');
    expect(database.runCalls[1]?.params).toEqual([
      '2026-09-03',
      '2026-09-02T10:00:00.000Z',
      'regimen-1',
      2,
    ]);
  });

  it('filters forecasts by global status, schedule status, and retirement date', async () => {
    const database = new RecordingDatabase();
    const repository = new SqliteMedicationRepository(database);
    await repository.listActiveDailyPlansForMedication('medication-1', '2026-09-02');

    const query = database.allCalls[0]?.sql ?? '';
    expect(query).toContain('JOIN medications m');
    expect(query).toContain('r.status_effective_local_date');
    expect(query).toContain('r.retirement_effective_local_date');
    expect(query).toContain('m.status_effective_local_date');
    expect(database.allCalls[0]?.params).toEqual([
      'medication-1',
      '2026-09-02',
      '2026-09-02',
      '2026-09-02',
      '2026-09-02',
      '2026-09-02',
      '2026-09-02',
      '2026-09-02',
    ]);
  });
});
