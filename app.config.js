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
      intentFilters: [...existingFilters, ...vkFilter],
    },
  };

  return nextConfig;
};
