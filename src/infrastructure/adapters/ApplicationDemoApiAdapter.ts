import type { DemoApplicationService, UnitOfWork, WriteCommand } from '../../application';
import {
  signedQuantityToMilliunits,
  type DoseOccurrence,
  type HistoryEntry,
} from '../../domain';
import type {
  DemoApi,
  DemoCountResult,
  DemoDoseItem,
  DemoInventoryEntry,
  DemoMedication,
  DemoNotificationState,
  DemoOccurrence,
  DemoPhotoEvidence,
  DemoSnapshot,
  ItemConsumptionAssertion,
  NewMedicationInput,
} from '../../features/demoApi';
import type { PrivateMediaStore } from '../media';
import type {
  LocalReminderService,
  NotificationCapability,
  NotificationScheduleResult,
} from '../notifications';
import { clearExternalDataBeforeDatabase } from './clearDemoData';
import type { DemoPillCounterAdapter } from './DemoPillCounterAdapter';
import { projectLedgerOccurrenceIds } from './inventoryOccurrenceProjection';

export class DemoIntegrationError extends Error {
  constructor(readonly code: 'NOT_IMPLEMENTED' | 'APPLICATION_REJECTED', message: string) {
    super(message);
    this.name = 'DemoIntegrationError';
  }
}

interface AdapterDependencies {
  application: DemoApplicationService;
  unitOfWork: UnitOfWork;
  media: PrivateMediaStore;
  counter: DemoPillCounterAdapter;
  reminders: LocalReminderService;
  nextId(): string;
  now(): Date;
}

const emptySnapshot = (): DemoSnapshot => ({
  safetyNoticeAccepted: false,
  medications: [],
  occurrences: [],
  inventoryLedger: [],
});

const quantityNumber = (value: string | null): number | null =>
  value === null ? null : Number(value);

export class ApplicationDemoApiAdapter implements DemoApi {
  private snapshot: DemoSnapshot = emptySnapshot();
  private readonly listeners = new Set<() => void>();
  private writeQueue: Promise<void> = Promise.resolve();
  private lastNotificationCapability: NotificationCapability | null = null;
  private lastNotificationScheduleResult: NotificationScheduleResult | null = null;

  constructor(private readonly dependencies: AdapterDependencies) {}

  getSnapshot = (): DemoSnapshot => this.snapshot;

