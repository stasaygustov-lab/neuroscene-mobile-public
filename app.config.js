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

  let nextConfig = {
    ...config,
    scheme: vkScheme ? ["neuroscene", vkScheme] : "neuroscene",
    android: {
      ...(config.android || {}),
      // Allow the local HTTP API during LAN testing; use HTTPS for public deployments.
      // Local-PC preview backend uses HTTP on the private LAN.
      usesCleartextTraffic: true,
      intentFilters: [...existingFilters, ...vkFilter],
    },
  };

  return nextConfig;
};
