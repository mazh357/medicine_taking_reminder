import type { OccurrenceView } from './medicationAppApi';

export type OccurrenceEntryDestination =
  | 'confirm_early'
  | 'capture'
  | 'confirm'
  | 'history';

export function resolveOccurrenceEntry(
  occurrence: OccurrenceView,
  nowMs = Date.now(),
): OccurrenceEntryDestination {
  const complete = occurrence.items.every((item) => item.assertion !== 'pending');
  if (occurrence.lifecycle === 'revoked' || complete) return 'history';
  if (
    occurrence.lifecycle === 'scheduled' &&
    nowMs < Date.parse(occurrence.plannedAt)
  ) {
    return 'confirm_early';
  }
  if (
    occurrence.lifecycle === 'prepared' ||
    occurrence.photo?.state === 'captured' ||
    occurrence.photo?.state === 'skipped_with_reason'
  ) {
    return 'confirm';
  }
  return 'capture';
}

export function occurrenceEntryPath(
  occurrenceId: string,
  destination: Exclude<OccurrenceEntryDestination, 'confirm_early'>,
): `/history/${string}` | `/task/${string}/confirm` | `/task/${string}/capture` {
  if (destination === 'history') return `/history/${occurrenceId}`;
  if (destination === 'confirm') return `/task/${occurrenceId}/confirm`;
  return `/task/${occurrenceId}/capture`;
}
