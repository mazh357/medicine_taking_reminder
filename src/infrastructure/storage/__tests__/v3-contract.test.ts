import { describe, expect, it } from 'vitest';

import type { SqlDatabase, SqlRunResult, SqlValue } from '../database';
import {
  initializePersonalDatabaseV3,
  PERSONAL_SCHEMA_VERSION_V3,
  PERSONAL_V3_CHECKSUM,
} from '../migrations/v3';

class MigrationDatabase implements SqlDatabase {
  readonly execCalls: string[] = [];
  readonly runCalls: { sql: string; params: SqlValue[] }[] = [];
  constructor(private version: number) {}
  async execAsync(sql: string) {
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
  async getAllAsync<T>(): Promise<T[]> { return []; }
  async withTransactionAsync<T>(operation: () => Promise<T>): Promise<T> { return operation(); }
}

describe('personal SQLite schema v3 contract', () => {
  it('adds a non-null photo purpose and records the migration without clearing v2 data', async () => {
    const database = new MigrationDatabase(2);
    await initializePersonalDatabaseV3(database, '2026-08-26T00:00:00.000Z');
    expect(PERSONAL_SCHEMA_VERSION_V3).toBe(3);
    expect(database.execCalls.join('\n')).toContain('ADD COLUMN capture_purpose');
    expect(database.execCalls.join('\n')).toContain("DEFAULT 'initial'");
    expect(database.execCalls).toContain('PRAGMA user_version = 3;');
    expect(database.runCalls[0]?.params).toEqual([3, 'personal_v3', PERSONAL_V3_CHECKSUM, '2026-08-26T00:00:00.000Z']);
    expect(database.execCalls.join('\n')).not.toContain('DROP TABLE');
  });
});