  getNotificationState = (): DemoNotificationState => {
    if (this.lastNotificationScheduleResult?.status === 'scheduled') {
      return { status: 'scheduled' };
    }
    if (this.lastNotificationScheduleResult?.status === 'degraded') {
      return {
        status: 'degraded',
        reason: this.lastNotificationScheduleResult.reason,
      };
    }
    if (this.lastNotificationCapability?.status === 'ready') {
      return { status: 'ready' };
    }
    return {
      status: 'degraded',
      reason: this.lastNotificationCapability?.reason ?? 'not_initialized',
    };
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async initialize(): Promise<void> {
    this.lastNotificationCapability = await this.dependencies.reminders.getCapability();
    await this.refresh();
  }

  async reconcileToday(): Promise<void> {
    await this.refresh();
  }

  async startOccurrenceEarly(_occurrenceId: string): Promise<void> {
    throw new Error('Legacy Demo adapter does not support early personal recording.');
  }

  async appendRetakePhoto(occurrenceId: string, localUri: string): Promise<void> {
    await this.saveCapturedPhoto(occurrenceId, localUri);
  }

  getLastNotificationCapability(): NotificationCapability | null {
    return this.lastNotificationCapability;
  }

  getLastNotificationScheduleResult(): NotificationScheduleResult | null {
    return this.lastNotificationScheduleResult;
  }

  async acceptSafetyNotice(): Promise<void> {
    await this.mutate(async () => {
      this.unwrap(
        await this.dependencies.application.acknowledgeDemo({
          ...this.command(),
          disclaimerVersion: 'demo-v0.1',
        }),
      );
    });
  }

  async loadSampleData(): Promise<void> {
    await this.mutate(async () => {
      const application = this.dependencies.application;
      if (!this.snapshot.safetyNoticeAccepted) {
        this.unwrap(
          await application.acknowledgeDemo({
            ...this.command(),
            disclaimerVersion: 'demo-v0.1',
          }),
        );
      }
      const first = this.unwrap(
        await application.createDemoMedication({
          ...this.command(),
          displayName: '演示药A',
          dosageForm: 'tablet',
          initialInventoryQuantity: '30',
        }),
      );
      const second = this.unwrap(
        await application.createDemoMedication({
          ...this.command(),
          displayName: '演示药B',
          dosageForm: 'capsule',
          initialInventoryQuantity: '20',
        }),
      );
      const now = this.dependencies.now();
      const demoTime = new Date(now.getTime() - 60_000);
      const regimen = this.unwrap(
        await application.createDailyRegimen({
          ...this.command(),
          name: '虚构演示方案',
          localTime: this.localTime(demoTime),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          onTimeOffsetMinutes: 60,
          recordOffsetMinutes: 720,
          captureMode: 'group',
          startLocalDate: this.localDate(demoTime),
          items: [
            { medicationId: first.id, plannedDoseQuantity: '1' },
            { medicationId: second.id, plannedDoseQuantity: '2' },
          ],
        }),
      );
      const occurrences = this.unwrap(
        await application.materializeToday({
          ...this.command(),
          localDate: this.localDate(now),
        }),
      );
      const occurrence = occurrences.find((item) => item.regimenId === regimen.id);
      if (occurrence) {
        this.unwrap(
          await application.markOccurrenceDue({
            ...this.command(),
            occurrenceId: occurrence.id,
            effectiveAtUtc: now.toISOString(),
          }),
        );
        await this.prepareReminderPermission();
        this.lastNotificationScheduleResult =
          await this.dependencies.reminders.scheduleOneMinuteDemo(occurrence.id);
      }
    });
  }

  async createMedication(input: NewMedicationInput): Promise<string> {
    let createdId = '';
    await this.mutate(async () => {
      const medication = this.unwrap(
        await this.dependencies.application.createDemoMedication({
          ...this.command(),
          displayName: input.name,
          dosageForm: input.unit === '片' ? 'tablet' : 'capsule',
          initialInventoryQuantity: String(input.initialInventory),
        }),
      );
      createdId = medication.id;
      const today = this.dependencies.now();
      const regimen = this.unwrap(
        await this.dependencies.application.createDailyRegimen({
          ...this.command(),
          name: `${input.name}每日演示方案`,
          localTime: input.reminderTime,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          onTimeOffsetMinutes: 60,
          recordOffsetMinutes: 720,
          captureMode: 'group',
          startLocalDate: this.localDate(today),
          items: [{ medicationId: medication.id, plannedDoseQuantity: String(input.plannedDoseQuantity) }],
        }),
      );
      const occurrences = this.unwrap(
        await this.dependencies.application.materializeToday({
          ...this.command(),
          localDate: this.localDate(today),
        }),
      );
      const occurrence = occurrences.find((item) => item.regimenId === regimen.id);
      if (occurrence) {
        const [hour, minute] = input.reminderTime.split(':').map(Number);
        await this.prepareReminderPermission();
        this.lastNotificationScheduleResult = await this.dependencies.reminders.scheduleDaily({
          reminderIntentId: regimen.id,
          hour: hour!,
          minute: minute!,
        });
      }
    });
    return createdId;
  }

  async updateMedication(_medicationId: string, _input: NewMedicationInput): Promise<void> {
    throw new DemoIntegrationError(
      'NOT_IMPLEMENTED',
      'Editing a persisted medication/regimen requires an application-layer command.',
    );
  }

  async saveCapturedPhoto(occurrenceId: string, localUri: string): Promise<void> {
    await this.mutate(async () => {
      const capturedAt = this.dependencies.now();
      const stored = await this.dependencies.media.persistCameraCapture(
        { uri: localUri },
        occurrenceId,
        capturedAt,
      );
      try {
        const occurrence = await this.dependencies.unitOfWork.run((repository) =>
          repository.getOccurrence(occurrenceId),
        );
        if (!occurrence) {
          throw new DemoIntegrationError('APPLICATION_REJECTED', 'NOT_FOUND:error.occurrence_not_found');
        }
        const command = {
          ...this.command(),
          occurrenceId,
          privateRelativePath: stored.relativePath,
          capturedAtUtc: capturedAt.toISOString(),
        };
        const result = occurrence.currentLifecycle === 'prepared'
          ? await this.dependencies.application.replacePreparedPhoto(command)
          : await this.dependencies.application.prepareWithPhoto(command);
        this.unwrap(result);
      } catch (error) {
        await this.dependencies.media.deletePhoto(stored.relativePath);
        throw error;
      }
    });
  }

  async countCapturedPhoto(occurrenceId: string): Promise<DemoCountResult> {
    const photo = await this.latestCapturedPhoto(occurrenceId);
    if (!photo?.privateRelativePath) return { status: 'unable', reason: 'processing_error' };
    try {
      return await this.dependencies.counter.countObjects(
        this.dependencies.media.resolvePrivateUri(photo.privateRelativePath),
      );
    } catch {
      return { status: 'unable', reason: 'processing_error' };
    }
  }

  async skipPhoto(
    occurrenceId: string,
    reason: 'camera_unavailable' | 'environment_inconvenient' | 'other',
    note?: string,
  ): Promise<void> {
    if (note?.trim()) {
      throw new DemoIntegrationError(
        'NOT_IMPLEMENTED',
        'Skip notes need a domain field before they can be persisted safely.',
      );
    }
    await this.mutate(async () => {
      this.unwrap(
        await this.dependencies.application.prepareBySkipping({
          ...this.command(),
          occurrenceId,
          reasonCode: reason,
        }),
      );
    });
  }

  async storeCountResult(occurrenceId: string, result: DemoCountResult): Promise<void> {
    await this.recordCount(occurrenceId, result, 'contour_counter', 'controlled-contour-v0.1');
  }

  async storeManualObjectCount(occurrenceId: string, count: number | null): Promise<void> {
    if (count === null) {
      // The append-only contract has no delete operation. Clearing the input
      // therefore means "do not append another observation"; refresh the
      // projection without altering the last persisted observation.
      await this.refresh();
      return;
    }
    await this.recordCount(
      occurrenceId,
      { status: 'counted', detectedObjectCount: count, quality: 'acceptable' },
      'manual_override',
      'manual-v1',
    );
  }

  async confirmDoseItem(
    occurrenceId: string,
    itemId: string,
    assertion: Exclude<ItemConsumptionAssertion, 'pending'>,
    confirmedConsumptionQuantity: number,
  ): Promise<void> {
    await this.mutate(async () => {
      this.unwrap(
        await this.dependencies.application.confirmOccurrenceItems({
          ...this.command(),
          occurrenceId,
          confirmedAtUtc: this.dependencies.now().toISOString(),
          items: [{
            occurrenceItemId: itemId,
            assertion,
            confirmedConsumptionQuantity: String(confirmedConsumptionQuantity),
          }],
        }),
      );
    });
  }

  async reviseDoseItem(
    occurrenceId: string,
    itemId: string,
    assertion: Exclude<ItemConsumptionAssertion, 'pending'>,
    confirmedConsumptionQuantity: number,
    reason: string,
  ): Promise<void> {
    await this.mutate(async () => {
      const occurrence = await this.dependencies.unitOfWork.run((repository) =>
        repository.getOccurrence(occurrenceId),
      );
      const item = occurrence?.items.find((candidate) => candidate.id === itemId);
      if (!item?.activeFactId) {
        throw new DemoIntegrationError('APPLICATION_REJECTED', 'No active assertion fact to revise.');
      }
      this.unwrap(
        await this.dependencies.application.reviseItemConfirmation({
          ...this.command(),
          factId: item.activeFactId,
          assertion,
          confirmedConsumptionQuantity: String(confirmedConsumptionQuantity),
          confirmedAtUtc: this.dependencies.now().toISOString(),
          reasonCode: reason.trim() || 'demo_user_correction',
        }),
      );
    });
  }

  async revokeOccurrence(occurrenceId: string): Promise<void> {
    await this.mutate(async () => {
      this.unwrap(
        await this.dependencies.application.revokeOccurrence({
          ...this.command(),
          occurrenceId,
          reasonCode: 'demo_user_revoked_occurrence',
        }),
      );
    });
  }

  async clearAll(): Promise<void> {
    await this.mutate(async () => {
      // Keep the database as the retry source of truth until all external
      // projections are actually gone. A failed media deletion must never be
      // reported as a successful clear with orphaned evidence left behind.
      await clearExternalDataBeforeDatabase(
        this.dependencies.media,
        this.dependencies.reminders,
        async () => {
          this.unwrap(
            await this.dependencies.application.clearAllDemoData({
              ...this.command(),
              confirmed: true,
            }),
          );
        },
      );
    });
  }

  private async recordCount(
    occurrenceId: string,
    result: DemoCountResult,
    source: 'contour_counter' | 'manual_override',
    algorithmVersion: string,
  ): Promise<void> {
    await this.mutate(async () => {
      const photo = await this.latestCapturedPhoto(occurrenceId);
      if (!photo) throw new DemoIntegrationError('APPLICATION_REJECTED', 'No captured photo.');
      this.unwrap(
        await this.dependencies.application.recordCountObservation({
          ...this.command(),
          occurrenceId,
          photoEvidenceId: photo.id,
          status: result.status,
          detectedObjectCount: result.status === 'counted' ? result.detectedObjectCount : null,
          unableReasonCode: result.status === 'unable' ? result.reason : null,
          source,
          algorithmVersion,
        }),
      );
    });
  }

  private async latestCapturedPhoto(occurrenceId: string) {
    const photos = await this.dependencies.unitOfWork.run((repository) =>
      repository.listPhotoEvidence(occurrenceId),
    );
    return [...photos].reverse().find((photo) => photo.state === 'captured');
  }

  private async mutate(operation: () => Promise<void>): Promise<void> {
    const next = this.writeQueue.then(operation);
    this.writeQueue = next.catch(() => undefined);
    await next;
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    const next = await this.dependencies.unitOfWork.run(async (repository) => {
      const profile = await repository.getProfile();
      const medications = await repository.listMedications();
      const occurrences = await repository.listOccurrences();
      const ledger = await repository.listInventoryLedger();
      const regimens = await repository.listActiveRegimensForDate(
        this.localDate(this.dependencies.now()),
      );
      const histories = await Promise.all(
        occurrences.map((occurrence) => repository.getHistory(occurrence.id)),
      );
      const occurrenceByLedgerId = projectLedgerOccurrenceIds(ledger, histories);
      const medicationViews: DemoMedication[] = medications.map((medication) => {
        const regimen = regimens.find((candidate) =>
          candidate.items.some((item) => item.medicationId === medication.id),
        );
        const regimenItem = regimen?.items.find((item) => item.medicationId === medication.id);
        const balanceMilliunits = ledger
          .filter((entry) => entry.medicationId === medication.id)
          .reduce((sum, entry) => sum + signedQuantityToMilliunits(entry.quantityDelta), 0n);
        return {
          id: medication.id,
          name: medication.displayName,
          unit: medication.inventoryUnit === 'tablet' ? '片' : '粒',
          plannedDoseQuantity: Number(regimenItem?.plannedDoseQuantity ?? 0),
          inventoryBalance: Number(balanceMilliunits) / 1000,
          reminderTime: regimen?.localTime ?? '08:00',
          active: medication.status === 'active',
        };
      });
      const occurrenceViews = occurrences.map((occurrence, index) =>
        this.mapOccurrence(occurrence, histories[index] ?? null),
      );
      const ledgerViews: DemoInventoryEntry[] = ledger.map((entry) => {
        const occurrenceId = occurrenceByLedgerId.get(entry.id);
        return {
          id: entry.id,
          medicationId: entry.medicationId,
          ...(occurrenceId ? { occurrenceId } : {}),
          quantityDelta: Number(signedQuantityToMilliunits(entry.quantityDelta)) / 1000,
          reason:
            entry.entryType === 'initial'
              ? 'initial'
              : entry.entryType === 'consumption'
                ? 'consumption'
                : entry.entryType === 'reversal'
                  ? 'reversal'
                  : 'revision',
          createdAt: entry.recordedAtUtc,
        };
      });
      return {
        safetyNoticeAccepted: profile !== null,
        medications: medicationViews,
        occurrences: occurrenceViews,
        inventoryLedger: ledgerViews,
      } satisfies DemoSnapshot;
    });
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }

  private mapOccurrence(
    occurrence: DoseOccurrence,
    history: HistoryEntry | null,
  ): DemoOccurrence {
    const photos = history?.photos ?? [];
    const photo = photos.length > 0 ? photos[photos.length - 1]! : null;
    const observations = photo
      ? (history?.countObservations ?? []).filter(
          (observation) => observation.photoEvidenceId === photo.id,
        )
      : [];
    const observation = observations.length > 0 ? observations[observations.length - 1]! : null;
    let photoView: DemoPhotoEvidence | null = null;
    if (photo) {
      let localUri: string | undefined;
      if (photo.state === 'captured' && photo.privateRelativePath) {
        try {
          localUri = this.dependencies.media.resolvePrivateUri(photo.privateRelativePath);
        } catch {
          localUri = undefined;
        }
      }
      const skipReason = photo.skipReasonCode;
      photoView = {
        state: photo.state,
        capturePurpose: 'initial',
        capturedAt: photo.capturedAtUtc ?? photo.createdAtUtc,
        ...(localUri ? { localUri } : {}),
        ...(photo.state === 'skipped_with_reason'
          ? {
              skipReason:
                skipReason === 'camera_unavailable' ||
                skipReason === 'environment_inconvenient'
                  ? skipReason
                  : ('other' as const),
            }
          : {}),
        detectedObjectCount: observation?.detectedObjectCount ?? null,
        countSource:
          observation?.status === 'counted'
            ? observation.source === 'manual_override'
              ? 'manual'
              : 'counter'
            : null,
        ...(observation?.status === 'unable'
          ? {
              countUnableReason: this.mapUnableReason(observation.unableReasonCode),
            }
          : {}),
      };
    }

    const itemViews: DemoDoseItem[] = occurrence.items.map((item) => {
      const activeFact = history?.assertionFacts.find((fact) => fact.id === item.activeFactId);
      const correctionFacts = (history?.assertionFacts ?? []).filter(
        (fact) => fact.occurrenceItemId === item.id && fact.source === 'correction',
      );
      return {
        id: item.id,
        medicationId: item.medicationId,
        displayName: item.medicationDisplayName,
        unit: item.unit === 'tablet' ? '片' : '粒',
        plannedDoseQuantity: Number(item.plannedDoseQuantity),
        assertion: item.assertion,
        confirmedConsumptionQuantity: quantityNumber(item.confirmedConsumptionQuantity),
        confirmedAt: activeFact?.assertedConsumedAtUtc ?? activeFact?.recordedAtUtc ?? null,
        revisions: correctionFacts.map((fact) => {
          const previous = history?.assertionFacts.find(
            (candidate) => candidate.id === fact.supersedesFactId,
          );
          return {
            at: fact.recordedAtUtc,
            previousAssertion: previous?.assertion ?? 'pending',
            previousQuantity: quantityNumber(previous?.confirmedConsumptionQuantity ?? null),
            reason: 'demo_user_correction',
          };
        }),
      };
    });
    const completionTimes = (history?.assertionFacts ?? [])
      .map((fact) => fact.recordedAtUtc)
      .sort();
    return {
      id: occurrence.id,
      localServiceDate: occurrence.localServiceDate,
      plannedAt: occurrence.scheduledAtUtc,
      onTimeUntilAt: occurrence.onTimeUntilAtUtc,
      recordUntilAt: occurrence.recordUntilAtUtc,
      lifecycle: occurrence.currentLifecycle,
      preparedAt: photo?.createdAtUtc ?? null,
      completedAt:
        itemViews.every((item) => item.assertion !== 'pending')
          ? completionTimes[completionTimes.length - 1] ?? null
          : null,
      photo: photoView,
      items: itemViews,
    };
  }

  private mapUnableReason(value: string | null) {
    switch (value) {
      case 'low_contrast':
      case 'blur':
      case 'overlap':
      case 'background_noise':
      case 'too_dark':
      case 'processing_error':
        return value;
      default:
        return 'processing_error' as const;
    }
  }

  private async prepareReminderPermission(): Promise<void> {
    const capability = await this.dependencies.reminders.getCapability();
    this.lastNotificationCapability = capability;
    if (
      capability.status === 'degraded' &&
      capability.reason === 'permission_undetermined' &&
      capability.canAskAgain
    ) {
      this.lastNotificationCapability =
        await this.dependencies.reminders.requestPermission();
    }
  }

  private command(): WriteCommand {
    const id = this.dependencies.nextId();
    return {
      commandId: id,
      idempotencyKey: id,
      issuedAtUtc: this.dependencies.now().toISOString(),
      payloadSchemaVersion: 1,
    };
  }

  private unwrap<T>(result: { ok: true; value: T } | { ok: false; error: { code: string; messageKey: string } }): T {
    if (result.ok) return result.value;
    throw new DemoIntegrationError(
      'APPLICATION_REJECTED',
      `${result.error.code}:${result.error.messageKey}`,
    );
  }

  private localDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private localTime(date: Date): string {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
}
