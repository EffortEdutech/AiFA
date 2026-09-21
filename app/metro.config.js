const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// watchFolders above makes Metro crawl the whole monorepo root (needed to
// reach packages/core/src), but that also picks up unrelated top-level
// folders it has no reason to watch -- including _to_delete/, which
// contains a broken/leftover file Windows can't even lstat. Exclude only
// those exact TOP-LEVEL siblings of app/ -- anchored to workspaceRoot, not
// a loose "any folder named X anywhere" match. A loose /[\\/]web[\\/].*/
// (first version of this file) wrongly also matched legitimate paths deep
// inside node_modules that happen to contain a "web" segment, e.g.
// node_modules/expo-modules-core/build/web/index.js, breaking the build.
function blockTopLevelDir(name) {
  const escaped = path
    .resolve(workspaceRoot, name)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}[\\\\/].*`);
}

config.resolver.blockList = [
  blockTopLevelDir("_to_delete"),
  blockTopLevelDir("web"),
  blockTopLevelDir("supabase"),
  blockTopLevelDir("docs"),
  blockTopLevelDir("graphify-out"),
];

module.exports = config;
