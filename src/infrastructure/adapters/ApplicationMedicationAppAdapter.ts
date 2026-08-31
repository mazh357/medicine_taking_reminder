import type {
  MedicationApplicationService,
  MedicationUnitOfWork,
  PersonalWriteCommand,
} from '../../application';
import {
  signedQuantityToMilliunits,
  type AppPreferences,
  type AuxiliaryReminderIntent,
  type FollowUpItem,
  type InventoryForecast,
  type PersonalDoseOccurrence,
  type PersonalHistoryEntry,
  type PersonalPhotoEvidence,
  type PersonalRegimen,
  type RegimenVersion,
} from '../../domain';
import type {
  DemoApi,
  DemoCountResult,
  DemoDoseItem,
  DemoInventoryEntry,
  DemoNotificationState,
  DemoOccurrence,
  DemoPhotoEvidence,
  DemoSnapshot,
  ItemConsumptionAssertion,
  NewMedicationInput,
} from '../../features/demoApi';
import type {
  DeviceSelfCheck,
  FollowUpInput,
  FollowUpItemView,
  InventoryPrediction,
  LocalDataSummary,
  MedicationInput,
  PhotoView,
  PlanChangeResult,
  RefillReminderDays,
  RuntimeVersionInfo,
  TextSize,
  ThemeMode,
} from '../../features/medicationAppApi';
import type { PrivateMediaStore } from '../media';
import type { LocalReminderService } from '../notifications';
import type { DemoPillCounterAdapter } from './DemoPillCounterAdapter';
import { projectLedgerOccurrenceIds } from './inventoryOccurrenceProjection';

type Dependencies = {
  application: MedicationApplicationService;
  unitOfWork: MedicationUnitOfWork;
  media: PrivateMediaStore;
  counter: DemoPillCounterAdapter;
  reminders: LocalReminderService;
  nextId(): string;
  now(): Date;
  getDatabaseSchemaVersion(): Promise<number | null>;
  clearPersonalData(): Promise<void>;
};

export class PersonalAppIntegrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersonalAppIntegrationError';
  }
}

