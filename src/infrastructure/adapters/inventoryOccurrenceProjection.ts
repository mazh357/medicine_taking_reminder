type LinkableLedgerEntry = {
  id: string;
  entryType: string;
  sourceFactType: string;
  sourceFactId: string;
  reversesEntryId: string | null;
};

type LinkableHistoryEntry = {
  occurrence: { id: string };
  assertionFacts: { id: string }[];
};

/** Resolves ledger entries back to occurrences without changing ledger facts. */
export function projectLedgerOccurrenceIds(
  ledger: LinkableLedgerEntry[],
  histories: (LinkableHistoryEntry | null)[],
): Map<string, string> {
  const occurrenceByFactId = new Map<string, string>();
  for (const history of histories) {
    if (!history) continue;
    for (const fact of history.assertionFacts) {
      occurrenceByFactId.set(fact.id, history.occurrence.id);
    }
  }
  const entryById = new Map(ledger.map((entry) => [entry.id, entry]));
  const memo = new Map<string, string>();

  const resolve = (entry: LinkableLedgerEntry, visited: Set<string>): string | undefined => {
    const cached = memo.get(entry.id);
    if (cached) return cached;
    if (visited.has(entry.id)) return undefined;
    visited.add(entry.id);

    let occurrenceId: string | undefined;
    if (entry.sourceFactType === 'consumption_assertion') {
      occurrenceId = occurrenceByFactId.get(entry.sourceFactId);
    } else if (entry.entryType === 'reversal') {
      const originalId = entry.reversesEntryId ?? entry.sourceFactId;
      const original = entryById.get(originalId);
      if (original) occurrenceId = resolve(original, visited);
    }
    if (occurrenceId) memo.set(entry.id, occurrenceId);
    return occurrenceId;
  };

  for (const entry of ledger) resolve(entry, new Set());
  return memo;
}
