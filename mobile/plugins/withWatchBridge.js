// Re-registers ios/ExLibris/WatchBridge.swift with the Xcode project after
// `expo prebuild` regenerates project.pbxproj. The file itself is committed
// to the repo at ios/ExLibris/WatchBridge.swift; this plugin only edits the
// project file to add it back to the main app target's compile sources.

const { withXcodeProject } = require('@expo/config-plugins');
const { addBuildSourceFileToGroup } = require('@expo/config-plugins/build/ios/utils/Xcodeproj');

const SWIFT_FILEPATH = 'ExLibris/WatchBridge.swift';

function withWatchBridge(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    try {
      addBuildSourceFileToGroup({
        filepath: SWIFT_FILEPATH,
        groupName: 'ExLibris',
        project,
      });
    } catch (e) {
      // Already in project — fine.
      if (!String(e).includes('already exists')) {
        console.warn('[withWatchBridge] could not add Swift file:', e.message);
      }
    }
    return cfg;
  });
}

module.exports = withWatchBridge;
