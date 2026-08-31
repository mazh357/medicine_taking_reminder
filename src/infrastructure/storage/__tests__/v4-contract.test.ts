import { describe, expect, it } from 'vitest';

import type { SqlDatabase, SqlRunResult, SqlValue } from '../database';
import {
  initializePersonalDatabaseV4,
  PERSONAL_SCHEMA_VERSION_V4,
  PERSONAL_V4_CHECKSUM,
  PERSONAL_V4_SCHEMA,
} from '../migrations/v4';

class MigrationDatabase implements SqlDatabase {
  readonly execCalls: string[] = [];
  readonly runCalls: { sql: string; params: SqlValue[] }[] = [];

  constructor(private version: number) {}

  async execAsync(sql: string): Promise<void> {
    this.execCalls.push(sql);
    const match = /PRAGMA user_version\s*=\s*(\d+)/.exec(sql);
    if (match) this.version = Number(match[1]);
  }

  async runAsync(sql: string, ...params: SqlValue[]): Promise<SqlRunResult> {
    this.runCalls.push({ sql, params });
    return { changes: 1 };
  }

  async getFirstAsync<T>(sql: string): Promise<T | null> {
    return sql === 'PRAGMA user_version' ? ({ user_version: this.version } as T) : null;
  }

  async getAllAsync<T>(): Promise<T[]> {
    return [];
  }

  async withTransactionAsync<T>(operation: () => Promise<T>): Promise<T> {
    return operation();
  }
}

describe('personal SQLite schema v4 contract', () => {
  it('migrates v3 in place, seeds existing medications at seven days and enables WAL/FKs', async () => {
    const database = new MigrationDatabase(3);
    await initializePersonalDatabaseV4(database, '2026-08-26T00:00:00.000Z');

    expect(PERSONAL_SCHEMA_VERSION_V4).toBe(4);
    expect(database.execCalls.slice(0, 2)).toEqual([
      'PRAGMA foreign_keys = ON;',
      'PRAGMA journal_mode = WAL;',
    ]);
    expect(database.execCalls).toContain(PERSONAL_V4_SCHEMA);
    expect(database.execCalls).toContain('PRAGMA user_version = 4;');
    expect(database.execCalls.join('\n')).not.toMatch(/DROP TABLE|ALTER TABLE/);
    expect(database.runCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sql: expect.stringContaining('SELECT id,7,?,1 FROM medications'),
          params: ['2026-08-26T00:00:00.000Z'],
        }),
        expect.objectContaining({
          params: [4, 'personal_v4', PERSONAL_V4_CHECKSUM, '2026-08-26T00:00:00.000Z'],
        }),
      ]),
    );
  });

  it('contains constrained forecast, follow-up audit and rebuildable auxiliary reminder tables', () => {
    for (const table of [
      'inventory_forecast_preferences',
      'follow_up_items',
      'follow_up_item_events',
      'auxiliary_reminder_intents',
      'auxiliary_reminder_projections',
    ]) {
      expect(PERSONAL_V4_SCHEMA).toContain(`TABLE IF NOT EXISTS ${table}`);
    }
    expect(PERSONAL_V4_SCHEMA).toContain('lead_days IN (3,7,14,30)');
    expect(PERSONAL_V4_SCHEMA).toContain('advance_days IN (1,3,7)');
    expect(PERSONAL_V4_SCHEMA).toContain("type IN ('follow_up','refill','test')");
    expect(PERSONAL_V4_SCHEMA).toContain(
      "kind IN ('refill','follow_up_advance','follow_up_due')",
    );
    expect(PERSONAL_V4_SCHEMA).toContain('idx_follow_up_open_due');
    expect(PERSONAL_V4_SCHEMA).toContain('idx_auxiliary_intents_trigger');
    expect(PERSONAL_V4_SCHEMA).toContain(
      'medication_id TEXT REFERENCES medications(id) ON DELETE RESTRICT',
    );
    expect(PERSONAL_V4_SCHEMA).toContain(
      'follow_up_item_id TEXT REFERENCES follow_up_items(id) ON DELETE RESTRICT',
    );
  });
});
