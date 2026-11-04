// iOS 27 asserts at launch unless the app adopts the UIScene life cycle. Expo SDK 57 ships
// `ExpoAppSceneDelegate` for this but its prebuild template does not wire it up yet.
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const SCENE_DELEGATE_CLASS = 'EXExpoAppSceneDelegate';

const APP_DELEGATE_CLASS = 'class AppDelegate: ExpoAppDelegate {';
const PROVIDER_CLASS =
  'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {';

// The scene delegate creates the window and starts React Native from the connecting scene.
const WINDOW_STARTUP =
  /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/;

function withSceneManifest(config) {
  return withInfoPlist(config, (config) => {
    config.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: SCENE_DELEGATE_CLASS,
          },
        ],
      },
    };
    return config;
  });
}

function withFactoryProvider(config) {
  return withAppDelegate(config, (config) => {
    const { language, contents } = config.modResults;
    if (language !== 'swift') {
      throw new Error(
        'with-scene-lifecycle supports only a Swift AppDelegate.',
      );
    }
    if (contents.includes(PROVIDER_CLASS)) {
      return config;
    }
    if (
      !contents.includes(APP_DELEGATE_CLASS) ||
      !WINDOW_STARTUP.test(contents)
    ) {
      throw new Error(
        'with-scene-lifecycle could not find the expected Expo AppDelegate template; update the plugin.',
      );
    }
    config.modResults.contents = contents
      .replace(APP_DELEGATE_CLASS, PROVIDER_CLASS)
      .replace(WINDOW_STARTUP, '');
    return config;
  });
}

module.exports = function withSceneLifecycle(config) {
  return withFactoryProvider(withSceneManifest(config));
};
