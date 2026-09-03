import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const requiredRoutes = [
  'app/_layout.tsx',
  'app/index.tsx',
  'app/(tabs)/_layout.tsx',
  'app/(tabs)/index.tsx',
  'app/(tabs)/medications.tsx',
  'app/(tabs)/history.tsx',
  'app/(tabs)/settings.tsx',
  'app/medication/new.tsx',
  'app/medication/[id]/edit.tsx',
  'app/task/[id]/capture.tsx',
  'app/task/[id]/count.tsx',
  'app/task/[id]/confirm.tsx',
  'app/history/[id]/index.tsx',
  'app/history/[id]/revise.tsx',
] as const;

const productionRoots = ['app', 'src', 'modules'] as const;
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.kt']);

function extension(path: string): string {
  const match = /\.[^.\\/]+$/.exec(path);
  return match?.[0] ?? '';
}

function listProductionSourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const info = statSync(path);
    if (info.isDirectory()) {
      if (entry === '__tests__' || entry === 'build' || entry === '.gradle') continue;
      files.push(...listProductionSourceFiles(path));
      continue;
    }
    if (sourceExtensions.has(extension(path)) && !/\.test\.[cm]?[jt]sx?$/.test(path)) {
      files.push(path);
    }
  }
  return files;
}

function productionSources(): Array<{ path: string; text: string }> {
  return productionRoots.flatMap((root) =>
    listProductionSourceFiles(resolve(projectRoot, root)).map((path) => ({
      path: relative(projectRoot, path).replaceAll('\\', '/'),
      text: readFileSync(path, 'utf8'),
    })),
  );
}

function matches(
  files: Array<{ path: string; text: string }>,
  pattern: RegExp,
): string[] {
  return files
    .filter(({ text }) => {
      pattern.lastIndex = 0;
      return pattern.test(text);
    })
    .map(({ path }) => path);
}

describe('QA: route and offline safety boundaries', () => {
  it('contains every route required by the local medication flow', () => {
    const missing = requiredRoutes.filter((path) => !existsSync(resolve(projectRoot, path)));
    expect(missing).toEqual([]);
  });

  it('keeps runtime remote updates disabled', () => {
    const appJson = JSON.parse(readFileSync(resolve(projectRoot, 'app.json'), 'utf8'));
    const packageJson = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'));

    expect(appJson.expo?.updates).toMatchObject({
      enabled: false,
      checkAutomatically: 'NEVER',
    });
    expect(packageJson.dependencies?.['expo-updates']).toBeUndefined();
    expect(appJson.expo?.extra).toMatchObject({
      personalLocalMode: true,
      encryptionRequired: true,
      realPatientDataAllowed: false,
      storageSchemaVersion: 6,
      mediaFormatVersion: 1,
    });
  });

  it('contains no business networking or telemetry primitives in production source', () => {
    const sources = productionSources();
    const prohibitedPatterns = [
      /\bfetch\s*\(/,
      /\bXMLHttpRequest\b/,
      /\bWebSocket\s*\(/,
      /\bEventSource\s*\(/,
      /\baxios\b/,
      /@sentry\/react-native/,
      /@react-native-firebase/,
      /\bhttps?:\/\//,
    ];
    const violations = prohibitedPatterns.flatMap((pattern) =>
      matches(sources, pattern).map((path) => `${pattern.source} -> ${path}`),
    );
    expect(violations).toEqual([]);
  });

  it('does not ship known real medication names in production source', () => {
    const sources = productionSources();
    const realMedicationNames = [
      '阿司匹林',
      '二甲双胍',
      '恩替卡韦',
      '替诺福韦',
      '拉米夫定',
      '氨氯地平',
      '缬沙坦',
      '胰岛素',
    ];
    const violations = realMedicationNames.flatMap((name) =>
      sources.filter(({ text }) => text.includes(name)).map(({ path }) => `${name} -> ${path}`),
    );
    expect(violations).toEqual([]);
  });

  it('does not present affirmative medication, dose or usability conclusions', () => {
    const sources = productionSources();
    const prohibitedConclusions = [
      '药品正确',
      '药物正确',
      '剂量正确',
      '识别一致',
      '可以服用',
      '确认药品无误',
      '确认剂量无误',
    ];
    const violations = prohibitedConclusions.flatMap((phrase) =>
      sources.filter(({ text }) => text.includes(phrase)).map(({ path }) => `${phrase} -> ${path}`),
    );
    expect(violations).toEqual([]);
  });

  it('keeps the native counter API observational and free of dose fields', () => {
    const types = readFileSync(
      resolve(projectRoot, 'modules/demo-pill-counter/src/DemoPillCounter.types.ts'),
      'utf8',
    );
    expect(types).toContain('detectedObjectCount');
    expect(types).not.toMatch(/plannedDoseQuantity|confirmedConsumptionQuantity|medicationId/);
  });
});
