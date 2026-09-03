import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const readJson = (relativePath) =>
  JSON.parse(readFileSync(resolve(root, relativePath), 'utf8'));
const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

const packageJson = readJson('package.json');
const appJson = readJson('app.json');
const expoConfig = appJson.expo;

expect(packageJson.dependencies?.expo === '57.0.15', 'Expo must be locked to 57.0.15.');
expect(packageJson.main === 'expo-router/entry', 'Expo Router must be the application entry.');
expect(
  expoConfig?.android?.package === 'com.helpusurvive.medicationdemo',
  'Android package name changed unexpectedly.',
);
expect(expoConfig?.name === '长期用药助手', 'Visible application name is not the personal local product name.');
expect(expoConfig?.updates?.enabled === false, 'Runtime remote updates must be disabled.');
expect(expoConfig?.extra?.personalLocalMode === true, 'Personal local mode must remain explicit.');
expect(expoConfig?.extra?.encryptionRequired === true, 'The personal-data encryption gate must remain required.');
expect(
  expoConfig?.extra?.realPatientDataAllowed === false,
  'Real patient data must remain blocked until Android security evidence is signed off.',
);
expect(
  expoConfig?.extra?.storageSchemaVersion === 6,
  'Personal storage schema must be v6.',
);
const sqlitePlugin = expoConfig?.plugins?.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-sqlite',
);
expect(sqlitePlugin?.[1]?.useSQLCipher === true, 'SQLCipher must be enabled in the Expo SQLite plugin.');
expect(packageJson.dependencies?.['expo-secure-store'], 'expo-secure-store is required.');
expect(packageJson.dependencies?.['expo-crypto'], 'expo-crypto is required.');
expect(
  existsSync(resolve(root, 'modules/demo-pill-counter/expo-module.config.json')),
  'DemoPillCounter local Expo module is missing.',
);
expect(
  existsSync(resolve(root, 'modules/local-data-crypto/expo-module.config.json')),
  'LocalDataCrypto native module is missing.',
);
if (existsSync(resolve(root, 'android'))) {
  expect(
    existsSync(resolve(root, 'android/app/src/main/res/xml/backup_rules.xml')),
    'Android backup exclusion rules are missing.',
  );
  expect(
    existsSync(resolve(root, 'android/app/src/main/res/xml/data_extraction_rules.xml')),
    'Android data extraction exclusion rules are missing.',
  );
}

const prohibitedDependencies = [
  '@sentry/react-native',
  'axios',
  'firebase',
  '@react-native-firebase/app',
  'openai',
];
const allDependencies = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
};
for (const dependency of prohibitedDependencies) {
  expect(!(dependency in allDependencies), `Prohibited network or telemetry dependency: ${dependency}`);
}

if (failures.length > 0) {
  console.error('Platform scaffold verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Platform scaffold verification passed.');
}
