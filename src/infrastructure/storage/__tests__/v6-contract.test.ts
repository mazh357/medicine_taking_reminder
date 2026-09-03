import { describe, expect, it } from 'vitest';

import type { SqlDatabase, SqlRunResult, SqlValue } from '../database';
import {
  initializePersonalDatabaseV6,
  PERSONAL_SCHEMA_VERSION_V6,
  PERSONAL_V6_CHECKSUM,
  PERSONAL_V6_SCHEMA,
} from '../migrations/v6';

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

describe('personal SQLite schema v6 contract', () => {
  it('upgrades v5 in place without rewriting medication, schedule, history, or vision rows', async () => {
    const database = new MigrationDatabase(5);
    const now = '2026-09-02T00:00:00.000Z';
    await initializePersonalDatabaseV6(database, now);

    expect(PERSONAL_SCHEMA_VERSION_V6).toBe(6);
    expect(database.execCalls.slice(0, 2)).toEqual([
      'PRAGMA foreign_keys = ON;',
      'PRAGMA journal_mode = WAL;',
    ]);
    expect(database.execCalls).toContain(PERSONAL_V6_SCHEMA);
    expect(database.execCalls).toContain('PRAGMA user_version = 6;');
    expect(PERSONAL_V6_SCHEMA).not.toMatch(/DROP TABLE|DELETE FROM|UPDATE\s+(medications|regimens)/i);
    expect(database.runCalls).toContainEqual({
      sql: 'INSERT INTO migration_journal(version,name,checksum,applied_at_utc) VALUES(?,?,?,?)',
      params: [6, 'personal_v6', PERSONAL_V6_CHECKSUM, now],
    });
  });

  it('adds an append-only retirement fact and nullable legacy-compatible projections', () => {
    expect(PERSONAL_V6_SCHEMA).toContain(
      'ALTER TABLE medications ADD COLUMN status_effective_local_date TEXT',
    );
    expect(PERSONAL_V6_SCHEMA).toContain(
      'ALTER TABLE regimens ADD COLUMN retirement_effective_local_date TEXT',
    );
    expect(PERSONAL_V6_SCHEMA).toContain('CREATE TABLE regimen_retirement_facts');
    expect(PERSONAL_V6_SCHEMA).toContain('UNIQUE(regimen_id)');
    expect(PERSONAL_V6_SCHEMA).toContain(
      'regimen_id TEXT NOT NULL REFERENCES regimens(id) ON DELETE RESTRICT',
    );
  });

  it('is a no-op when v6 is already installed', async () => {
    const database = new MigrationDatabase(6);
    await initializePersonalDatabaseV6(database, '2026-09-02T00:00:00.000Z');
    expect(database.execCalls).not.toContain(PERSONAL_V6_SCHEMA);
    expect(database.runCalls).toHaveLength(0);
  });
});
