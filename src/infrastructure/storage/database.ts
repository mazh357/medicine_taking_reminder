export type SqlValue = string | number | null | Uint8Array;

export interface SqlRunResult {
  changes: number;
  lastInsertRowId?: number;
}

export interface SqlDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: SqlValue[]): Promise<SqlRunResult>;
  getFirstAsync<T>(sql: string, ...params: SqlValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: SqlValue[]): Promise<T[]>;
  withTransactionAsync<T>(operation: () => Promise<T>): Promise<T>;
}

export interface ExpoSQLiteDatabaseLike {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: SqlValue[]): Promise<{ changes: number; lastInsertRowId?: number }>;
  getFirstAsync<T>(sql: string, ...params: SqlValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: SqlValue[]): Promise<T[]>;
  withTransactionAsync(operation: () => Promise<void>): Promise<void>;
}

/** Keeps expo-sqlite behind an injectable boundary so domain tests do not load native code. */
export function adaptExpoSQLite(database: ExpoSQLiteDatabaseLike): SqlDatabase {
  return {
    execAsync: (sql) => database.execAsync(sql),
    runAsync: (sql, ...params) => database.runAsync(sql, ...params),
    getFirstAsync: (sql, ...params) => database.getFirstAsync(sql, ...params),
    getAllAsync: (sql, ...params) => database.getAllAsync(sql, ...params),
    withTransactionAsync: async <T>(operation: () => Promise<T>) => {
      let result: T | undefined;
      await database.withTransactionAsync(async () => {
        result = await operation();
      });
      return result as T;
    },
  };
}
