import type { DemoApi, DemoNotificationState, DemoPhotoEvidence, DemoSnapshot, DoseLifecycle, ItemConsumptionAssertion } from "./demoApi";
import { getActiveDemoApiForUi } from "./demoApi";

export type MedicationScheduleInput = {
  reminderTime: string;
  plannedDoseQuantity: number;
};

export type CreateMedicationInput = {
  name: string;
  initialInventory: number;
  schedules: MedicationScheduleInput[];
};

/** @deprecated Use CreateMedicationInput. Kept as a source-compatible type alias. */
export type MedicationInput = CreateMedicationInput;

export type ThemeMode = "system" | "light" | "dark";
export type TextSize = "standard" | "large" | "extra_large";

export type PlanChangeResult = {
  effectiveLocalDate: string;
  effective: "today" | "tomorrow";
  replacedOccurrenceId?: string;
  newOccurrenceId?: string;
  notificationRebuildRequired?: boolean;
};

export type MedicationActivationResult = {
  effectiveLocalDate: string;
  effective: "today" | "tomorrow";
  affectedScheduleIds: string[];
  replacedOccurrenceIds: string[];
  newOccurrenceIds: string[];
  notificationRebuildRequired: boolean;
};

export type LocalDataSummary = {
  medicationCount: number;
  occurrenceCount: number;
  activePhotoCount: number;
  deletedPhotoCount: number;
  encryptedPhotoBytes: number | null;
};

export type SelfCheckItem = {
  key: string;
  label: string;
  status: "ok" | "warning" | "unavailable" | "checking";
  detail: string;
};

export type DeviceSelfCheck = {
  checkedAt: string;
  items: SelfCheckItem[];
};

export type RuntimeVersionInfo = {
  databaseSchemaVersion: number | null;
  mediaFormatVersion: number | null;
};

export type FollowUpType = "follow_up" | "refill" | "test";
export type FollowUpStatus = "scheduled" | "completed" | "cancelled";
export type AdvanceReminderDays = 0 | 1 | 3 | 7;

export type FollowUpInput = {
  type: FollowUpType;
  title: string;
  scheduledAt: string;
  medicationId: string | null;
  notes: string;
  advanceReminderDays: AdvanceReminderDays;
};

export type FollowUpItemView = FollowUpInput & {
  id: string;
  status: FollowUpStatus;
  completedAt: string | null;
  cancelledAt: string | null;
};

export type RefillReminderDays = 0 | 3 | 7 | 14 | 30;

export type InventoryPrediction =
  | {
      status: "available";
      estimatedDepletionLocalDate: string | null;
      nextInsufficientLocalDate: string | null;
    }
  | {
      status: "unavailable";
      reason:
        | "plan_paused"
        | "no_active_plan"
        | "invalid_balance"
        | "complex_schedule"
        | "waiting_for_runtime";
    };

export type PhotoView = DemoPhotoEvidence & {
  id: string;
  occurrenceId: string;
  previewUri?: string;
  deletionStatus?: "active" | "pending" | "deleted" | "failed";
};

export type MedicationScheduleView = {
  id: string;
  reminderTime: string;
  plannedDoseQuantity: number;
  status: "active" | "paused";
  onTimeOffsetMinutes: number;
  recordOffsetMinutes: number;
};

export type MedicationView = {
  id: string;
  name: string;
  quantityUnit: "count";
  inventoryBalance: number;
  planState: "active" | "paused" | "no_schedule";
  schedules: MedicationScheduleView[];
  refillReminderDays: RefillReminderDays;
  inventoryPrediction: InventoryPrediction;
};

export type DoseItemView = {
  id: string;
  medicationId: string;
  displayName: string;
  quantityUnit: "count";
  plannedDoseQuantity: number;
  assertion: ItemConsumptionAssertion;
  confirmedConsumptionQuantity: number | null;
  confirmedAt: string | null;
  revisions: {
    at: string;
    previousAssertion: ItemConsumptionAssertion;
    previousQuantity: number | null;
    reason: string;
  }[];
};

