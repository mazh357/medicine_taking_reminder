/**
 * UI-facing application adapter for the installable Demo.
 *
 * The in-memory implementation exists only so the UI can be previewed before
 * SQLite, notifications, camera storage and the native counter are connected.
 * Screens must depend on this contract instead of importing infrastructure.
 */

export type DoseLifecycle =
  | "scheduled"
  | "due"
  | "prepared"
  | "taken_confirmed"
  | "late_taken"
  | "missed"
  | "revoked";

export type ItemConsumptionAssertion =
  | "pending"
  | "taken_as_planned"
  | "partially_taken"
  | "not_taken";

export type PhotoEvidenceState =
  | "captured"
  | "skipped_with_reason"
  | "deleted_tombstone";

export type CountUnableReason =
  | "low_contrast"
  | "blur"
  | "overlap"
  | "background_noise"
  | "too_dark"
  | "processing_error";

export type DemoCountResult =
  | {
      status: "counted";
      detectedObjectCount: number;
      quality: "acceptable";
      boxes?: { x: number; y: number; width: number; height: number }[];
    }
  | { status: "unable"; reason: CountUnableReason };

export type DemoMedication = {
  id: string;
  name: string;
  unit: "片" | "粒";
  plannedDoseQuantity: number;
  inventoryBalance: number;
  reminderTime: string;
  active: boolean;
};

