/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import type { ClosedSetVisionResult, VisionAnalysisInput, VisionInferenceProvider } from 'medication-vision-module';
import type { SqlDatabase, SqlValue } from '../storage/database';
import { initializePersonalDatabaseV5 } from '../storage/migrations/v5';
import { VisionLabService } from './VisionLabService';
vi.mock('expo', () => ({ requireNativeModule: () => { throw new Error('not installed'); } }));

function result(input: VisionAnalysisInput): ClosedSetVisionResult {
  return { schemaVersion: '1', requestId: input.requestId, providerKind: 'on_device', capabilityTier: 'count_only', runtimeVersion: '2.2.0', durationMs: 1,
    quality: { status: 'acceptable', issues: [] }, count: { status: 'counted', detectedObjectCount: 1, boxes: [{ x: .1, y: .1, width: .2, height: .2 }] }, appearance: { status: 'unable', reason: 'model_unavailable' } };
}
async function fixture() {
  const raw = new DatabaseSync(':memory:');
  const db: SqlDatabase = {
    execAsync: async (sql) => { raw.exec(sql); },
    runAsync: async (sql, ...args: SqlValue[]) => { const r = raw.prepare(sql).run(...args); return { changes: Number(r.changes) }; },
    getFirstAsync: async <T>(sql: string, ...args: SqlValue[]) => (raw.prepare(sql).get(...args) ?? null) as T | null,
    getAllAsync: async <T>(sql: string, ...args: SqlValue[]) => raw.prepare(sql).all(...args) as T[],
    withTransactionAsync: async <T>(action: () => Promise<T>) => { raw.exec('BEGIN'); try { const value = await action(); raw.exec('COMMIT'); return value; } catch (e) { raw.exec('ROLLBACK'); throw e; } },
  };
  raw.exec('PRAGMA user_version=4; CREATE TABLE migration_journal(version INTEGER PRIMARY KEY,name TEXT,checksum TEXT,applied_at_utc TEXT); CREATE TABLE medications(id TEXT PRIMARY KEY,inventory INTEGER); INSERT INTO medications VALUES (\'keep\',20);');
  await initializePersonalDatabaseV5(db, '2026-08-31T00:00:00Z');
  let number = 0;
  const media = { persistPrivateCapture: vi.fn(async () => ({ relativePath: `encrypted-media/photos/photo-${++number}.med1`, mediaFormatVersion: 1 })),
    createDecryptedPreview: vi.fn(async (path: string) => ({ uri: `content://example.encryptedmedia/${path}` })), deletePreview: vi.fn(async () => undefined), deletePhoto: vi.fn(async () => undefined) };
  const provider: VisionInferenceProvider = { getCapability: vi.fn(async () => ({ available: true, providerKind: 'on_device', tier: 'count_only', runtimeVersion: '2.2.0', supportsBaselineComparison: false, supportsGroupCandidates: false, reason: 'model_missing' } as const)), analyze: vi.fn(async (input) => result(input)), cancel: vi.fn(async () => undefined) };
  const service = new VisionLabService(db, media, provider, () => `id-000000-${++number}`);
  const baseline = await service.createSample('sample A');
  const ready = async () => {
    await service.captureBaseline(baseline, 'front', 'file:///camera/front.jpg', true);
    await service.captureBaseline(baseline, 'back', 'file:///camera/back.jpg', true);
    await service.activate(baseline);
  };
  return { raw, db, media, provider, service, baseline, ready };
}

