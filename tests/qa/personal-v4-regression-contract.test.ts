import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { filterHistory } from '../../src/features/historyFilters';
import type { OccurrenceView } from '../../src/features/medicationAppApi';

function occurrence(overrides: Partial<OccurrenceView> = {}): OccurrenceView {
  return {
    id: 'occurrence-1',
    localServiceDate: '2026-08-25',
    plannedAt: '2026-08-25T08:00:00.000Z',
    onTimeUntilAt: '2026-08-25T09:00:00.000Z',
    recordUntilAt: '2026-08-25T20:00:00.000Z',
    lifecycle: 'scheduled',
    preparedAt: null,
    completedAt: null,
    photo: null,
    photos: [],
    items: [{
      id: 'item-1', medicationId: 'med-1', displayName: '药物 A', quantityUnit: 'count',
      plannedDoseQuantity: 1, assertion: 'pending', confirmedConsumptionQuantity: null,
      confirmedAt: null, revisions: [],
    }],
    ...overrides,
  };
}

describe('QA: personal schema runtime and clear contract', () => {
  it('keeps app config and runtime on v6 while retaining the v4 migration', () => {
    const appJson = JSON.parse(readFileSync(resolve('app.json'), 'utf8'));
    const runtime = readFileSync(
      resolve('src/infrastructure/runtime/securePersonalDatabase.ts'),
      'utf8',
    );
    const migration = readFileSync(
      resolve('src/infrastructure/storage/migrations/v4.ts'),
      'utf8',
    );

    expect(appJson.expo.extra.storageSchemaVersion).toBe(6);
    expect(runtime).toContain('initializePersonalDatabaseV6');
    expect(runtime).toContain('initialize: initializePersonalDatabaseV6');
    expect(migration).toContain('PERSONAL_SCHEMA_VERSION_V4 = 4');
    expect(migration).toContain('PRAGMA user_version = ${PERSONAL_SCHEMA_VERSION_V4}');
  });

  it('clears the entire v4 store instead of leaving table-level remnants', () => {
    const runtime = readFileSync(
      resolve('src/infrastructure/runtime/createDemoRuntime.ts'),
      'utf8',
    );
    const secureDatabase = readFileSync(
      resolve('src/infrastructure/runtime/securePersonalDatabase.ts'),
      'utf8',
    );

    expect(runtime).toContain('await reminders.clearAll()');
    expect(runtime).toContain('await secure.media.clearAll()');
    expect(runtime).toContain('await secure.destroyAfterExplicitDataClear()');
    expect(secureDatabase).toContain("databaseUri('-wal')");
    expect(secureDatabase).toContain("databaseUri('-shm')");
    expect(secureDatabase).toContain('await dependencies.keyProvider.markExplicitDataClearPending()');
    expect(secureDatabase).toContain('await dependencies.keyProvider.destroyAfterExplicitDataClear()');
  });

  it('rebuilds the runtime only after destructive clear succeeds and gates failures', () => {
    const layout = readFileSync(resolve('app/_layout.tsx'), 'utf8');

    expect(layout).toContain('await runtime.api.clearAll()');
    expect(layout).toContain('if (mounted) setAttempt((value) => value + 1)');
    expect(layout).toContain('setRuntimeState({');
    expect(layout).toContain('status: "failed"');
    expect(layout.indexOf('await runtime.api.clearAll()')).toBeLessThan(
      layout.indexOf('if (mounted) setAttempt((value) => value + 1)'),
    );
  });
});

describe('QA: actual history filtering', () => {
  it('hides schedule-only old states while retaining photo, revision and missed facts', () => {
    const scheduleOnly = [
      occurrence({ id: 'scheduled', lifecycle: 'scheduled' }),
      occurrence({ id: 'due', lifecycle: 'due' }),
      occurrence({ id: 'prepared-without-evidence', lifecycle: 'prepared' }),
    ];
    const skippedPhoto = {
      id: 'photo-skip', occurrenceId: 'prepared-with-skip', state: 'skipped_with_reason' as const,
      capturePurpose: 'initial' as const, capturedAt: '2026-08-25T08:01:00.000Z',
      skipReason: 'camera_unavailable' as const, detectedObjectCount: null, countSource: null,
    };
    const actual = [
      occurrence({
        id: 'prepared-with-skip', lifecycle: 'prepared', photo: skippedPhoto,
        photos: [skippedPhoto],
      }),
      occurrence({
        id: 'revised',
        items: [{
          ...occurrence().items[0]!,
          revisions: [{
            at: '2026-08-25T08:02:00.000Z', previousAssertion: 'not_taken',
            previousQuantity: 0, reason: 'correction',
          }],
        }],
      }),
      occurrence({ id: 'missed', lifecycle: 'missed' }),
    ];

    const result = filterHistory(
      [...scheduleOnly, ...actual],
      { dateRange: 'all', medicationId: null, result: null },
      new Date('2026-08-26T00:00:00.000Z'),
    );
    expect(result.map((item) => item.id).sort()).toEqual(
      ['missed', 'prepared-with-skip', 'revised'].sort(),
    );
  });
});

describe('QA: notification click routing contract', () => {
  it('reconciles an occurrence before routing and sends auxiliary kinds to fixed neutral tabs', () => {
    const layout = readFileSync(resolve('app/_layout.tsx'), 'utf8');

    expect(layout).toContain('await medicationAppApi.reconcileToday().catch(() => undefined)');
    expect(layout).toContain('.find((candidate) => candidate.id === occurrenceId)');
    expect(layout).toContain('const destination = resolveOccurrenceEntry(occurrence)');
    expect(layout).toContain('router.push(occurrenceEntryPath(occurrenceId, destination))');
    expect(layout).toContain('router.replace("/(tabs)")');
    for (const kind of ['refill', 'follow_up_advance', 'follow_up_due']) {
      expect(layout).toContain(`auxiliaryKind === "${kind}"`);
    }
    expect(layout).toContain('router.replace("/(tabs)/followups" as never)');
  });

  it('keeps occurrence IDs opaque and rejects malformed notification identifiers', () => {
    const layout = readFileSync(resolve('app/_layout.tsx'), 'utf8');
    expect(layout).toContain('/^[a-z0-9-]{8,80}$/.test(occurrenceId)');
    expect(layout).not.toMatch(/medicationName|plannedDoseQuantity|diseaseName/);
  });
});
