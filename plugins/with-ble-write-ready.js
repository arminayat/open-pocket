const { withPodfile } = require('expo/config-plugins');

const HOOK = "    require_relative '../plugins/patch-ble-write-ready'\n    OpenPocket.patch_ble_write_ready(installer)\n";

/** Runs plugins/patch-ble-write-ready.rb from the generated Podfile's post_install hook. */
module.exports = function withBleWriteReady(config) {
  return withPodfile(config, (mod) => {
    const podfile = mod.modResults.contents;
    if (podfile.includes('patch_ble_write_ready')) return mod;
    if (!podfile.includes('post_install do |installer|\n')) {
      throw new Error('OpenPocket: Podfile post_install hook not found for the BLE write patch.');
    }
    mod.modResults.contents = podfile.replace('post_install do |installer|\n', `post_install do |installer|\n${HOOK}`);
    return mod;
  });
};
