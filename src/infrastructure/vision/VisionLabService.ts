import { makeUnableResult, type ClosedSetVisionResult, type VisionAnalysisInput, type VisionInferenceProvider } from 'medication-vision-module';

import type { VisionAnnotation, VisionBaseline, VisionLabApi, VisionLabSnapshot, VisionSample } from '../../features/visionLabApi';
import type { AppPrivateMediaStore } from '../media/PrivateMediaStore';
import type { SqlDatabase } from '../storage/database';

type PhotoRow = { id: string; baseline_id: string; purpose: 'front' | 'back' | 'analysis'; relative_path: string | null; captured_at_utc: string; deleted_at_utc: string | null; validation_json: string | null; cleanup_pending: number };
type Media = Pick<AppPrivateMediaStore, 'persistPrivateCapture' | 'createDecryptedPreview' | 'deletePreview' | 'deletePhoto'>;
type SavedValidation = { supported: boolean; result: ClosedSetVisionResult };

/** A separate visual repository: SQL below never references medication, dose or inventory tables. */
export class VisionLabService implements VisionLabApi {
  private epoch = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private disposed = false;
  constructor(private db: SqlDatabase, private media: Media, private provider: VisionInferenceProvider,
    private id: () => string, private now: () => string = () => new Date().toISOString()) {}

  async snapshot(): Promise<VisionLabSnapshot> {
    return this.db.withTransactionAsync(async () => {
      const photos = await this.db.getAllAsync<PhotoRow>('SELECT * FROM vision_photos ORDER BY rowid');
      const analyses = await this.db.getAllAsync<{ id: string; photo_id: string; baseline_id: string; result_json: string; recorded_at_utc: string }>('SELECT * FROM vision_analyses ORDER BY rowid DESC');
      return {
        samples: await this.db.getAllAsync<VisionSample>('SELECT * FROM vision_samples ORDER BY rowid DESC'),
        baselines: await this.db.getAllAsync<VisionBaseline>('SELECT * FROM vision_baselines ORDER BY rowid DESC'),
        photos: photos.map(({ relative_path: _path, validation_json, cleanup_pending, ...photo }) => {
          const validation = this.validation(validation_json);
          return { ...photo, cleanupPending: cleanup_pending === 1, eligible: !photo.deleted_at_utc && this.eligible(validation), issue: validation?.result.quality.issues[0] ?? null };
        }),
        analyses: analyses.map(({ result_json, ...row }) => ({ ...row, result: JSON.parse(result_json) as ClosedSetVisionResult })),
        annotations: await this.db.getAllAsync<VisionAnnotation>('SELECT * FROM vision_annotations ORDER BY rowid'),
      };
    });
  }

  capability() { return this.provider.getCapability(); }
  createSample(label: string): Promise<string> {
    const clean = label.trim();
    if (!clean || clean.length > 40 || /[\u0000-\u001f\u007f-\u009f]/u.test(clean)) return Promise.reject(new Error('标签需为 1—40 个字符，不含换行。'));
    return this.serial(async () => this.db.withTransactionAsync(async () => {
      const sampleId = this.id();
      await this.db.runAsync('INSERT INTO vision_samples(id,label,created_at_utc) VALUES(?,?,?)', sampleId, clean, this.now());
      return this.insertVersion(sampleId);
    }));
  }
  createVersion(sampleId: string): Promise<string> {
    return this.serial(() => this.db.withTransactionAsync(async () => {
      const sample = await this.db.getFirstAsync<VisionSample>('SELECT * FROM vision_samples WHERE id=? AND deleted_at_utc IS NULL', sampleId);
      if (!sample) throw new Error('样本已删除。');
      const draft = await this.db.getFirstAsync<VisionBaseline>("SELECT * FROM vision_baselines WHERE sample_id=? AND status='draft' ORDER BY rowid DESC LIMIT 1", sampleId);
      return draft?.id ?? this.insertVersion(sampleId);
    }));
  }
  private async insertVersion(sampleId: string) {
    const id = this.id();
    await this.db.runAsync("INSERT INTO vision_baselines(id,sample_id,status,created_at_utc) VALUES(?,?,'draft',?)", id, sampleId, this.now());
    return id;
  }

  captureBaseline(versionId: string, view: 'front' | 'back', localUri: string, supported: boolean): Promise<void> {
    if (view !== 'front' && view !== 'back') return Promise.reject(new Error('无效拍摄面。'));
    return this.serial(async () => {
      const epoch = this.epoch;
      await this.version(versionId, 'draft');
      const stored = await this.media.persistPrivateCapture({ uri: localUri });
      try {
        const photoId = this.id();
        const result = await this.runPhoto(photoId, stored.relativePath, undefined, supported, epoch);
        this.assertCurrent(epoch);
        await this.db.withTransactionAsync(async () => {
          await this.version(versionId, 'draft');
          this.assertCurrent(epoch);
          await this.insertPhoto(photoId, versionId, view, stored.relativePath, supported, result);
        });
      } catch (error) { await this.media.deletePhoto(stored.relativePath); throw error; }
    });
  }

