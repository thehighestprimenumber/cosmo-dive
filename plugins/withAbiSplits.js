// One APK per CPU type instead of one with both: the phone APK (arm64) is about
// half the size. CI also builds x86_64, only to run the emulator smoke test.
const { withAppBuildGradle } = require('expo/config-plugins');

const SPLITS = `
    // Added by plugins/withAbiSplits.js
    splits {
        abi {
            enable true
            reset()
            include "arm64-v8a", "x86_64"
            universalApk false
        }
    }
`;

module.exports = function withAbiSplits(config) {
  return withAppBuildGradle(config, (c) => {
    const src = c.modResults.contents;
    if (!src.includes('withAbiSplits')) {
      c.modResults.contents = src.replace(/\nandroid\s*\{\n/, (m) => `${m}${SPLITS}`);
    }
    return c;
  });
};
