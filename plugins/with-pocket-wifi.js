const { withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins');

module.exports = function withPocketWifi(config) {
  config = withEntitlementsPlist(config, (mod) => {
    mod.modResults['com.apple.developer.networking.HotspotConfiguration'] = true;
    return mod;
  });
  return withInfoPlist(config, (mod) => {
    mod.modResults.NSLocalNetworkUsageDescription =
      'Open Pocket connects directly to your Pocket recorder to download recordings over Wi-Fi.';
    return mod;
  });
};