  activate(versionId: string): Promise<void> {
    return this.serial(() => this.db.withTransactionAsync(async () => {
      const version = await this.version(versionId, 'draft');
      await this.references(versionId);
      await this.db.runAsync("UPDATE vision_baselines SET status='retired' WHERE sample_id=? AND status='active'", version.sample_id);
      await this.db.runAsync("UPDATE vision_baselines SET status='active',activated_at_utc=? WHERE id=?", this.now(), versionId);
    }));
  }

  analyze(versionId: string, localUri: string, supported: boolean): Promise<string> {
    return this.serial(async () => {
      const epoch = this.epoch;
      await this.version(versionId, 'active');
      const refs = await this.references(versionId);
      const stored = await this.media.persistPrivateCapture({ uri: localUri });
      try {
        const photoId = this.id();
        const result = await this.runPhoto(photoId, stored.relativePath, { versionId, refs }, supported, epoch);
        this.assertCurrent(epoch);
        return await this.db.withTransactionAsync(async () => {
          await this.version(versionId, 'active');
          this.assertCurrent(epoch);
          await this.insertPhoto(photoId, versionId, 'analysis', stored.relativePath, supported, result);
          return this.insertAnalysis(photoId, versionId, result);
        });
      } catch (error) { await this.media.deletePhoto(stored.relativePath); throw error; }
    });
  }

  retryAnalysis(photoId: string): Promise<string> {
    return this.serial(async () => {
      const epoch = this.epoch;
      const photo = await this.photo(photoId);
      if (photo.purpose !== 'analysis') throw new Error('只能重试分析照片。');
      await this.version(photo.baseline_id);
      const refs = await this.references(photo.baseline_id);
      const result = await this.runPhoto(photo.id, photo.relative_path!, { versionId: photo.baseline_id, refs }, this.validation(photo.validation_json)?.supported === true, epoch);
      return this.db.withTransactionAsync(async () => {
        this.assertCurrent(epoch);
        await this.photo(photoId);
        return this.insertAnalysis(photoId, photo.baseline_id, result);
      });
    });
  }

  annotate(analysisId: string, objectIndex: number | null, value: VisionAnnotation['value']): Promise<void> {
    return this.serial(() => this.db.withTransactionAsync(async () => {
      if (!['looks_similar', 'looks_different', 'unable'].includes(value)) throw new Error('无效标注。');
      const row = await this.db.getFirstAsync<{ result_json: string }>('SELECT result_json FROM vision_analyses WHERE id=?', analysisId);
      if (!row) throw new Error('分析不存在。');
      const result = JSON.parse(row.result_json) as ClosedSetVisionResult;
      const count = result.count.status === 'counted' ? result.count.detectedObjectCount : 0;
      if (objectIndex !== null && (!Number.isInteger(objectIndex) || objectIndex < 0 || objectIndex >= count)) throw new Error('无效对象序号。');
      await this.db.runAsync('INSERT INTO vision_annotations(id,analysis_id,object_index,value,recorded_at_utc) VALUES(?,?,?,?,?)', this.id(), analysisId, objectIndex, value, this.now());
    }));
  }

  async preview(photoId: string): Promise<string> {
    const epoch = this.epoch;
    const photo = await this.photo(photoId);
    const preview = await this.media.createDecryptedPreview(photo.relative_path!);
    if (epoch !== this.epoch || this.disposed) { await this.media.deletePreview(preview.uri); throw new Error('预览已取消。'); }
    return preview.uri;
  }
  releasePreview(uri: string) { return this.media.deletePreview(uri); }

  deletePhoto(photoId: string): Promise<void> {
    return this.serial(async () => {
      await this.db.withTransactionAsync(async () => { await this.tombstonePhoto(photoId); });
      await this.cleanupDeleted();
    });
  }
  deleteSample(sampleId: string): Promise<void> {
    return this.serial(async () => {
      await this.db.withTransactionAsync(async () => {
        const photos = await this.db.getAllAsync<PhotoRow>('SELECT p.* FROM vision_photos p JOIN vision_baselines b ON b.id=p.baseline_id WHERE b.sample_id=?', sampleId);
        for (const photo of photos) await this.tombstonePhoto(photo.id);
        await this.db.runAsync("UPDATE vision_baselines SET status='deleted' WHERE sample_id=?", sampleId);
        await this.db.runAsync('UPDATE vision_samples SET deleted_at_utc=COALESCE(deleted_at_utc,?) WHERE id=?', this.now(), sampleId);
      });
      await this.cleanupDeleted();
    });
  }
  async cleanupDeleted(): Promise<void> {
    const rows = await this.db.getAllAsync<PhotoRow>('SELECT * FROM vision_photos WHERE cleanup_pending=1');
    for (const row of rows) {
      if (row.relative_path) await this.media.deletePhoto(row.relative_path);
      await this.db.withTransactionAsync(() => this.db.runAsync('UPDATE vision_photos SET relative_path=NULL,cleanup_pending=0 WHERE id=?', row.id));
    }
  }
  async cancel() { this.epoch += 1; await this.provider.cancel(); }
  async dispose() { this.disposed = true; await this.cancel(); await this.tail.catch(() => undefined); }

