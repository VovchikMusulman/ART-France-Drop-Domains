const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const sourceRoot = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright');
const targetRoot = path.join(__dirname, '..', 'vendor', 'ms-playwright');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function main() {
  if (!fs.existsSync(sourceRoot)) {
    console.error('Playwright browsers not found at', sourceRoot);
    console.error('Run: npx playwright install chromium');
    process.exit(1);
  }

  const chromiumName = fs
    .readdirSync(sourceRoot)
    .find((name) => /^chromium-\d+$/.test(name));

  if (!chromiumName) {
    console.error('chromium-* folder not found. Run: npx playwright install chromium');
    process.exit(1);
  }

  const source = path.join(sourceRoot, chromiumName);
  const target = path.join(targetRoot, chromiumName);
  const chromeExe = path.join(source, 'chrome-win64', 'chrome.exe');

  if (!fs.existsSync(chromeExe)) {
    console.error('chrome.exe missing in', chromeExe);
    process.exit(1);
  }

  fs.rmSync(targetRoot, { recursive: true, force: true });
  console.log('Copying', chromiumName, '-> vendor/ms-playwright ...');
  copyDir(source, target);

  const destExe = path.join(target, 'chrome-win64', 'chrome.exe');
  console.log('Ready:', destExe, `(${Math.round(fs.statSync(destExe).size / 1024 / 1024)} MB)`);
}

main();
