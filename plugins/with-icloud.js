const { withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins');

module.exports = function withICloud(config) {
  const container = `iCloud.${config.ios.bundleIdentifier}`;
  config = withEntitlementsPlist(config, mod => {
    mod.modResults['com.apple.developer.icloud-container-identifiers'] = [container];
    mod.modResults['com.apple.developer.ubiquity-container-identifiers'] = [container];
    mod.modResults['com.apple.developer.icloud-services'] = ['CloudDocuments'];
    return mod;
  });
  return withInfoPlist(config, mod => {
    mod.modResults.OpenPocketICloudContainerIdentifier = container;
    mod.modResults.NSUbiquitousContainers = {
      [container]: {
        NSUbiquitousContainerIsDocumentScopePublic: true,
        NSUbiquitousContainerName: 'OpenPocket',
        NSUbiquitousContainerSupportedFolderLevels: 'Any',
      },
    };
    return mod;
  });
};