export type OccurrenceView = {
  id: string;
  localServiceDate: string;
  plannedAt: string;
  onTimeUntilAt: string;
  recordUntilAt: string;
  lifecycle: DoseLifecycle;
  preparedAt: string | null;
  completedAt: string | null;
  photo: PhotoView | null;
  photos?: PhotoView[];
  items: DoseItemView[];
};

export type InventoryEntryView = {
  id: string;
  medicationId: string;
  occurrenceId?: string;
  quantityDelta: number;
  reason: "initial" | "consumption" | "reversal" | "revision" | "manual_adjustment";
  createdAt: string;
};

export type MedicationAppSnapshot = {
  medications: MedicationView[];
  occurrences: OccurrenceView[];
  inventoryLedger: InventoryEntryView[];
  followUps: FollowUpItemView[];
};

type ExtendedCapabilities = {
  createMedication(input: CreateMedicationInput): Promise<string>;
  addMedicationSchedule(
    medicationId: string,
    input: MedicationScheduleInput,
  ): Promise<string>;
  updateMedicationSchedule(
    scheduleId: string,
    input: MedicationScheduleInput,
  ): Promise<PlanChangeResult>;
  pauseMedicationSchedule(scheduleId: string): Promise<PlanChangeResult>;
  resumeMedicationSchedule(scheduleId: string): Promise<PlanChangeResult>;
  deleteMedicationSchedule(scheduleId: string): Promise<PlanChangeResult>;
  pauseMedication(medicationId: string): Promise<MedicationActivationResult>;
  resumeMedication(medicationId: string): Promise<MedicationActivationResult>;
  correctInventory(
    medicationId: string,
    targetInventory: number,
    reason: string,
  ): Promise<void>;
  savePreferences(themeMode: ThemeMode, textSize: TextSize): Promise<void>;
  getPreferences(): Promise<{ themeMode: ThemeMode; textSize: TextSize }>;
  runSelfCheck(): Promise<DeviceSelfCheck>;
  sendTestReminder(): Promise<void>;
  getRuntimeVersionInfo(): Promise<RuntimeVersionInfo>;
  createFollowUp(input: FollowUpInput): Promise<string>;
  updateFollowUp(id: string, input: FollowUpInput): Promise<void>;
  completeFollowUp(id: string): Promise<void>;
  cancelFollowUp(id: string): Promise<void>;
  setRefillReminderDays(medicationId: string, days: RefillReminderDays): Promise<void>;
  getLocalDataSummary(): Promise<LocalDataSummary>;
  listPhotos(occurrenceId?: string): Promise<PhotoView[]>;
  createPhotoPreview(photoId: string): Promise<{ uri: string }>;
  releasePhotoPreview(uri: string): Promise<void>;
  deletePhoto(photoId: string): Promise<void>;
  reconcileToday(): Promise<void>;
  startOccurrenceEarly(occurrenceId: string): Promise<void>;
  appendRetakePhoto(occurrenceId: string, localUri: string): Promise<void>;
  clearAll(): Promise<void>;
};

export type MedicationAppCapabilities = Partial<ExtendedCapabilities>;

let installedCapabilities: MedicationAppCapabilities = {};

export function installMedicationAppCapabilities(next: MedicationAppCapabilities) {
  installedCapabilities = next;
}

export class CapabilityUnavailableError extends Error {
  constructor(public readonly capability: keyof ExtendedCapabilities) {
    super("此功能的本地服务尚未准备好，请稍后重试。");
    this.name = "CapabilityUnavailableError";
  }
}

function active(): DemoApi & Partial<ExtendedCapabilities> {
  return getActiveDemoApiForUi() as DemoApi & Partial<ExtendedCapabilities>;
}

