const { withAndroidManifest } = require("expo/config-plugins");

module.exports = ({ config }) => {
  const clientId = process.env.EXPO_PUBLIC_VK_CLIENT_ID || "";
  const vkScheme = clientId ? `vk${clientId}` : null;
  const existingFilters = config.android?.intentFilters || [];
  const vkFilter = vkScheme
    ? [{
        action: "VIEW",
        autoVerify: false,
        data: [{ scheme: vkScheme, host: "vk.ru", pathPrefix: "/blank.html" }],
        category: ["BROWSABLE", "DEFAULT"],
      }]
    : [];

  const nextConfig = {
    ...config,
    scheme: vkScheme ? ["neuroscene", vkScheme] : "neuroscene",
    android: {
      ...(config.android || {}),
      intentFilters: [...existingFilters, ...vkFilter],
    },
  };

  // Expo's config-level usesCleartextTraffic option did not make it into the
  // generated release APK. Set the Android manifest attribute explicitly so
  // the app can reach the user's private-LAN HTTP backend during local tests.
  return withAndroidManifest(nextConfig, (modConfig) => {
    const application = modConfig.modResults.manifest.application?.[0];
    if (application) {
      application.$ = application.$ || {};
      application.$["android:usesCleartextTraffic"] = "true";
    }
    return modConfig;
  });
};