export type DemoDoseItem = {
  id: string;
  medicationId: string;
  displayName: string;
  unit: "片" | "粒";
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

export type DemoPhotoEvidence = {
  state: PhotoEvidenceState;
  capturePurpose: "initial" | "retake";
  capturedAt: string;
  localUri?: string;
  skipReason?: "camera_unavailable" | "environment_inconvenient" | "other";
  skipNote?: string;
  detectedObjectCount: number | null;
  countSource: "counter" | "manual" | null;
  countUnableReason?: CountUnableReason;
};

export type DemoOccurrence = {
  id: string;
  localServiceDate: string;
  plannedAt: string;
  onTimeUntilAt: string;
  recordUntilAt: string;
  lifecycle: DoseLifecycle;
  preparedAt: string | null;
  completedAt: string | null;
  photo: DemoPhotoEvidence | null;
  items: DemoDoseItem[];
};

export type DemoInventoryEntry = {
  id: string;
  medicationId: string;
  occurrenceId?: string;
  quantityDelta: number;
  reason: "initial" | "consumption" | "reversal" | "revision" | "manual_adjustment";
  createdAt: string;
};

export type DemoNotificationState =
  | { status: "ready" }
  | { status: "scheduled" }
  | {
      status: "degraded";
      reason:
        | "not_initialized"
        | "permission_undetermined"
        | "permission_denied"
        | "notifications_unavailable"
        | "scheduling_error";
    };

export type DemoSnapshot = {
  safetyNoticeAccepted: boolean;
  medications: DemoMedication[];
  occurrences: DemoOccurrence[];
  inventoryLedger: DemoInventoryEntry[];
};

export type NewMedicationInput = Omit<
  DemoMedication,
  "id" | "active" | "inventoryBalance"
> & { initialInventory: number };

export interface DemoApi {
  getSnapshot: () => DemoSnapshot;
  getNotificationState: () => DemoNotificationState;
  subscribe: (listener: () => void) => () => void;
  acceptSafetyNotice(): Promise<void>;
  loadSampleData(): Promise<void>;
  createMedication(input: NewMedicationInput): Promise<string>;
  updateMedication(
    medicationId: string,
    input: NewMedicationInput,
  ): Promise<void>;
  saveCapturedPhoto(occurrenceId: string, localUri: string): Promise<void>;
  appendRetakePhoto(occurrenceId: string, localUri: string): Promise<void>;
  startOccurrenceEarly(occurrenceId: string): Promise<void>;
  reconcileToday(): Promise<void>;
  countCapturedPhoto(occurrenceId: string): Promise<DemoCountResult>;
  skipPhoto(
    occurrenceId: string,
    reason: NonNullable<DemoPhotoEvidence["skipReason"]>,
    note?: string,
  ): Promise<void>;
  storeCountResult(occurrenceId: string, result: DemoCountResult): Promise<void>;
  storeManualObjectCount(occurrenceId: string, count: number | null): Promise<void>;
  confirmDoseItem(
    occurrenceId: string,
    itemId: string,
    assertion: Exclude<ItemConsumptionAssertion, "pending">,
    confirmedConsumptionQuantity: number,
  ): Promise<void>;
  reviseDoseItem(
    occurrenceId: string,
    itemId: string,
    assertion: Exclude<ItemConsumptionAssertion, "pending">,
    confirmedConsumptionQuantity: number,
    reason: string,
  ): Promise<void>;
  revokeOccurrence(occurrenceId: string): Promise<void>;
  clearAll(): Promise<void>;
}

const now = () => new Date().toISOString();
const id = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const emptySnapshot = (): DemoSnapshot => ({
  safetyNoticeAccepted: false,
  medications: [],
  occurrences: [],
  inventoryLedger: [],
});

function deriveLifecycle(items: DemoDoseItem[]): DoseLifecycle {
  if (items.some((item) => item.assertion === "pending")) return "prepared";
  if (items.every((item) => item.assertion === "not_taken")) return "missed";
  return "taken_confirmed";
}

class InMemoryDemoApi implements DemoApi {
  private snapshot: DemoSnapshot = emptySnapshot();
  private readonly listeners = new Set<() => void>();

  getSnapshot = () => this.snapshot;

  getNotificationState = (): DemoNotificationState => ({
    status: "degraded",
    reason: "not_initialized",
  });

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private commit(next: DemoSnapshot) {
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }

  async acceptSafetyNotice() {
    this.commit({ ...this.snapshot, safetyNoticeAccepted: true });
  }

  async reconcileToday() {}

  async startOccurrenceEarly(occurrenceId: string) {
    this.mapOccurrence(occurrenceId, (occurrence) => ({ ...occurrence, lifecycle: "due" }));
  }

  async appendRetakePhoto(occurrenceId: string, localUri: string) {
    this.mapOccurrence(occurrenceId, (occurrence) => ({
      ...occurrence,
      photo: {
        state: "captured",
        capturePurpose: "retake",
        capturedAt: now(),
        localUri,
        detectedObjectCount: null,
        countSource: null,
      },
    }));
  }

  async loadSampleData() {
    const first: DemoMedication = {
      id: id("med"),
      name: "演示药A",
      unit: "片",
      plannedDoseQuantity: 1,
      inventoryBalance: 30,
      reminderTime: "08:00",
      active: true,
    };
    const second: DemoMedication = {
      id: id("med"),
      name: "演示药B",
      unit: "粒",
      plannedDoseQuantity: 2,
      inventoryBalance: 20,
      reminderTime: "08:00",
      active: true,
    };
    const occurrence = this.makeOccurrence([first, second]);
    this.commit({
      ...this.snapshot,
      medications: [first, second],
      occurrences: [occurrence],
      inventoryLedger: [first, second].map((medication) => ({
        id: id("ledger"),
        medicationId: medication.id,
        quantityDelta: medication.inventoryBalance,
        reason: "initial" as const,
        createdAt: now(),
      })),
    });
  }

  async createMedication(input: NewMedicationInput) {
    const medication: DemoMedication = {
      id: id("med"),
      name: input.name.trim(),
      unit: input.unit,
      plannedDoseQuantity: input.plannedDoseQuantity,
      inventoryBalance: input.initialInventory,
      reminderTime: input.reminderTime,
      active: true,
    };
    const medications = [...this.snapshot.medications, medication];
    const open = this.snapshot.occurrences.find((item) => item.lifecycle === "due");
    const occurrences = open
      ? this.snapshot.occurrences.map((item) =>
          item.id === open.id
            ? {
                ...item,
                items: [
                  ...item.items,
                  this.makeDoseItem(medication),
                ],
              }
            : item,
        )
      : [this.makeOccurrence(medications), ...this.snapshot.occurrences];
    this.commit({
      ...this.snapshot,
      medications,
      occurrences,
      inventoryLedger: [
        ...this.snapshot.inventoryLedger,
        {
          id: id("ledger"),
          medicationId: medication.id,
          quantityDelta: medication.inventoryBalance,
          reason: "initial",
          createdAt: now(),
        },
      ],
    });
    return medication.id;
  }

  async updateMedication(medicationId: string, input: NewMedicationInput) {
    const previous = this.snapshot.medications.find(
      (medication) => medication.id === medicationId,
    );
    if (!previous) return;
    const inventoryDelta = input.initialInventory - previous.inventoryBalance;
    this.commit({
      ...this.snapshot,
      medications: this.snapshot.medications.map((medication) =>
        medication.id === medicationId
          ? {
              ...medication,
              name: input.name.trim(),
              unit: input.unit,
              plannedDoseQuantity: input.plannedDoseQuantity,
              reminderTime: input.reminderTime,
              inventoryBalance: input.initialInventory,
            }
          : medication,
      ),
      occurrences: this.snapshot.occurrences.map((occurrence) =>
        occurrence.lifecycle === "due"
          ? {
              ...occurrence,
              items: occurrence.items.map((item) =>
                item.medicationId === medicationId
                  ? {
                      ...item,
                      displayName: input.name.trim(),
                      unit: input.unit,
                      plannedDoseQuantity: input.plannedDoseQuantity,
                    }
                  : item,
              ),
            }
          : occurrence,
      ),
      inventoryLedger:
        inventoryDelta === 0
          ? this.snapshot.inventoryLedger
          : [
              ...this.snapshot.inventoryLedger,
              {
                id: id("ledger"),
                medicationId,
                quantityDelta: inventoryDelta,
                reason: "revision",
                createdAt: now(),
              },
            ],
    });
  }

  async saveCapturedPhoto(occurrenceId: string, localUri: string) {
    this.mapOccurrence(occurrenceId, (occurrence) => ({
      ...occurrence,
      lifecycle: "prepared",
      preparedAt: now(),
      photo: {
        state: "captured",
        capturePurpose: "initial",
        capturedAt: now(),
        localUri,
        detectedObjectCount: null,
        countSource: null,
      },
    }));
  }

  async countCapturedPhoto(_occurrenceId: string): Promise<DemoCountResult> {
    // Deliberately unrelated to plan or dose quantities. The native/application
    // adapter replaces this deterministic preview result during integration.
    return {
      status: "counted",
      detectedObjectCount: 4,
      quality: "acceptable",
    };
  }

  async skipPhoto(
    occurrenceId: string,
    reason: NonNullable<DemoPhotoEvidence["skipReason"]>,
    note?: string,
  ) {
    this.mapOccurrence(occurrenceId, (occurrence) => ({
      ...occurrence,
      lifecycle: "prepared",
      preparedAt: now(),
      photo: {
        state: "skipped_with_reason",
        capturePurpose: "initial",
        capturedAt: now(),
        skipReason: reason,
        skipNote: note?.trim() || undefined,
        detectedObjectCount: null,
        countSource: null,
      },
    }));
  }

  async storeCountResult(occurrenceId: string, result: DemoCountResult) {
    this.mapOccurrence(occurrenceId, (occurrence) => {
      if (!occurrence.photo) return occurrence;
      return {
        ...occurrence,
        photo: {
          ...occurrence.photo,
          detectedObjectCount:
            result.status === "counted" ? result.detectedObjectCount : null,
          countSource: result.status === "counted" ? "counter" : null,
          countUnableReason:
            result.status === "unable" ? result.reason : undefined,
        },
      };
    });
  }

  async storeManualObjectCount(occurrenceId: string, count: number | null) {
    this.mapOccurrence(occurrenceId, (occurrence) =>
      occurrence.photo
        ? {
            ...occurrence,
            photo: {
              ...occurrence.photo,
              detectedObjectCount: count,
              countSource: count === null ? null : "manual",
            },
          }
        : occurrence,
    );
  }

  async confirmDoseItem(
    occurrenceId: string,
    itemId: string,
    assertion: Exclude<ItemConsumptionAssertion, "pending">,
    confirmedConsumptionQuantity: number,
  ) {
    const entries: DemoInventoryEntry[] = [];
    this.mapOccurrence(occurrenceId, (occurrence) => {
      const items = occurrence.items.map((item) => {
        if (item.id !== itemId) return item;
        if (item.assertion !== "pending") return item;
        if (confirmedConsumptionQuantity > 0) {
          entries.push({
            id: id("ledger"),
            medicationId: item.medicationId,
            occurrenceId,
            quantityDelta: -confirmedConsumptionQuantity,
            reason: "consumption",
            createdAt: now(),
          });
        }
        return {
          ...item,
          assertion,
          confirmedConsumptionQuantity,
          confirmedAt: now(),
        };
      });
      const lifecycle = deriveLifecycle(items);
      return {
        ...occurrence,
        items,
        lifecycle,
        completedAt: lifecycle === "prepared" ? null : now(),
      };
    }, entries);
  }

  async reviseDoseItem(
    occurrenceId: string,
    itemId: string,
    assertion: Exclude<ItemConsumptionAssertion, "pending">,
    confirmedConsumptionQuantity: number,
    reason: string,
  ) {
    const entries: DemoInventoryEntry[] = [];
    this.mapOccurrence(occurrenceId, (occurrence) => {
      const items = occurrence.items.map((item) => {
        if (item.id !== itemId) return item;
        const previousQuantity = item.confirmedConsumptionQuantity ?? 0;
        if (previousQuantity > 0) {
          entries.push({
            id: id("ledger"),
            medicationId: item.medicationId,
            occurrenceId,
            quantityDelta: previousQuantity,
            reason: "reversal",
            createdAt: now(),
          });
        }
        if (confirmedConsumptionQuantity > 0) {
          entries.push({
            id: id("ledger"),
            medicationId: item.medicationId,
            occurrenceId,
            quantityDelta: -confirmedConsumptionQuantity,
            reason: "revision",
            createdAt: now(),
          });
        }
        return {
          ...item,
          assertion,
          confirmedConsumptionQuantity,
          confirmedAt: now(),
          revisions: [
            ...item.revisions,
            {
              at: now(),
              previousAssertion: item.assertion,
              previousQuantity: item.confirmedConsumptionQuantity,
              reason: reason.trim(),
            },
          ],
        };
      });
      return { ...occurrence, items, lifecycle: deriveLifecycle(items) };
    }, entries);
  }

  async revokeOccurrence(occurrenceId: string) {
    const entries: DemoInventoryEntry[] = [];
    this.mapOccurrence(occurrenceId, (occurrence) => {
      if (occurrence.lifecycle === "revoked") return occurrence;
      occurrence.items.forEach((item) => {
        const quantity = item.confirmedConsumptionQuantity ?? 0;
        if (quantity > 0) {
          entries.push({
            id: id("ledger"),
            medicationId: item.medicationId,
            occurrenceId,
            quantityDelta: quantity,
            reason: "reversal",
            createdAt: now(),
          });
        }
      });
      return { ...occurrence, lifecycle: "revoked" };
    }, entries);
  }

  async clearAll() {
    this.commit(emptySnapshot());
  }

  private makeDoseItem(medication: DemoMedication): DemoDoseItem {
    return {
      id: id("item"),
      medicationId: medication.id,
      displayName: medication.name,
      unit: medication.unit,
      plannedDoseQuantity: medication.plannedDoseQuantity,
      assertion: "pending",
      confirmedConsumptionQuantity: null,
      confirmedAt: null,
      revisions: [],
    };
  }

  private makeOccurrence(medications: DemoMedication[]): DemoOccurrence {
    const plannedAt = now();
    return {
      id: id("occ"),
      localServiceDate: plannedAt.slice(0, 10),
      plannedAt,
      onTimeUntilAt: new Date(Date.parse(plannedAt) + 60 * 60_000).toISOString(),
      recordUntilAt: new Date(Date.parse(plannedAt) + 12 * 60 * 60_000).toISOString(),
      lifecycle: "due",
      preparedAt: null,
      completedAt: null,
      photo: null,
      items: medications.map((medication) => this.makeDoseItem(medication)),
    };
  }

  private mapOccurrence(
    occurrenceId: string,
    mapper: (occurrence: DemoOccurrence) => DemoOccurrence,
    extraEntries: DemoInventoryEntry[] = [],
  ) {
    const occurrences = this.snapshot.occurrences.map((occurrence) =>
      occurrence.id === occurrenceId ? mapper(occurrence) : occurrence,
    );
    const deltasByMedication = extraEntries.reduce<Record<string, number>>(
      (result, entry) => ({
        ...result,
        [entry.medicationId]:
          (result[entry.medicationId] ?? 0) + entry.quantityDelta,
      }),
      {},
    );
    const medications = this.snapshot.medications.map((medication) => ({
      ...medication,
      inventoryBalance:
        medication.inventoryBalance + (deltasByMedication[medication.id] ?? 0),
    }));
    this.commit({
      ...this.snapshot,
      occurrences,
      medications,
      inventoryLedger: [...this.snapshot.inventoryLedger, ...extraEntries],
    });
  }
}

export const memoryDemoApi = new InMemoryDemoApi();

let activeDemoApi: DemoApi = memoryDemoApi;
let detachActiveSubscription = activeDemoApi.subscribe(() => notifyProxyListeners());
const proxyListeners = new Set<() => void>();

function notifyProxyListeners() {
  proxyListeners.forEach((listener) => listener());
}

/**
 * Installs the persistent application adapter after native infrastructure has
 * initialized. Subscribers stay attached to this stable proxy while the
 * underlying implementation changes exactly once during app startup.
 */
export function installDemoApi(next: DemoApi): void {
  if (activeDemoApi === next) return;
  detachActiveSubscription();
  activeDemoApi = next;
  detachActiveSubscription = activeDemoApi.subscribe(() => notifyProxyListeners());
  notifyProxyListeners();
}

/** UI bridge for optional personal-version capabilities installed by runtime. */
export function getActiveDemoApiForUi(): DemoApi {
  return activeDemoApi;
}

export const demoApi: DemoApi = {
  getSnapshot: () => activeDemoApi.getSnapshot(),
  getNotificationState: () => activeDemoApi.getNotificationState(),
  subscribe: (listener) => {
    proxyListeners.add(listener);
    return () => proxyListeners.delete(listener);
  },
  acceptSafetyNotice: () => activeDemoApi.acceptSafetyNotice(),
  loadSampleData: () => activeDemoApi.loadSampleData(),
  createMedication: (input) => activeDemoApi.createMedication(input),
  updateMedication: (medicationId, input) =>
    activeDemoApi.updateMedication(medicationId, input),
  saveCapturedPhoto: (occurrenceId, localUri) =>
    activeDemoApi.saveCapturedPhoto(occurrenceId, localUri),
  appendRetakePhoto: (occurrenceId, localUri) =>
    activeDemoApi.appendRetakePhoto(occurrenceId, localUri),
  startOccurrenceEarly: (occurrenceId) => activeDemoApi.startOccurrenceEarly(occurrenceId),
  reconcileToday: () => activeDemoApi.reconcileToday(),
  countCapturedPhoto: (occurrenceId) =>
    activeDemoApi.countCapturedPhoto(occurrenceId),
  skipPhoto: (occurrenceId, reason, note) =>
    activeDemoApi.skipPhoto(occurrenceId, reason, note),
  storeCountResult: (occurrenceId, result) =>
    activeDemoApi.storeCountResult(occurrenceId, result),
  storeManualObjectCount: (occurrenceId, count) =>
    activeDemoApi.storeManualObjectCount(occurrenceId, count),
  confirmDoseItem: (occurrenceId, itemId, assertion, quantity) =>
    activeDemoApi.confirmDoseItem(occurrenceId, itemId, assertion, quantity),
  reviseDoseItem: (occurrenceId, itemId, assertion, quantity, reason) =>
    activeDemoApi.reviseDoseItem(
      occurrenceId,
      itemId,
      assertion,
      quantity,
      reason,
    ),
  revokeOccurrence: (occurrenceId) =>
    activeDemoApi.revokeOccurrence(occurrenceId),
  clearAll: () => activeDemoApi.clearAll(),
};