export class ApplicationMedicationAppAdapter implements DemoApi {
  private snapshot: DemoSnapshot = emptySnapshot();
  private readonly listeners = new Set<() => void>();
  private notificationState: DemoNotificationState = {
    status: 'degraded',
    reason: 'not_initialized',
  };
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly dependencies: Dependencies) {}

  getSnapshot = () => this.snapshot;
  getNotificationState = () => this.notificationState;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async initialize(): Promise<void> {
    this.unwrap(await this.dependencies.application.initializeProfile(this.command()));
    await this.reconcileToday();
  }

  async reconcileToday(): Promise<void> {
    await this.enqueue(async () => {
      const now = this.dependencies.now();
      const localDate = this.localDate(now);
      this.unwrap(
        await this.dependencies.application.materializeDate({
          ...this.command(),
          localDate,
        }),
      );
      const openDates = await this.dependencies.unitOfWork.run(async (repository) => {
        const occurrences = await repository.listAllOccurrences();
        return [...new Set(
          occurrences
            .filter((occurrence) =>
              occurrence.localServiceDate <= localDate &&
              ['scheduled', 'due', 'prepared'].includes(occurrence.currentLifecycle),
            )
            .map((occurrence) => occurrence.localServiceDate)
            .concat(localDate),
        )].sort();
      });
      for (const date of openDates) {
        this.unwrap(
          await this.dependencies.application.reconcileOccurrenceTimes({
            ...this.command(),
            localDate: date,
            currentAtUtc: now.toISOString(),
          }),
        );
      }
      await this.reconcileReminders(localDate);
      await this.reconcileAuxiliaryReminders(localDate, now);
      await this.refresh();
    });
  }

  async startOccurrenceEarly(occurrenceId: string): Promise<void> {
    await this.mutate(async () => {
      const now = this.dependencies.now();
      this.unwrap(
        await this.dependencies.application.startOccurrenceEarly({
          ...this.command(),
          occurrenceId,
          currentLocalDate: this.localDate(now),
        }),
      );
      await this.reconcileReminders(this.localDate(now));
    });
  }

  async acceptSafetyNotice(): Promise<void> {
    // Kept only for the old UI bridge; the personal app has no acceptance gate.
  }

  async loadSampleData(): Promise<void> {
    throw new PersonalAppIntegrationError('个人本地测试版不提供示例数据入口。');
  }

  async createMedication(input: NewMedicationInput): Promise<string> {
    return this.createPersonalMedication({
      name: input.name,
      plannedDoseQuantity: input.plannedDoseQuantity,
      initialInventory: input.initialInventory,
      reminderTime: input.reminderTime,
    });
  }

  async createPersonalMedication(input: MedicationInput): Promise<string> {
    let id = '';
    await this.mutate(async () => {
      const medication = this.unwrap(
        await this.dependencies.application.createMedication({
          ...this.command(),
          displayName: input.name,
          initialInventoryQuantity: String(input.initialInventory),
        }),
      );
      id = medication.id;
      const today = this.dependencies.now();
      this.unwrap(
        await this.dependencies.application.createRegimen({
          ...this.command(),
          name: input.name,
          localTime: input.reminderTime,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          onTimeOffsetMinutes: 60,
          recordOffsetMinutes: 720,
          captureMode: 'group',
          startLocalDate: this.localDate(today),
          items: [{ medicationId: medication.id, plannedDoseQuantity: String(input.plannedDoseQuantity) }],
        }),
      );
      this.unwrap(
        await this.dependencies.application.materializeDate({
          ...this.command(),
          localDate: this.localDate(today),
        }),
      );
      this.unwrap(
        await this.dependencies.application.reconcileOccurrenceTimes({
          ...this.command(),
          localDate: this.localDate(today),
          currentAtUtc: today.toISOString(),
        }),
      );
      await this.reconcileReminders(this.localDate(today));
    });
    return id;
  }

  async updateMedication(medicationId: string, input: NewMedicationInput): Promise<void> {
    await this.updatePlan(medicationId, {
      name: input.name,
      plannedDoseQuantity: input.plannedDoseQuantity,
      initialInventory: input.initialInventory,
      reminderTime: input.reminderTime,
    });
  }

  async updatePlan(medicationId: string, input: MedicationInput): Promise<PlanChangeResult> {
    let result!: PlanChangeResult;
    await this.mutate(async () => {
      const { regimen } = await this.planForMedication(medicationId);
      const now = this.dependencies.now();
      result = this.unwrap(
        await this.dependencies.application.updateRegimenPlan({
          ...this.command(),
          regimenId: regimen.id,
          expectedRowVersion: regimen.rowVersion,
          currentLocalDate: this.localDate(now),
          currentAtUtc: now.toISOString(),
          changes: {
            name: input.name,
            localTime: input.reminderTime,
            itemChanges: [{
              medicationId,
              displayName: input.name,
              plannedDoseQuantity: String(input.plannedDoseQuantity),
            }],
          },
        }),
      );
      this.unwrap(
        await this.dependencies.application.correctInventory({
          ...this.command(),
          medicationId,
          targetInventoryQuantity: String(input.initialInventory),
          reasonCode: 'plan_edit_inventory',
        }),
      );
      await this.reconcileReminders(this.localDate(now));
    });
    return result;
  }

  async pausePlan(medicationId: string): Promise<PlanChangeResult> {
    return this.setPlanActive(medicationId, false);
  }

  async resumePlan(medicationId: string): Promise<PlanChangeResult> {
    return this.setPlanActive(medicationId, true);
  }

  async correctInventory(medicationId: string, targetInventory: number, reason: string): Promise<void> {
    await this.mutate(async () => {
      this.unwrap(
        await this.dependencies.application.correctInventory({
          ...this.command(),
          medicationId,
          targetInventoryQuantity: String(targetInventory),
          reasonCode: reason.trim() || 'user_inventory_correction',
        }),
      );
    });
  }

  async setRefillReminderDays(
    medicationId: string,
    days: RefillReminderDays,
  ): Promise<void> {
    await this.mutate(async () => {
      const preference = await this.dependencies.unitOfWork.run((repository) =>
        repository.getInventoryForecastPreference(medicationId),
      );
      if (!preference) {
        throw new PersonalAppIntegrationError('未找到该药物的补药提醒设置。');
      }
      this.unwrap(
        await this.dependencies.application.setInventoryForecastPreference({
          ...this.command(),
          medicationId,
          leadDays: days === 0 ? null : days,
          expectedRowVersion: preference.rowVersion,
        }),
      );
    });
  }

  async createFollowUp(input: FollowUpInput): Promise<string> {
    let id = '';
    await this.mutate(async () => {
      const item = this.unwrap(
        await this.dependencies.application.createFollowUpItem({
          ...this.command(),
          type: input.type,
          title: input.title,
          dueAtUtc: input.scheduledAt,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          medicationId: input.medicationId,
          note: input.notes,
          advanceDays: input.advanceReminderDays === 0 ? null : input.advanceReminderDays,
        }),
      );
      id = item.id;
    });
    return id;
  }

  async updateFollowUp(id: string, input: FollowUpInput): Promise<void> {
    await this.mutate(async () => {
      const current = await this.dependencies.unitOfWork.run((repository) =>
        repository.getFollowUpItem(id),
      );
      if (!current) throw new PersonalAppIntegrationError('未找到该事项。');
      this.unwrap(
        await this.dependencies.application.editFollowUpItem({
          ...this.command(),
          followUpItemId: id,
          expectedRowVersion: current.rowVersion,
          changes: {
            type: input.type,
            title: input.title,
            dueAtUtc: input.scheduledAt,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            medicationId: input.medicationId,
            note: input.notes,
            advanceDays: input.advanceReminderDays === 0 ? null : input.advanceReminderDays,
          },
        }),
      );
    });
  }

  async completeFollowUp(id: string): Promise<void> {
    await this.closeFollowUp(id, 'completed');
  }

  async cancelFollowUp(id: string): Promise<void> {
    await this.closeFollowUp(id, 'cancelled');
  }

  async getRuntimeVersionInfo(): Promise<RuntimeVersionInfo> {
    const [databaseSchemaVersion, media] = await Promise.all([
      this.dependencies.getDatabaseSchemaVersion().catch(() => null),
      this.dependencies.media.encryptionStatus().catch(() => null),
    ]);
    return {
      databaseSchemaVersion,
      mediaFormatVersion: media?.mediaFormatVersion ?? null,
    };
  }

  async savePreferences(themeMode: ThemeMode, textSize: TextSize): Promise<void> {
    await this.mutate(async () => {
      const current = await this.preferences();
      this.unwrap(
        await this.dependencies.application.savePreferences({
          ...this.command(),
          themeMode,
          textSize,
          expectedRowVersion: current.rowVersion,
        }),
      );
    });
  }

  async getPreferences(): Promise<{ themeMode: ThemeMode; textSize: TextSize }> {
    const preferences = await this.preferences();
    return { themeMode: preferences.themeMode, textSize: preferences.textSize };
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
        this.unwrap(
          await this.dependencies.application.prepareWithPhoto({
            ...this.command(),
            occurrenceId,
            currentLocalDate: this.localDate(capturedAt),
            encryptedMediaId: stored.relativePath,
            capturedAtUtc: capturedAt.toISOString(),
          }),
        );
      } catch (error) {
        await this.dependencies.media.deletePhoto(stored.relativePath).catch(() => undefined);
        throw error;
      }
    });
  }

  async appendRetakePhoto(occurrenceId: string, localUri: string): Promise<void> {
    await this.mutate(async () => {
      const capturedAt = this.dependencies.now();
      const stored = await this.dependencies.media.persistCameraCapture(
        { uri: localUri },
        occurrenceId,
        capturedAt,
      );
      try {
        this.unwrap(
          await this.dependencies.application.appendRetakePhoto({
            ...this.command(),
            occurrenceId,
            encryptedMediaId: stored.relativePath,
            capturedAtUtc: capturedAt.toISOString(),
          }),
        );
      } catch (error) {
        await this.dependencies.media.deletePhoto(stored.relativePath).catch(() => undefined);
        throw error;
      }
    });
  }

  async countCapturedPhoto(occurrenceId: string): Promise<DemoCountResult> {
    const history = this.unwrap(await this.dependencies.application.getHistory(occurrenceId));
    const photo = [...history.photos].reverse().find(
      (candidate) => candidate.state === 'captured' && candidate.encryptedMediaId,
    );
    if (!photo?.encryptedMediaId) return { status: 'unable', reason: 'processing_error' };
    let preview: { uri: string } | undefined;
    try {
      preview = await this.dependencies.media.createDecryptedPreview(photo.encryptedMediaId);
      return await this.dependencies.counter.countObjects(preview.uri);
    } catch {
      return { status: 'unable', reason: 'processing_error' };
    } finally {
      if (preview) await this.dependencies.media.deletePreview(preview.uri).catch(() => undefined);
    }
  }

  async skipPhoto(
    occurrenceId: string,
    reason: 'camera_unavailable' | 'environment_inconvenient' | 'other',
    _note?: string,
  ): Promise<void> {
    await this.mutate(async () => {
      this.unwrap(
        await this.dependencies.application.prepareBySkipping({
          ...this.command(),
          occurrenceId,
          currentLocalDate: this.localDate(this.dependencies.now()),
          reasonCode: reason,
        }),
      );
    });
  }

  async storeCountResult(occurrenceId: string, result: DemoCountResult): Promise<void> {
    await this.recordCount(occurrenceId, result, 'contour_counter', 'controlled-contour-v0.2');
  }

  async storeManualObjectCount(occurrenceId: string, count: number | null): Promise<void> {
    if (count === null) return;
    await this.recordCount(
      occurrenceId,
      { status: 'counted', detectedObjectCount: count, quality: 'acceptable' },
      'manual_override',
      'manual-v2',
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
      await this.reconcileReminders(this.localDate(this.dependencies.now()));
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
      const history = this.unwrap(await this.dependencies.application.getHistory(occurrenceId));
      const item = history.occurrence.items.find((candidate) => candidate.id === itemId);
      if (!item?.activeFactId) throw new PersonalAppIntegrationError('未找到可修订的记录。');
      this.unwrap(
        await this.dependencies.application.reviseItemConfirmation({
          ...this.command(),
          factId: item.activeFactId,
          assertion,
          confirmedConsumptionQuantity: String(confirmedConsumptionQuantity),
          confirmedAtUtc: this.dependencies.now().toISOString(),
          reasonCode: reason.trim() || 'user_correction',
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
          reasonCode: 'user_revoked_occurrence',
        }),
      );
      await this.reconcileReminders(this.localDate(this.dependencies.now()));
    });
  }

  async listPhotos(occurrenceId?: string): Promise<PhotoView[]> {
    const photos = await this.dependencies.unitOfWork.run((repository) =>
      repository.listAllPhotoEvidence(),
    );
    return photos
      .filter((photo) => !occurrenceId || photo.occurrenceId === occurrenceId)
      .map((photo) => this.mapPhotoView(photo));
  }

  async createPhotoPreview(photoId: string): Promise<{ uri: string }> {
    const photo = await this.dependencies.unitOfWork.run((repository) =>
      repository.getPhotoEvidence(photoId),
    );
    if (!photo?.encryptedMediaId || photo.state !== 'captured') {
      throw new PersonalAppIntegrationError('照片不可用或已删除。');
    }
    return this.dependencies.media.createDecryptedPreview(photo.encryptedMediaId);
  }

  releasePhotoPreview(uri: string): Promise<void> {
    return this.dependencies.media.deletePreview(uri);
  }

  async deletePhoto(photoId: string): Promise<void> {
    await this.mutate(async () => {
      const pending = this.unwrap(
        await this.dependencies.application.requestPhotoDeletion({
          ...this.command(),
          photoEvidenceId: photoId,
          reasonCode: 'user_requested',
        }),
      );
      if (pending.state === 'deleted_tombstone') return;
      if (!pending.encryptedMediaId) throw new PersonalAppIntegrationError('照片密文标识缺失。');
      await this.dependencies.media.deletePhoto(pending.encryptedMediaId);
      this.unwrap(
        await this.dependencies.application.finalizePhotoTombstone({
          ...this.command(),
          photoEvidenceId: photoId,
          mediaDeletionVerified: true,
        }),
      );
    });
  }

  async getLocalDataSummary(): Promise<LocalDataSummary> {
    return this.dependencies.unitOfWork.run(async (repository) => {
      const medications = await repository.listMedications();
      const occurrences = await repository.listAllOccurrences();
      const photos = await repository.listAllPhotoEvidence();
      return {
        medicationCount: medications.length,
        occurrenceCount: occurrences.length,
        activePhotoCount: photos.filter((photo) => photo.state === 'captured').length,
        deletedPhotoCount: photos.filter((photo) => photo.state === 'deleted_tombstone').length,
        encryptedPhotoBytes: 0,
      };
    });
  }

  async runSelfCheck(): Promise<DeviceSelfCheck> {
    const checkedAt = this.dependencies.now().toISOString();
    const [notification, media, database] = await Promise.all([
      this.dependencies.reminders.getCapability().catch(() => null),
      this.dependencies.media.encryptionStatus().catch(() => null),
      this.preferences().then(() => true).catch(() => false),
    ]);
    let cameraStatus: DeviceSelfCheck['items'][number]['status'] = 'unavailable';
    let cameraDetail = '无法读取相机权限';
    try {
      const Camera = await import('expo-camera');
      const permission = await Camera.Camera.getCameraPermissionsAsync();
      cameraStatus = permission.granted ? 'ok' : 'warning';
      cameraDetail = permission.granted ? '相机权限可用' : '需要在系统设置中允许相机权限';
    } catch {
      // Reported as unavailable below.
    }
    return {
      checkedAt,
      items: [
        {
          key: 'notification',
          label: '本地提醒',
          status: notification?.status === 'ready' ? 'ok' : 'warning',
          detail: notification?.status === 'ready' ? '通知权限可用' : '通知权限或调度需要检查',
        },
        { key: 'camera', label: '相机', status: cameraStatus, detail: cameraDetail },
        {
          key: 'database',
          label: '加密数据库',
          status: database ? 'ok' : 'unavailable',
          detail: database ? 'SQLCipher 数据库可读取' : '数据库暂时无法读取',
        },
        {
          key: 'media',
          label: '照片加密',
          status: media?.available ? 'ok' : 'unavailable',
          detail: media?.available ? `AES-GCM 媒体格式 v${media.mediaFormatVersion}` : '照片加密不可用',
        },
      ],
    };
  }

  async sendTestReminder(): Promise<void> {
    const result = await this.dependencies.reminders.scheduleTestReminder(this.dependencies.nextId());
    if (result.status === 'degraded') throw new PersonalAppIntegrationError('测试提醒未能安排。');
    this.notificationState = { status: 'scheduled' };
    this.emit();
  }

  async clearAll(): Promise<void> {
    await this.enqueue(async () => {
      await this.dependencies.clearPersonalData();
      this.snapshot = emptySnapshot();
      this.emit();
    });
  }

  private async closeFollowUp(
    id: string,
    status: 'completed' | 'cancelled',
  ): Promise<void> {
    await this.mutate(async () => {
      const current = await this.dependencies.unitOfWork.run((repository) =>
        repository.getFollowUpItem(id),
      );
      if (!current) throw new PersonalAppIntegrationError('未找到该事项。');
      const command = {
        ...this.command(),
        followUpItemId: id,
        expectedRowVersion: current.rowVersion,
      };
      this.unwrap(
        status === 'completed'
          ? await this.dependencies.application.completeFollowUpItem(command)
          : await this.dependencies.application.cancelFollowUpItem(command),
      );
    });
  }

  private async setPlanActive(medicationId: string, active: boolean): Promise<PlanChangeResult> {
    let result!: PlanChangeResult;
    await this.mutate(async () => {
      const { regimen } = await this.planForMedication(medicationId);
      const now = this.dependencies.now();
      const command = {
        ...this.command(),
        regimenId: regimen.id,
        expectedRowVersion: regimen.rowVersion,
        currentLocalDate: this.localDate(now),
        currentAtUtc: now.toISOString(),
      };
      result = this.unwrap(
        active
          ? await this.dependencies.application.resumeRegimen(command)
          : await this.dependencies.application.pauseRegimen(command),
      );
      await this.reconcileReminders(this.localDate(now));
    });
    return result;
  }

  private async planForMedication(medicationId: string): Promise<{
    regimen: PersonalRegimen;
    version: RegimenVersion;
  }> {
    const localDate = this.localDate(this.dependencies.now());
    return this.dependencies.unitOfWork.run(async (repository) => {
      const regimens = await repository.listRegimensForDate(localDate);
      for (const regimen of regimens) {
        const version = await repository.getRegimenVersion(regimen.currentVersionId);
        if (version?.items.some((item) => item.medicationId === medicationId)) {
          return { regimen, version };
        }
      }
      throw new PersonalAppIntegrationError('未找到对应的用药计划。');
    });
  }

  private async recordCount(
    occurrenceId: string,
    result: DemoCountResult,
    source: 'contour_counter' | 'manual_override',
    algorithmVersion: string,
  ): Promise<void> {
    await this.mutate(async () => {
      const history = this.unwrap(await this.dependencies.application.getHistory(occurrenceId));
      const photo = [...history.photos].reverse().find((candidate) => candidate.state === 'captured');
      if (!photo) throw new PersonalAppIntegrationError('没有可关联的照片。');
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

  private async preferences(): Promise<AppPreferences> {
    const value = await this.dependencies.unitOfWork.run((repository) => repository.getPreferences());
    if (!value) throw new PersonalAppIntegrationError('本机偏好尚未初始化。');
    return value;
  }

  private async reconcileReminders(localDate: string): Promise<void> {
    const capability = await this.dependencies.reminders.getCapability();
    this.unwrap(await this.dependencies.application.getToday(localDate));
    const entries = await this.dependencies.unitOfWork.run(async (repository) => {
      const intents = await repository.listAllReminderIntents();
      return Promise.all(
        intents.map(async (intent) => ({
          intent,
          occurrence: await repository.getOccurrence(intent.occurrenceId),
          projection: await repository.getReminderProjection(intent.id),
        })),
      );
    });
    let scheduled = false;
    let reconciliationFailed = false;
    for (const { intent, occurrence, projection } of entries) {
      await this.dependencies.unitOfWork.run(async (repository) => {
        const triggerExpired = Date.parse(intent.scheduledAtUtc) <= this.dependencies.now().getTime();
        const terminal =
          !occurrence ||
          ['taken_confirmed', 'late_taken', 'revoked'].includes(occurrence.currentLifecycle);
        if (terminal || triggerExpired || intent.status !== 'active') {
          if (projection?.systemNotificationId) {
            const cancellation = await this.dependencies.reminders.cancelProjection(
              projection.systemNotificationId,
            );
            if (cancellation.status === 'failed') {
              reconciliationFailed = true;
              await repository.saveReminderProjection({
                reminderIntentId: intent.id,
                systemNotificationId: projection.systemNotificationId,
                status: 'cancel_pending',
                failureCode: cancellation.failureCode,
                lastReconciledAtUtc: this.dependencies.now().toISOString(),
                rowVersion: projection.rowVersion,
              });
              return;
            }
          }
          await repository.saveReminderProjection({
            reminderIntentId: intent.id,
            systemNotificationId: null,
            status: triggerExpired && !terminal ? 'obsolete' : 'cancelled',
            failureCode: null,
            lastReconciledAtUtc: this.dependencies.now().toISOString(),
            rowVersion: projection?.rowVersion ?? 1,
          });
          return;
        }
        if (projection?.status === 'scheduled' && projection.systemNotificationId) {
          scheduled = true;
          return;
        }
        if (projection?.systemNotificationId) {
          const cancellation = await this.dependencies.reminders.cancelProjection(
            projection.systemNotificationId,
          );
          if (cancellation.status === 'failed') {
            reconciliationFailed = true;
            await repository.saveReminderProjection({
              reminderIntentId: intent.id,
              systemNotificationId: projection.systemNotificationId,
              status: 'cancel_pending',
              failureCode: cancellation.failureCode,
              lastReconciledAtUtc: this.dependencies.now().toISOString(),
              rowVersion: projection.rowVersion,
            });
            return;
          }
        }
        if (capability.status !== 'ready') {
          await repository.saveReminderProjection({
            reminderIntentId: intent.id,
            systemNotificationId: null,
            status: 'failed',
            failureCode: capability.reason,
            lastReconciledAtUtc: this.dependencies.now().toISOString(),
            rowVersion: projection?.rowVersion ?? 1,
          });
          return;
        }
        const date = new Date(intent.scheduledAtUtc);
        const result = await this.dependencies.reminders.scheduleAt({
          reminderIntentId: intent.id,
          occurrenceId: occurrence.id,
          date,
        });
        await repository.saveReminderProjection({
          reminderIntentId: intent.id,
          systemNotificationId: result.status === 'scheduled' ? result.systemNotificationId : null,
          status: result.status === 'scheduled' ? 'scheduled' : 'failed',
          failureCode: result.status === 'degraded' ? result.reason : null,
          lastReconciledAtUtc: this.dependencies.now().toISOString(),
          rowVersion: projection?.rowVersion ?? 1,
        });
        if (result.status === 'scheduled') scheduled = true;
      });
    }
    this.notificationState =
      capability.status !== 'ready'
        ? { status: 'degraded', reason: capability.reason }
        : reconciliationFailed
          ? { status: 'degraded', reason: 'scheduling_error' }
          : scheduled
            ? { status: 'scheduled' }
            : { status: 'ready' };
  }

  private async reconcileAuxiliaryReminders(localDate: string, now: Date): Promise<void> {
    this.unwrap(
      await this.dependencies.application.reconcileAuxiliaryReminders({
        ...this.command(),
        currentAtUtc: now.toISOString(),
        currentLocalDate: localDate,
      }),
    );
    const capability = await this.dependencies.reminders.getCapability();
    const entries = await this.dependencies.unitOfWork.run(async (repository) => {
      const intents = await repository.listAllAuxiliaryReminderIntents();
      return Promise.all(
        intents.map(async (intent) => ({
          intent,
          projection: await repository.getAuxiliaryReminderProjection(intent.id),
        })),
      );
    });
    let scheduled = this.notificationState.status === 'scheduled';
    let reconciliationFailed =
      this.notificationState.status === 'degraded' &&
      this.notificationState.reason === 'scheduling_error';
    for (const { intent, projection } of entries) {
      if (intent.status !== 'active') {
        if (projection?.status === 'cancelled' && !projection.systemNotificationId) continue;
        if (projection?.systemNotificationId) {
          const cancellation = await this.dependencies.reminders.cancelProjection(
            projection.systemNotificationId,
          );
          if (cancellation.status === 'failed') {
            reconciliationFailed = true;
            await this.saveAuxiliaryProjection(intent, {
              systemNotificationId: projection.systemNotificationId,
              status: 'cancel_pending',
              failureCode: cancellation.failureCode,
              rowVersion: projection.rowVersion,
            });
            continue;
          }
        }
        await this.saveAuxiliaryProjection(intent, {
          systemNotificationId: null,
          status: 'cancelled',
          failureCode: null,
          rowVersion: projection?.rowVersion ?? 1,
        });
        continue;
      }
      if (projection?.status === 'scheduled' && projection.systemNotificationId) {
        scheduled = true;
        continue;
      }
      if (projection?.systemNotificationId) {
        const cancellation = await this.dependencies.reminders.cancelProjection(
          projection.systemNotificationId,
        );
        if (cancellation.status === 'failed') {
          reconciliationFailed = true;
          await this.saveAuxiliaryProjection(intent, {
            systemNotificationId: projection.systemNotificationId,
            status: 'cancel_pending',
            failureCode: cancellation.failureCode,
            rowVersion: projection.rowVersion,
          });
          continue;
        }
      }
      if (capability.status !== 'ready') {
        await this.saveAuxiliaryProjection(intent, {
          systemNotificationId: null,
          status: 'failed',
          failureCode: capability.reason,
          rowVersion: projection?.rowVersion ?? 1,
        });
        continue;
      }
      const triggerAt = Math.max(Date.parse(intent.triggerAtUtc), now.getTime() + 1_000);
      const result = await this.dependencies.reminders.scheduleAuxiliaryAt({
        kind: intent.kind,
        sourceId: intent.sourceId,
        date: new Date(triggerAt),
      });
      await this.saveAuxiliaryProjection(intent, {
        systemNotificationId: result.status === 'scheduled' ? result.systemNotificationId : null,
        status: result.status === 'scheduled' ? 'scheduled' : 'failed',
        failureCode: result.status === 'degraded' ? result.reason : null,
        rowVersion: projection?.rowVersion ?? 1,
      });
      if (result.status === 'scheduled') scheduled = true;
    }
    this.notificationState =
      capability.status !== 'ready'
        ? { status: 'degraded', reason: capability.reason }
        : reconciliationFailed
          ? { status: 'degraded', reason: 'scheduling_error' }
          : scheduled
            ? { status: 'scheduled' }
            : { status: 'ready' };
  }

  private async saveAuxiliaryProjection(
    intent: AuxiliaryReminderIntent,
    input: {
      systemNotificationId: string | null;
      status: 'scheduled' | 'failed' | 'cancel_pending' | 'cancelled';
      failureCode: string | null;
      rowVersion: number;
    },
  ): Promise<void> {
    await this.dependencies.unitOfWork.run((repository) =>
      repository.saveAuxiliaryReminderProjection({
        reminderIntentId: intent.id,
        systemNotificationId: input.systemNotificationId,
        status: input.status,
        failureCode: input.failureCode,
        lastReconciledAtUtc: this.dependencies.now().toISOString(),
        rowVersion: input.rowVersion,
      }),
    );
  }

  private async refresh(): Promise<void> {
    const now = this.dependencies.now();
    const localDate = this.localDate(now);
    const data = await this.dependencies.unitOfWork.run(async (repository) => {
      const medications = await repository.listMedications();
      const occurrences = await repository.listAllOccurrences();
      const ledger = await repository.listAllInventoryLedger();
      const regimens = await repository.listRegimensForDate(localDate);
      const versions = await Promise.all(
        regimens.map((regimen) => repository.getRegimenVersion(regimen.currentVersionId)),
      );
      const histories = await Promise.all(
        occurrences.map((occurrence) => repository.getHistory(occurrence.id)),
      );
      const followUps = await repository.listAllFollowUpItems();
      return { medications, occurrences, ledger, regimens, versions, histories, followUps };
    });
    const forecasts = await Promise.all(
      data.medications.map(async (medication) =>
        this.unwrap(
          await this.dependencies.application.getInventoryForecast(
            medication.id,
            localDate,
            now.toISOString(),
          ),
        ),
      ),
    );
    const medicationViews = data.medications.map((medication, medicationIndex) => {
        const ledger = data.ledger;
        const balanceMilliunits = ledger
          .filter((entry) => entry.medicationId === medication.id)
          .reduce(
            (total, entry) => total + signedQuantityToMilliunits(entry.quantityDelta),
            0n,
          );
        const planIndex = data.versions.findIndex((version) =>
          version?.items.some((item) => item.medicationId === medication.id),
        );
        const version = planIndex >= 0 ? data.versions[planIndex] : null;
        const regimen = planIndex >= 0 ? data.regimens[planIndex] : null;
        const item = version?.items.find((candidate) => candidate.medicationId === medication.id);
        const forecast = forecasts[medicationIndex]!;
        return {
          id: medication.id,
          name: medication.displayName,
          unit: '片' as const,
          plannedDoseQuantity: Number(item?.plannedDoseQuantity ?? 0),
          inventoryBalance: Number(balanceMilliunits) / 1000,
          reminderTime: version?.localTime ?? '08:00',
          active: regimen?.status === 'active',
          onTimeOffsetMinutes: version?.onTimeOffsetMinutes ?? 60,
          recordOffsetMinutes: version?.recordOffsetMinutes ?? 720,
          refillReminderDays: (forecast.leadDays ?? 0) as RefillReminderDays,
          inventoryPrediction: this.mapInventoryPrediction(forecast),
        };
      });
    const occurrenceByLedgerId = projectLedgerOccurrenceIds(data.ledger, data.histories);
    const next: DemoSnapshot & { followUps: FollowUpItemView[] } = {
      safetyNoticeAccepted: true,
      medications: medicationViews,
      occurrences: data.occurrences.map((occurrence, index) =>
        this.mapOccurrence(occurrence, data.histories[index] ?? null),
      ),
      inventoryLedger: data.ledger.map((entry) =>
        this.mapInventory(entry, occurrenceByLedgerId.get(entry.id)),
      ),
      followUps: data.followUps.map((item) => this.mapFollowUp(item)),
    };
    this.snapshot = next;
    this.emit();
  }

  private mapInventoryPrediction(forecast: InventoryForecast): InventoryPrediction {
    if (forecast.unavailableReason) {
      return {
        status: 'unavailable',
        reason:
          forecast.unavailableReason === 'medication_inactive'
            ? 'plan_paused'
            : forecast.unavailableReason === 'no_active_daily_plan'
              ? 'no_active_plan'
              : 'complex_schedule',
      };
    }
    const nextInsufficientLocalDate = forecast.estimatedShortageLocalDate;
    return {
      status: 'available',
      estimatedDepletionLocalDate:
        nextInsufficientLocalDate && (forecast.fullDoses ?? 0) > 0
          ? this.addLocalDays(nextInsufficientLocalDate, -1)
          : null,
      nextInsufficientLocalDate,
    };
  }

  private mapFollowUp(item: FollowUpItem): FollowUpItemView {
    return {
      id: item.id,
      type: item.type,
      title: item.title,
      scheduledAt: item.dueAtUtc,
      medicationId: item.medicationId,
      notes: item.note,
      advanceReminderDays: item.advanceDays ?? 0,
      status: item.status === 'pending' ? 'scheduled' : item.status,
      completedAt: item.completedAtUtc,
      cancelledAt: item.cancelledAtUtc,
    };
  }

  private mapOccurrence(
    occurrence: PersonalDoseOccurrence,
    history: PersonalHistoryEntry | null,
  ): DemoOccurrence {
    const photos = history?.photos ?? [];
    const latestPhoto = [...photos].reverse()[0] ?? null;
    const photo = latestPhoto ? this.mapPhoto(latestPhoto, history!) : null;
    const facts = history?.assertionFacts ?? [];
    const items: DemoDoseItem[] = occurrence.items.map((item) => {
      const active = facts.find((fact) => fact.id === item.activeFactId);
      const corrections = facts.filter(
        (fact) => fact.occurrenceItemId === item.id && fact.source === 'correction',
      );
      return {
        id: item.id,
        medicationId: item.medicationId,
        displayName: item.medicationDisplayName,
        unit: '片',
        plannedDoseQuantity: Number(item.plannedDoseQuantity),
        assertion: item.assertion,
        confirmedConsumptionQuantity:
          item.confirmedConsumptionQuantity == null ? null : Number(item.confirmedConsumptionQuantity),
        confirmedAt: active?.assertedConsumedAtUtc ?? active?.recordedAtUtc ?? null,
        revisions: corrections.map((fact) => {
          const previous = facts.find((candidate) => candidate.id === fact.supersedesFactId);
          return {
            at: fact.recordedAtUtc,
            previousAssertion: previous?.assertion ?? 'pending',
            previousQuantity: previous ? Number(previous.confirmedConsumptionQuantity) : null,
            reason: '用户修订',
          };
        }),
      };
    });
    return {
      id: occurrence.id,
      localServiceDate: occurrence.localServiceDate,
      plannedAt: occurrence.scheduledAtUtc,
      onTimeUntilAt: occurrence.onTimeUntilAtUtc,
      recordUntilAt: occurrence.recordUntilAtUtc,
      lifecycle: occurrence.currentLifecycle,
      preparedAt:
        photos.find((candidate) => candidate.capturePurpose === 'initial')?.createdAtUtc ?? null,
      completedAt:
        items.every((item) => item.assertion !== 'pending')
          ? facts.map((fact) => fact.recordedAtUtc).sort().at(-1) ?? null
          : null,
      photo,
      items,
    };
  }

  private mapPhoto(photo: PersonalPhotoEvidence, history: PersonalHistoryEntry): DemoPhotoEvidence {
    const observations = history.countObservations.filter(
      (observation) => observation.photoEvidenceId === photo.id,
    );
    const latest = observations.at(-1);
    return {
      state: photo.state,
      capturePurpose: photo.capturePurpose,
      capturedAt: photo.capturedAtUtc ?? photo.createdAtUtc,
      ...(photo.state === 'skipped_with_reason'
        ? { skipReason: this.skipReason(photo.skipReasonCode) }
        : {}),
      detectedObjectCount: latest?.detectedObjectCount ?? null,
      countSource:
        latest?.status === 'counted'
          ? latest.source === 'manual_override' ? 'manual' : 'counter'
          : null,
      ...(latest?.status === 'unable'
        ? { countUnableReason: this.unableReason(latest.unableReasonCode) }
        : {}),
    };
  }

  private mapPhotoView(photo: PersonalPhotoEvidence): PhotoView {
    return {
      id: photo.id,
      occurrenceId: photo.occurrenceId,
      state: photo.state,
      capturePurpose: photo.capturePurpose,
      capturedAt: photo.capturedAtUtc ?? photo.createdAtUtc,
      ...(photo.state === 'skipped_with_reason'
        ? { skipReason: this.skipReason(photo.skipReasonCode) }
        : {}),
      detectedObjectCount: null,
      countSource: null,
      deletionStatus: photo.deletionStatus,
    };
  }

  private mapInventory(entry: {
    id: string;
    medicationId: string;
    quantityDelta: string;
    entryType: 'initial' | 'restock' | 'consumption' | 'reversal' | 'manual_adjustment';
    recordedAtUtc: string;
  }, occurrenceId?: string): DemoInventoryEntry {
    return {
      id: entry.id,
      medicationId: entry.medicationId,
      ...(occurrenceId ? { occurrenceId } : {}),
      quantityDelta: Number(signedQuantityToMilliunits(entry.quantityDelta)) / 1000,
      reason:
        entry.entryType === 'restock' || entry.entryType === 'manual_adjustment'
          ? 'manual_adjustment'
          : entry.entryType,
      createdAt: entry.recordedAtUtc,
    };
  }

  private skipReason(value: string | null): NonNullable<DemoPhotoEvidence['skipReason']> {
    return value === 'camera_unavailable' || value === 'environment_inconvenient' ? value : 'other';
  }

  private unableReason(value: string | null): NonNullable<DemoPhotoEvidence['countUnableReason']> {
    switch (value) {
      case 'low_contrast':
      case 'blur':
      case 'overlap':
      case 'background_noise':
      case 'too_dark':
      case 'processing_error':
        return value;
      default:
        return 'processing_error';
    }
  }

  private async mutate(operation: () => Promise<void>): Promise<void> {
    await this.enqueue(async () => {
      await operation();
      const now = this.dependencies.now();
      await this.reconcileAuxiliaryReminders(this.localDate(now), now);
      await this.refresh();
    });
  }

  private async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(operation, operation);
    this.writeQueue = next.catch(() => undefined);
    return next;
  }

  private command(): PersonalWriteCommand {
    const id = this.dependencies.nextId();
    return {
      commandId: id,
      idempotencyKey: id,
      issuedAtUtc: this.dependencies.now().toISOString(),
      payloadSchemaVersion: 2,
    };
  }

  private unwrap<T>(result: { ok: true; value: T } | { ok: false; error: { code: string; messageKey: string } }): T {
    if (result.ok) return result.value;
    throw new PersonalAppIntegrationError(`${result.error.code}:${result.error.messageKey}`);
  }

  private localDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private addLocalDays(localDate: string, days: number): string {
    const [year, month, day] = localDate.split('-').map(Number);
    const date = new Date(Date.UTC(year!, month! - 1, day! + days));
    return [
      date.getUTCFullYear(),
      String(date.getUTCMonth() + 1).padStart(2, '0'),
      String(date.getUTCDate()).padStart(2, '0'),
    ].join('-');
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}

function emptySnapshot(): DemoSnapshot {
  return {
    safetyNoticeAccepted: true,
    medications: [],
    occurrences: [],
    inventoryLedger: [],
  };
}
