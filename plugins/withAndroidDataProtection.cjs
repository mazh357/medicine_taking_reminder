const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');

const DATA_EXTRACTION_RULES = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
    <exclude domain="root" path="." />
    <exclude domain="file" path="." />
    <exclude domain="database" path="." />
    <exclude domain="sharedpref" path="." />
    <exclude domain="external" path="." />
    <exclude domain="device_root" path="." />
    <exclude domain="device_file" path="." />
    <exclude domain="device_database" path="." />
    <exclude domain="device_sharedpref" path="." />
  </cloud-backup>
  <device-transfer>
    <exclude domain="root" path="." />
    <exclude domain="file" path="." />
    <exclude domain="database" path="." />
    <exclude domain="sharedpref" path="." />
    <exclude domain="external" path="." />
    <exclude domain="device_root" path="." />
    <exclude domain="device_file" path="." />
    <exclude domain="device_database" path="." />
    <exclude domain="device_sharedpref" path="." />
  </device-transfer>
</data-extraction-rules>
`;

const FULL_BACKUP_RULES = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
  <exclude domain="root" path="." />
  <exclude domain="file" path="." />
  <exclude domain="database" path="." />
  <exclude domain="sharedpref" path="." />
  <exclude domain="external" path="." />
  <exclude domain="device_root" path="." />
  <exclude domain="device_file" path="." />
  <exclude domain="device_database" path="." />
  <exclude domain="device_sharedpref" path="." />
</full-backup-content>
`;

module.exports = function withAndroidDataProtection(config) {
  config = withAndroidManifest(config, (manifestConfig) => {
    const application = manifestConfig.modResults.manifest.application?.[0];
    if (!application) throw new Error('Android application manifest is missing');
    application.$['android:allowBackup'] = 'false';
    application.$['android:fullBackupContent'] = '@xml/backup_rules';
    application.$['android:dataExtractionRules'] = '@xml/data_extraction_rules';
    return manifestConfig;
  });

  return withDangerousMod(config, ['android', async (modConfig) => {
    const xmlDirectory = path.join(modConfig.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
    await mkdir(xmlDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(xmlDirectory, 'data_extraction_rules.xml'), DATA_EXTRACTION_RULES, 'utf8'),
      writeFile(path.join(xmlDirectory, 'backup_rules.xml'), FULL_BACKUP_RULES, 'utf8'),
    ]);
    return modConfig;
  }]);
};
