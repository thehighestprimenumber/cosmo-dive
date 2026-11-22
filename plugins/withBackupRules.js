// Android Auto Backup (to your Google account): include the app's database.
// expo-secure-store's rules only list shared preferences, which left the
// SQLite history out of the backup. These rules keep its exclusion of the
// encrypted key store (keys can't be restored on another phone) and add the
// database folder.
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const RULES = `
    <include domain="file" path="SQLite/"/>
    <include domain="sharedpref" path="."/>
    <exclude domain="sharedpref" path="SecureStore"/>`;

const FULL_BACKUP = `<?xml version="1.0" encoding="utf-8"?>
<!-- Auto Backup, Android 11 and lower (plugins/withBackupRules.js) -->
<full-backup-content>${RULES}
</full-backup-content>
`;

const EXTRACTION = `<?xml version="1.0" encoding="utf-8"?>
<!-- Auto Backup and device transfer, Android 12+ (plugins/withBackupRules.js) -->
<data-extraction-rules>
  <cloud-backup>${RULES}
  </cloud-backup>
  <device-transfer>${RULES}
  </device-transfer>
</data-extraction-rules>
`;

module.exports = function withBackupRules(config) {
  config = withDangerousMod(config, [
    'android',
    (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'daily_spark_backup_rules.xml'), FULL_BACKUP);
      fs.writeFileSync(path.join(dir, 'daily_spark_data_extraction_rules.xml'), EXTRACTION);
      return c;
    },
  ]);
  return withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application[0];
    app.$['android:allowBackup'] = 'true';
    app.$['android:fullBackupContent'] = '@xml/daily_spark_backup_rules';
    app.$['android:dataExtractionRules'] = '@xml/daily_spark_data_extraction_rules';
    return c;
  });
};