function capability<K extends keyof ExtendedCapabilities>(name: K): ExtendedCapabilities[K] {
  const candidate = installedCapabilities[name];
  if (typeof candidate !== "function") throw new CapabilityUnavailableError(name);
  return candidate as ExtendedCapabilities[K];
}

export function photosForOccurrence(occurrence: OccurrenceView): PhotoView[] {
  if (occurrence.photos) return occurrence.photos;
  if (!occurrence.photo) return [];
  return [
    {
      ...occurrence.photo,
      id: `legacy-${occurrence.id}-${occurrence.photo.capturedAt}`,
      occurrenceId: occurrence.id,
      previewUri: occurrence.photo.localUri,
    },
  ];
}

function derivedSummary(snapshot: MedicationAppSnapshot): LocalDataSummary {
  const photos = snapshot.occurrences.flatMap(photosForOccurrence);
  return {
    medicationCount: snapshot.medications.length,
    occurrenceCount: snapshot.occurrences.length,
    activePhotoCount: photos.filter((photo) => photo.state === "captured").length,
    deletedPhotoCount: photos.filter((photo) => photo.state === "deleted_tombstone").length,
    encryptedPhotoBytes: null,
  };
}

let previousRawSnapshot: DemoSnapshot | undefined;
let previousViewSnapshot: MedicationAppSnapshot | undefined;

function viewSnapshot(): MedicationAppSnapshot {
  const raw = active().getSnapshot();
  if (raw === previousRawSnapshot && previousViewSnapshot) return previousViewSnapshot;
  const occurrences: OccurrenceView[] = raw.occurrences.map((occurrence) => {
    const legacyPhoto = occurrence.photo
      ? {
          ...occurrence.photo,
          id: `legacy-${occurrence.id}-${occurrence.photo.capturedAt}`,
          occurrenceId: occurrence.id,
        }
      : null;
    return {
      id: occurrence.id,
      localServiceDate: occurrence.localServiceDate,
      plannedAt: occurrence.plannedAt,
      onTimeUntilAt: occurrence.onTimeUntilAt,
      recordUntilAt: occurrence.recordUntilAt,
      lifecycle: occurrence.lifecycle,
      preparedAt: occurrence.preparedAt,
      completedAt: occurrence.completedAt,
      photo: legacyPhoto,
      photos: legacyPhoto ? [legacyPhoto] : [],
      items: occurrence.items.map((item) => ({
        id: item.id,
        medicationId: item.medicationId,
        displayName: item.displayName,
        quantityUnit: "count",
        plannedDoseQuantity: item.plannedDoseQuantity,
        assertion: item.assertion,
        confirmedConsumptionQuantity: item.confirmedConsumptionQuantity,
        confirmedAt: item.confirmedAt,
        revisions: item.revisions,
      })),
    };
  });
  previousRawSnapshot = raw;
  const extendedRaw = raw as DemoSnapshot & { followUps?: FollowUpItemView[] };
  previousViewSnapshot = {
    medications: raw.medications.map((medication) => {
      const extended = medication as typeof medication & {
        refillReminderDays?: RefillReminderDays;
        inventoryPrediction?: InventoryPrediction;
        planState?: MedicationView["planState"];
        schedules?: MedicationScheduleView[];
      };
      return {
      id: medication.id,
      name: medication.name,
      quantityUnit: "count",
      inventoryBalance: medication.inventoryBalance,
      planState: extended.planState ?? (medication.active ? "active" : "paused"),
      schedules: extended.schedules ?? [{
          id: `legacy-schedule-${medication.id}`,
          reminderTime: medication.reminderTime,
          plannedDoseQuantity: medication.plannedDoseQuantity,
          status: medication.active ? "active" : "paused",
          onTimeOffsetMinutes: 60,
          recordOffsetMinutes: 720,
        }],
      refillReminderDays: extended.refillReminderDays ?? 7,
      inventoryPrediction: extended.inventoryPrediction ?? {
        status: "unavailable",
        reason: "waiting_for_runtime",
      },
    };
    }),
    occurrences,
    inventoryLedger: raw.inventoryLedger.map((entry) => ({ ...entry, reason: entry.reason })),
    followUps: extendedRaw.followUps ?? [],
  };
  return previousViewSnapshot;
}

