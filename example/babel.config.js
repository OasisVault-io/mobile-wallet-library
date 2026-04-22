const path = require("path");
const { getConfig } = require("react-native-builder-bob/babel-config");
const pkg = require("../package.json");

const root = path.resolve(__dirname, "..");
const bob = pkg["react-native-builder-bob"];

module.exports = function (api) {
  api.cache(true);

  return getConfig(
    {
      presets: ["babel-preset-expo"],
    },
    { root, pkg: { ...pkg, source: bob.source } },
  );
};