  private async tombstonePhoto(id: string) {
    const row = await this.db.getFirstAsync<PhotoRow>('SELECT * FROM vision_photos WHERE id=?', id);
    if (!row || row.deleted_at_utc) return;
    await this.db.runAsync('UPDATE vision_photos SET deleted_at_utc=?,cleanup_pending=1 WHERE id=?', this.now(), id);
    if (row.purpose !== 'analysis') await this.db.runAsync("UPDATE vision_baselines SET status='retired' WHERE id=? AND status='active'", row.baseline_id);
  }
  private async version(id: string, expected?: VisionBaseline['status']): Promise<VisionBaseline> {
    const row = await this.db.getFirstAsync<VisionBaseline>('SELECT b.* FROM vision_baselines b JOIN vision_samples s ON s.id=b.sample_id WHERE b.id=? AND s.deleted_at_utc IS NULL', id);
    if (!row || row.status === 'deleted' || (expected && row.status !== expected)) throw new Error('基线状态已变化，请返回样本页面。');
    return row;
  }
  private async photo(id: string): Promise<PhotoRow> {
    const row = await this.db.getFirstAsync<PhotoRow>('SELECT * FROM vision_photos WHERE id=? AND deleted_at_utc IS NULL', id);
    if (!row?.relative_path) throw new Error('照片已删除或不可用。');
    return row;
  }
  private async references(versionId: string): Promise<[PhotoRow, PhotoRow]> {
    const result: PhotoRow[] = [];
    for (const view of ['front', 'back']) {
      // Always check the latest capture, including its tombstone; never silently resurrect an older image.
      const row = await this.db.getFirstAsync<PhotoRow>('SELECT * FROM vision_photos WHERE baseline_id=? AND purpose=? ORDER BY rowid DESC LIMIT 1', versionId, view);
      if (!row || row.deleted_at_utc || !row.relative_path || !this.eligible(this.validation(row.validation_json))) throw new Error('正反面各需一张通过画质和单对象检查的照片。');
      result.push(row);
    }
    return result as [PhotoRow, PhotoRow];
  }
  private validation(json: string | null): SavedValidation | null {
    try { return json ? JSON.parse(json) as SavedValidation : null; } catch { return null; }
  }
  private eligible(value: SavedValidation | null): boolean {
    return value?.supported === true && value.result.quality.status === 'acceptable' && value.result.count.status === 'counted' && value.result.count.detectedObjectCount === 1;
  }
  private async insertPhoto(id: string, baseline: string, purpose: PhotoRow['purpose'], path: string, supported: boolean, result: ClosedSetVisionResult) {
    await this.db.runAsync('INSERT INTO vision_photos(id,baseline_id,purpose,relative_path,captured_at_utc,validation_json) VALUES(?,?,?,?,?,?)', id, baseline, purpose, path, this.now(), JSON.stringify({ supported, result }));
  }
  private async insertAnalysis(photoId: string, baseline: string, result: ClosedSetVisionResult) {
    const id = this.id();
    await this.db.runAsync('INSERT INTO vision_analyses(id,photo_id,baseline_id,result_json,recorded_at_utc) VALUES(?,?,?,?,?)', id, photoId, baseline, JSON.stringify(result), this.now());
    return id;
  }
  private async runPhoto(id: string, path: string, reference: { versionId: string; refs: [PhotoRow, PhotoRow] } | undefined, supported: boolean, epoch: number): Promise<ClosedSetVisionResult> {
    const previews: string[] = [];
    const open = async (file: string) => { this.assertCurrent(epoch); const p = await this.media.createDecryptedPreview(file); previews.push(p.uri); this.assertCurrent(epoch); return p.uri; };
    try {
      const currentUri = await open(path);
      const input: VisionAnalysisInput = { schemaVersion: '1', requestId: this.id(), mode: reference ? 'per_item' : 'baseline', currentImage: { photoEvidenceId: id, localUri: currentUri }, candidates: [] };
      if (reference) {
        const [front, back] = reference.refs;
        input.candidates = [{ localCandidateId: this.id(), baselineVersionId: reference.versionId, references: [
          { photoEvidenceId: front.id, localUri: await open(front.relative_path!), view: 'front' },
          { photoEvidenceId: back.id, localUri: await open(back.relative_path!), view: 'back' },
        ] }];
      }
      if (!supported) return { ...makeUnableResult(input, 'on_device', 'processing_error'), quality: { status: 'unable', issues: ['unsupported_image'] }, count: { status: 'unable', reason: 'unsupported_image' }, appearance: { status: 'unable', reason: 'quality_unacceptable' } };
      const result = await this.provider.analyze(input);
      this.assertCurrent(epoch);
      return result;
    } finally { await Promise.all(previews.map((uri) => this.media.deletePreview(uri))); }
  }
  private assertCurrent(epoch: number) { if (this.disposed || epoch !== this.epoch) throw new Error('操作已取消，请回到前台后重试。'); }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const epoch = this.epoch;
    const next = this.tail.then(() => { this.assertCurrent(epoch); return action(); });
    this.tail = next.catch(() => undefined);
    return next;
  }
}
