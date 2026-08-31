import type { DemoRepository, UnitOfWork } from '../../application';
import type { SqlDatabase } from './database';
import { SqliteDemoRepository } from './SqliteDemoRepository';

export class SqliteUnitOfWork implements UnitOfWork {
  constructor(private readonly database: SqlDatabase) {}

  run<T>(operation: (repository: DemoRepository) => Promise<T>): Promise<T> {
    return this.database.withTransactionAsync(() =>
      operation(new SqliteDemoRepository(this.database)),
    );
  }
}
