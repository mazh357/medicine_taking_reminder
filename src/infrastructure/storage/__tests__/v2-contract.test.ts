import { describe, expect, it } from 'vitest';

import {
  initializePersonalDatabaseV2,
  LegacyDemoResetRequiredError,
  PERSONAL_SCHEMA_VERSION,
  PERSONAL_V2_SCHEMA,
} from '../migrations/v2';
import type { SqlDatabase, SqlRunResult, SqlValue } from '../database';

class MigrationDatabase implements SqlDatabase {
  readonly execCalls: string[] = [];
  readonly runCalls: { sql: string; params: SqlValue[] }[] = [];
  transactions = 0;

  constructor(private userVersion: number) {}

  async execAsync(sql: string): Promise<void> {
    this.execCalls.push(sql);
    const match = /PRAGMA user_version\s*=\s*(\d+)/.exec(sql);
    if (match) this.userVersion = Number(match[1]);
  }

  async runAsync(sql: string, ...params: SqlValue[]): Promise<SqlRunResult> {
    this.runCalls.push({ sql, params });
    return { changes: 1 };
  }

  async getFirstAsync<T>(sql: string): Promise<T | null> {
    if (sql === 'PRAGMA user_version') return { user_version: this.userVersion } as T;
    return null;
  }

  async getAllAsync<T>(): Promise<T[]> {
    return [];
  }

  async withTransactionAsync<T>(operation: () => Promise<T>): Promise<T> {
    this.transactions += 1;
    return operation();
  }
}

describe('personal SQLite schema v2 contract', () => {
  it('creates an empty v2 database after foreign-key and WAL setup', async () => {
    const database = new MigrationDatabase(0);
    await initializePersonalDatabaseV2(database, '2026-08-25T00:00:00.000Z');

    expect(PERSONAL_SCHEMA_VERSION).toBe(2);
    expect(database.execCalls.slice(0, 2)).toEqual([
      'PRAGMA foreign_keys = ON;',
      'PRAGMA journal_mode = WAL;',
    ]);
    expect(database.transactions).toBe(1);
    expect(database.execCalls).toContain(PERSONAL_V2_SCHEMA);
    expect(database.execCalls).toContain('PRAGMA user_version = 2;');
  });

  it('refuses schema v1 instead of importing Demo business data', async () => {
    const database = new MigrationDatabase(1);
    await expect(
      initializePersonalDatabaseV2(database, '2026-08-25T00:00:00.000Z'),
    ).rejects.toBeInstanceOf(LegacyDemoResetRequiredError);
    expect(database.transactions).toBe(0);
    expect(database.execCalls).not.toContain(PERSONAL_V2_SCHEMA);
  });

  it('contains the personal profile, version history, reminder projection and tombstone tables', () => {
    for (const table of [
      'app_profile',
      'app_preferences',
      'regimen_versions',
      'regimen_revision_events',
      'reminder_intents',
      'reminder_projections',
      'photo_evidence',
      'count_observations',
      'consumption_assertion_facts',
      'fact_revocations',
      'dose_item_missed_resolutions',
      'inventory_ledger',
      'processed_commands',
    ]) {
      expect(PERSONAL_V2_SCHEMA).toContain(`TABLE IF NOT EXISTS ${table}`);
    }
    expect(PERSONAL_V2_SCHEMA).toContain("quantity_unit='count'");
    expect(PERSONAL_V2_SCHEMA).not.toMatch(/'tablet'|'capsule'/);
    expect(PERSONAL_V2_SCHEMA).toContain('detected_object_count');
    expect(PERSONAL_V2_SCHEMA).toContain('planned_dose_quantity');
    expect(PERSONAL_V2_SCHEMA).toContain('confirmed_consumption_quantity');
    expect(PERSONAL_V2_SCHEMA).toContain("state='deleted_tombstone'");
  });
});
