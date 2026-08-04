const fs = require('node:fs');
const path = require('node:path');

function resolveBundledChromium() {
  const roots = [];

  try {
    const electron = require('electron');
    const app = electron.app || electron?.remote?.app;
    if (app?.isPackaged) {
      roots.push(path.join(process.resourcesPath, 'ms-playwright'));
    }
  } catch {
    // not in electron
  }

  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    roots.push(process.env.PLAYWRIGHT_BROWSERS_PATH);
  }

  roots.push(path.join(__dirname, '..', 'vendor', 'ms-playwright'));

  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    const chromiumDir = entries.find((name) => /^chromium-\d+$/.test(name));
    if (!chromiumDir) continue;
    const executablePath = path.join(root, chromiumDir, 'chrome-win64', 'chrome.exe');
    if (fs.existsSync(executablePath)) {
      return { browsersPath: root, executablePath };
    }
  }

  return null;
}

const bundled = resolveBundledChromium();
if (bundled?.browsersPath) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = bundled.browsersPath;
}

function getLaunchOptions(extra = {}) {
  const opts = {
    headless: true,
    ...extra,
  };
  if (bundled?.executablePath) {
    opts.executablePath = bundled.executablePath;
  }
  return opts;
}

module.exports = {
  resolveBundledChromium,
  getLaunchOptions,
  bundled,
};
