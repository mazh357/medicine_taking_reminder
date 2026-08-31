import type { MedicationRepository, MedicationUnitOfWork } from '../../application';
import type { SqlDatabase } from './database';
import { SqliteMedicationRepository } from './SqliteMedicationRepository';

export class SqliteMedicationUnitOfWork implements MedicationUnitOfWork {
  constructor(private readonly database: SqlDatabase) {}

  run<T>(operation: (repository: MedicationRepository) => Promise<T>): Promise<T> {
    return this.database.withTransactionAsync(() =>
      operation(new SqliteMedicationRepository(this.database)),
    );
  }
}
