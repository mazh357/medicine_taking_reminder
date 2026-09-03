import { afterEach, describe, expect, it, vi } from 'vitest';

import { installMedicationAppCapabilities, medicationAppApi } from './medicationAppApi';

afterEach(() => installMedicationAppCapabilities({}));

describe('medicationAppApi destructive clear gate', () => {
  it('uses the root-installed runtime lifecycle capability', async () => {
    const clearAll = vi.fn().mockResolvedValue(undefined);
    installMedicationAppCapabilities({ clearAll });

    await medicationAppApi.clearAll();

    expect(clearAll).toHaveBeenCalledOnce();
  });
});

describe('medicationAppApi multi-schedule capability bridge', () => {
  it('forwards schedule and medication activation commands without collapsing them', async () => {
    const createMedication = vi.fn().mockResolvedValue('medication-1');
    const addMedicationSchedule = vi.fn().mockResolvedValue('schedule-3');
    const updateMedicationSchedule = vi.fn().mockResolvedValue({
      effectiveLocalDate: '2026-09-02', effective: 'today',
    });
    const pauseMedicationSchedule = vi.fn().mockResolvedValue({
      effectiveLocalDate: '2026-09-02', effective: 'today',
    });
    const resumeMedicationSchedule = vi.fn().mockResolvedValue({
      effectiveLocalDate: '2026-09-03', effective: 'tomorrow',
    });
    const deleteMedicationSchedule = vi.fn().mockResolvedValue({
      effectiveLocalDate: '2026-09-03', effective: 'tomorrow',
    });
    const medicationActivation = {
      effectiveLocalDate: '2026-09-02',
      effective: 'today' as const,
      affectedScheduleIds: ['schedule-1', 'schedule-2'],
      replacedOccurrenceIds: [],
      newOccurrenceIds: [],
      notificationRebuildRequired: false,
    };
    const pauseMedication = vi.fn().mockResolvedValue(medicationActivation);
    const resumeMedication = vi.fn().mockResolvedValue(medicationActivation);
    installMedicationAppCapabilities({
      createMedication,
      addMedicationSchedule,
      updateMedicationSchedule,
      pauseMedicationSchedule,
      resumeMedicationSchedule,
      deleteMedicationSchedule,
      pauseMedication,
      resumeMedication,
    });

    const input = {
      name: '药物 A', initialInventory: 30,
      schedules: [
        { reminderTime: '08:00', plannedDoseQuantity: 1 },
        { reminderTime: '20:00', plannedDoseQuantity: 0.5 },
      ],
    };
    await expect(medicationAppApi.createMedication(input)).resolves.toBe('medication-1');
    await medicationAppApi.addMedicationSchedule('medication-1', {
      reminderTime: '12:00', plannedDoseQuantity: 1,
    });
    await medicationAppApi.updateMedicationSchedule('schedule-1', {
      reminderTime: '09:00', plannedDoseQuantity: 2,
    });
    await medicationAppApi.pauseMedicationSchedule('schedule-1');
    await medicationAppApi.resumeMedicationSchedule('schedule-1');
    await medicationAppApi.deleteMedicationSchedule('schedule-1');
    await medicationAppApi.pauseMedication('medication-1');
    await medicationAppApi.resumeMedication('medication-1');

    expect(createMedication).toHaveBeenCalledWith(input);
    expect(addMedicationSchedule).toHaveBeenCalledWith('medication-1', {
      reminderTime: '12:00', plannedDoseQuantity: 1,
    });
    expect(updateMedicationSchedule).toHaveBeenCalledWith('schedule-1', {
      reminderTime: '09:00', plannedDoseQuantity: 2,
    });
    expect(pauseMedicationSchedule).toHaveBeenCalledWith('schedule-1');
    expect(resumeMedicationSchedule).toHaveBeenCalledWith('schedule-1');
    expect(deleteMedicationSchedule).toHaveBeenCalledWith('schedule-1');
    expect(pauseMedication).toHaveBeenCalledWith('medication-1');
    expect(resumeMedication).toHaveBeenCalledWith('medication-1');
  });
});
