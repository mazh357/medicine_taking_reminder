import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

describe('visual integration boundaries', () => {
  it('keeps the release offline after prebuild and does not add visual work to dose capture', () => {
    const plugin = readFileSync(resolve('plugins/withAndroidDataProtection.cjs'), 'utf8');
    expect(plugin).toContain('OFFLINE_RELEASE_MANIFEST');
    expect(plugin).toContain('android.permission.INTERNET" tools:node="remove"');
    expect(plugin).toContain("'app', 'src', 'release'");
    const capture = readFileSync(resolve('app/task/[id]/capture.tsx'), 'utf8');
    expect(capture).not.toMatch(/visionLab|medication-vision/);
  });
  it('pins the local package and does not need a sibling checkout', () => {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
    expect(pkg.dependencies['medication-vision-module']).toBe('file:vendor/medication-vision-module-0.2.0.tgz');
    expect(createHash('sha256').update(readFileSync(resolve('vendor/medication-vision-module-0.2.0.tgz'))).digest('hex')).toHaveLength(64);
    const manifest = JSON.parse(readFileSync(resolve('node_modules/medication-vision-module/android/src/main/assets/medication_vision/model-manifest.json'), 'utf8'));
    expect(manifest.thresholdsApproved).toBe(false);
    expect(manifest.approvedForClosedSetUse).toBe(false);
    expect(manifest.distributionApproved).toBe(true);
  });
  it('keeps visual SQL isolated from business facts', () => {
    const source = readFileSync(resolve('src/infrastructure/vision/VisionLabService.ts'), 'utf8');
    expect(source).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:medications|inventory|dose_|item_consumption)/i);
    expect(source).not.toMatch(/fetch\s*\(|https?:\/\//);
  });
});