export const medicationAppApi = {
  getSnapshot: (): MedicationAppSnapshot => viewSnapshot(),
  subscribe: (listener: () => void) => active().subscribe(listener),
  getNotificationState: (): DemoNotificationState => active().getNotificationState(),
  createMedication: (input: CreateMedicationInput) => capability("createMedication")(input),
  addMedicationSchedule: (medicationId: string, input: MedicationScheduleInput) =>
    capability("addMedicationSchedule")(medicationId, input),
  updateMedicationSchedule: (scheduleId: string, input: MedicationScheduleInput) =>
    capability("updateMedicationSchedule")(scheduleId, input),
  pauseMedicationSchedule: (scheduleId: string) =>
    capability("pauseMedicationSchedule")(scheduleId),
  resumeMedicationSchedule: (scheduleId: string) =>
    capability("resumeMedicationSchedule")(scheduleId),
  deleteMedicationSchedule: (scheduleId: string) =>
    capability("deleteMedicationSchedule")(scheduleId),
  pauseMedication: (medicationId: string) => capability("pauseMedication")(medicationId),
  resumeMedication: (medicationId: string) => capability("resumeMedication")(medicationId),
  correctInventory: (medicationId: string, target: number, reason: string) =>
    capability("correctInventory")(medicationId, target, reason),
  savePreferences: (themeMode: ThemeMode, textSize: TextSize) =>
    capability("savePreferences")(themeMode, textSize),
  getPreferences: () => capability("getPreferences")(),
  runSelfCheck: () => capability("runSelfCheck")(),
  sendTestReminder: () => capability("sendTestReminder")(),
  getRuntimeVersionInfo: () => capability("getRuntimeVersionInfo")(),
  createFollowUp: (input: FollowUpInput) => capability("createFollowUp")(input),
  updateFollowUp: (id: string, input: FollowUpInput) =>
    capability("updateFollowUp")(id, input),
  completeFollowUp: (id: string) => capability("completeFollowUp")(id),
  cancelFollowUp: (id: string) => capability("cancelFollowUp")(id),
  setRefillReminderDays: (medicationId: string, days: RefillReminderDays) =>
    capability("setRefillReminderDays")(medicationId, days),
  getLocalDataSummary: async () =>
    installedCapabilities.getLocalDataSummary
      ? capability("getLocalDataSummary")()
      : derivedSummary(viewSnapshot()),
  listPhotos: async (occurrenceId?: string) => {
    if (installedCapabilities.listPhotos) return capability("listPhotos")(occurrenceId);
    const occurrences = viewSnapshot()
      .occurrences.filter((occurrence) => !occurrenceId || occurrence.id === occurrenceId);
    return occurrences.flatMap(photosForOccurrence);
  },
  createPhotoPreview: (photoId: string) => capability("createPhotoPreview")(photoId),
  releasePhotoPreview: (uri: string) => capability("releasePhotoPreview")(uri),
  deletePhoto: (photoId: string) => capability("deletePhoto")(photoId),
  reconcileToday: () => capability("reconcileToday")(),
  startOccurrenceEarly: (occurrenceId: string) =>
    capability("startOccurrenceEarly")(occurrenceId),
  appendRetakePhoto: (occurrenceId: string, localUri: string) =>
    capability("appendRetakePhoto")(occurrenceId, localUri),
  clearAll: () => capability("clearAll")(),
  raw: (): DemoApi => active(),
} as const;

export function readableError(error: unknown): string {
  if (error instanceof CapabilityUnavailableError) return error.message;
  if (error instanceof Error && error.message && !/[\\/](data|user|private)[\\/]/i.test(error.message)) {
    return error.message;
  }
  return "操作没有完成，请检查后重试。";
}
