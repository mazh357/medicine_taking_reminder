interface Clearable {
  clearAll(): Promise<void>;
}

/** External evidence/projections must be gone before their SQLite references. */
export async function clearExternalDataBeforeDatabase(
  media: Clearable,
  reminders: Clearable,
  clearDatabase: () => Promise<void>,
): Promise<void> {
  await Promise.all([media.clearAll(), reminders.clearAll()]);
  await clearDatabase();
}