describe('encrypted host visual repository', () => {
  it('migrates v4 in place, repeats safely and never alters medication inventory', async () => {
    const f = await fixture();
    await initializePersonalDatabaseV5(f.db, '2026-08-31T00:00:00Z');
    expect(f.raw.prepare('PRAGMA user_version').get()).toEqual({ user_version: 5 });
    await f.ready();
    await f.service.analyze(f.baseline, 'file:///camera/analysis.jpg', true);
    expect(f.raw.prepare('SELECT inventory FROM medications').get()).toEqual({ inventory: 20 });
    expect(f.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    f.raw.close();
  });
  it('requires two distinct eligible sides and retires only the old version when activating new', async () => {
    const f = await fixture();
    await expect(f.service.activate(f.baseline)).rejects.toThrow('正反面');
    await f.ready();
    const sampleId = (await f.service.snapshot()).samples[0]!.id;
    const next = await f.service.createVersion(sampleId);
    await f.service.captureBaseline(next, 'front', 'file:///camera/2.jpg', true);
    await f.service.captureBaseline(next, 'back', 'file:///camera/3.jpg', true);
    await f.service.activate(next);
    expect((await f.service.snapshot()).baselines.filter((b) => b.status === 'active').map((b) => b.id)).toEqual([next]);
    await expect(f.service.captureBaseline(next, 'front', 'file:///new.jpg', true)).rejects.toThrow('状态');
    f.raw.close();
  });
  it('stores unsupported captures without inference and blocks baseline activation', async () => {
    const f = await fixture();
    await f.service.captureBaseline(f.baseline, 'front', 'file:///camera/half.jpg', false);
    expect(f.provider.analyze).not.toHaveBeenCalled();
    expect((await f.service.snapshot()).photos[0]!.eligible).toBe(false);
    expect(f.media.deletePreview).toHaveBeenCalledTimes(1);
    f.raw.close();
  });
  it('retains retakes, immutable analysis attempts, annotations and deletion tombstones', async () => {
    const f = await fixture();
    await f.service.captureBaseline(f.baseline, 'front', 'file:///camera/old.jpg', true);
    await f.ready();
    const analysis = await f.service.analyze(f.baseline, 'file:///camera/a.jpg', true);
    let snapshot = await f.service.snapshot();
    expect(snapshot.photos).toHaveLength(4);
    const photo = snapshot.analyses[0]!.photo_id;
    await f.service.retryAnalysis(photo);
    await f.service.annotate(analysis, 0, 'unable');
    await f.service.deletePhoto(photo);
    snapshot = await f.service.snapshot();
    expect(snapshot.analyses).toHaveLength(2);
    expect(snapshot.annotations).toHaveLength(1);
    expect(snapshot.photos.find((p) => p.id === photo)?.deleted_at_utc).toBeTruthy();
    await expect(f.service.preview(photo)).rejects.toThrow('删除');
    expect(f.media.deletePhoto).toHaveBeenCalledTimes(1);
    expect(f.raw.prepare('SELECT inventory FROM medications').get()).toEqual({ inventory: 20 });
    f.raw.close();
  });
  it('rolls back newly encrypted media on database failure and keeps old photos', async () => {
    const f = await fixture(); await f.ready();
    f.raw.exec("CREATE TRIGGER fail_photo BEFORE INSERT ON vision_photos BEGIN SELECT RAISE(ABORT,'SQLITE_FULL'); END;");
    await expect(f.service.analyze(f.baseline, 'file:///camera/new.jpg', true)).rejects.toThrow();
    expect(f.media.deletePhoto).toHaveBeenCalledTimes(1);
    expect((await f.service.snapshot()).photos).toHaveLength(2);
    f.raw.close();
  });
  it('does not commit late results after cancellation and releases all previews', async () => {
    const f = await fixture(); await f.ready();
    let resolve!: (result: ClosedSetVisionResult) => void;
    let started!: () => void; const began = new Promise<void>((r) => { started = r; });
    let input!: VisionAnalysisInput;
    vi.mocked(f.provider.analyze).mockImplementationOnce((request) => { input = request; started(); return new Promise((r) => { resolve = r; }); });
    const pending = f.service.analyze(f.baseline, 'file:///camera/late.jpg', true);
    await began; await f.service.cancel(); resolve(result(input));
    await expect(pending).rejects.toThrow('取消');
    expect((await f.service.snapshot()).analyses).toHaveLength(0);
    expect(f.media.createDecryptedPreview.mock.calls.length).toBe(f.media.deletePreview.mock.calls.length);
    expect(f.media.deletePhoto).toHaveBeenCalledTimes(1);
    f.raw.close();
  });
  it('retries physical deletion after failure and never revives an older baseline photo', async () => {
    const f = await fixture(); await f.ready();
    const photo = (await f.service.snapshot()).photos[0]!;
    f.media.deletePhoto.mockRejectedValueOnce(new Error('busy'));
    await expect(f.service.deletePhoto(photo.id)).rejects.toThrow('busy');
    expect((await f.service.snapshot()).baselines[0]!.status).toBe('retired');
    await f.service.cleanupDeleted();
    expect(f.raw.prepare('SELECT relative_path FROM vision_photos WHERE id=?').get(photo.id)).toEqual({ relative_path: null });
    f.raw.close();
  });
});
