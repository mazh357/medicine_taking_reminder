import { MedicationApplicationService } from '../../application';
import { OnDeviceVisionProvider } from 'medication-vision-module';
import { AppState } from 'react-native';
import { VisionLabService } from '../vision/VisionLabService';
import {
  ApplicationMedicationAppAdapter,
  DemoPillCounterAdapter,
  lazyNativeObjectCounter,
} from '../adapters';
import { LocalReminderService, expoLocalNotificationDriver } from '../notifications';
import { SqliteMedicationUnitOfWork } from '../storage';
import {
  DemoPayloadFingerprinter,
  IntlDailyScheduleResolver,
  RuntimeClock,
  RuntimeIdGenerator,
} from './demoDependencies';
import { initializeSecureLocalStorage } from './secureLocalStorage';

export interface DemoRuntime {
  vision: VisionLabService;
  api: ApplicationMedicationAppAdapter;
  application: MedicationApplicationService;
  reminders: LocalReminderService;
  notificationCapability: Awaited<ReturnType<LocalReminderService['initialize']>>;
  startupNotice: { legacyDataCleared: boolean };
  reconcile(): Promise<void>;
  dispose(): Promise<void>;
}

/**
 * Compatibility name retained for the route layer. Unlike the previous Demo
 * runtime, this function cannot return until the SQLCipher and encrypted-media
 * security gate has succeeded.
 */
export async function createDemoRuntime(): Promise<DemoRuntime> {
  const secure = await initializeSecureLocalStorage();
  let releaseVision: (() => Promise<void>) | undefined;
  try {
    const ids = new RuntimeIdGenerator();
    const vision = new VisionLabService(secure.storage.database, secure.media, new OnDeviceVisionProvider(), () => ids.next());
    // A pending visual-file cleanup must not block the medication main flow.
    await vision.cleanupDeleted().catch(() => undefined);
    const visionState = AppState.addEventListener('change', (state) => { if (state !== 'active') void vision.cancel(); });
    releaseVision = async () => { visionState.remove(); await vision.dispose(); };
    const clock = new RuntimeClock();
    const unitOfWork = new SqliteMedicationUnitOfWork(secure.storage.database);
    const application = new MedicationApplicationService({
      unitOfWork,
      ids,
      clock,
      fingerprinter: new DemoPayloadFingerprinter(),
      scheduleResolver: new IntlDailyScheduleResolver(),
    });
    const reminders = new LocalReminderService(expoLocalNotificationDriver);
    const notificationCapability = await reminders.initialize();
    const counter = new DemoPillCounterAdapter(lazyNativeObjectCounter);
    const api = new ApplicationMedicationAppAdapter({
      application,
      unitOfWork,
      media: secure.media,
      counter,
      reminders,
      nextId: () => ids.next(),
      now: () => new Date(clock.now()),
      getDatabaseSchemaVersion: async () => {
        const row = await secure.storage.database.getFirstAsync<{ user_version: number }>(
          'PRAGMA user_version',
        );
        return row?.user_version ?? null;
      },
      clearPersonalData: async () => {
        visionState.remove();
        await vision.dispose();
        await reminders.clearAll();
        await secure.media.clearAll();
        await secure.destroyAfterExplicitDataClear();
      },
    });
    await api.initialize();
    return {
      vision,
      api,
      application,
      reminders,
      notificationCapability,
      startupNotice: secure.startupNotice,
      reconcile: () => api.reconcileToday(),
      dispose: async () => { visionState.remove(); await vision.dispose(); await secure.dispose(); },
    };
  } catch (error) {
    await releaseVision?.().catch(() => undefined);
    await secure.dispose().catch(() => undefined);
    throw error;
  }
}
