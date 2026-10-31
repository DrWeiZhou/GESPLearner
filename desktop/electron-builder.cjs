/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS config loaded by electron-builder */
/**
 * electron-builder configuration for the desktop app. Driven by
 * scripts/desktop/build.ts, which first assembles:
 *   dist-desktop/app/             main.cjs + a dependency-free package.json (the asar)
 *   dist-desktop/server/          the Next.js standalone server, platform-neutral
 *   dist-desktop/native/<p>-<a>/  the platform's @napi-rs/canvas binary
 *   build-desktop/toolchain/      Windows: pruned w64devkit (GCC)
 *
 * @type {import("electron-builder").Configuration}
 */
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const pkg = require("../package.json");

// electron-builder runs with --projectDir dist-desktop/app, so that it never goes
// looking through the repository's node_modules for "dependencies" to pack: the
// app has none — the server carries its own. Hence every path here is absolute.
const ROOT = path.resolve(__dirname, "..");
const at = (rel) => path.join(ROOT, rel);

module.exports = {
  appId: "io.github.drweizhou.gesplearner",
  productName: "GESPLearner",
  copyright: "真题版权归 CCF GESP 所有 · 本程序仅供学习交流",
  electronVersion: pkg.devDependencies.electron.replace(/^[^\d]*/, ""),
  directories: {
    app: at("dist-desktop/app"),
    output: at("dist-desktop/release"),
    buildResources: at("desktop/resources"),
  },
  files: ["**/*"],
  asar: true,
  npmRebuild: false,
  nodeGypRebuild: false,
  // The server is ordinary files next to the asar: Next.js resolves modules and
  // reads its manifests with plain fs, and utilityProcess runs server.js directly.
  // electron-builder always skips a top-level node_modules in a copied folder, so
  // the server's own node_modules goes in as a second entry.
  extraResources: [
    { from: at("dist-desktop/server"), to: "server", filter: ["**/*"] },
    { from: at("dist-desktop/server/node_modules"), to: "server/node_modules", filter: ["**/*"] },
  ],

  mac: {
    target: [{ target: "dmg", arch: ["arm64", "x64"] }],
    category: "public.app-category.education",
    icon: at("desktop/resources/icon.png"),
    // No Apple Developer ID: the bundle is ad-hoc signed in afterPack instead, which
    // Apple silicon requires for the modified Electron binary to launch at all.
    identity: null,
    hardenedRuntime: false,
    extendInfo: {
      CFBundleDisplayName: "GESP 备考助手",
      LSApplicationCategoryType: "public.app-category.education",
    },
    extraResources: [{ from: at("dist-desktop/native/darwin-${arch}"), to: "server/node_modules", filter: ["**/*"] }],
    artifactName: "GESPLearner-${version}-mac-${arch}.${ext}",
  },
  dmg: {
    title: "GESP 备考助手 ${version}",
    artifactName: "GESPLearner-${version}-mac-${arch}.${ext}",
  },

  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    icon: at("desktop/resources/icon-win.png"),
    extraResources: [
      { from: at("dist-desktop/native/win32-${arch}"), to: "server/node_modules", filter: ["**/*"] },
      { from: at("build-desktop/toolchain/w64devkit"), to: "toolchain/w64devkit", filter: ["**/*"] },
    ],
    artifactName: "GESPLearner-${version}-win-${arch}-setup.${ext}",
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "GESP 备考助手",
    uninstallDisplayName: "GESP 备考助手",
    installerLanguages: ["zh_CN"],
    language: "2052",
    // Students' records live in %APPDATA%\GESPLearner; uninstalling keeps them.
    deleteAppDataOnUninstall: false,
  },

  async afterPack(context) {
    if (context.electronPlatformName !== "darwin") return;
    const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  },
};
