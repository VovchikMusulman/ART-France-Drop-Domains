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
    // not in electron context
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

const { chromium } = require('playwright');

let abortRequested = false;
let activeBrowser = null;

const FREQUENCY_COLLAPSE = {
  yearly: '4',
  quarterly: '5',
  monthly: '6',
  all: null,
};

function normalizeTarget(raw) {
  let value = String(raw || '').trim().toLowerCase();
  if (!value) return null;

  value = value.replace(/^https?:\/\//, '').replace(/^www\./, '');
  value = value.split('#')[0].split('?')[0];

  const match = value.match(/^([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d+)?(\/.*)?$/i);
  if (!match) return null;

  const host = match[1];
  let pathname = match[2] || '/';
  pathname = pathname.replace(/\/{2,}/g, '/');
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }

  return pathname === '/' ? host : `${host}${pathname}`;
}

function normalizeDomain(raw) {
  const target = normalizeTarget(raw);
  if (!target) return '';
  return target.split('/')[0];
}

function parseTargets(text) {
  const parts = String(text || '')
    .split(/[\n\r,;]+|\s+/)
    .map((part) => normalizeTarget(part))
    .filter(Boolean);

  return [...new Set(parts)];
}

function parseDomains(text) {
  return parseTargets(text);
}

function targetFolderName(target) {
  return String(target)
    .replace(/\/+/g, '__')
    .replace(/[<>:"|?*\\]/g, '_');
}

function targetCdxUrl(target) {
  return target.includes('/') ? target : `${target}/`;
}

function formatTimestamp(ts) {
  if (!ts || ts.length < 8) return ts || 'unknown';
  return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithRetry(url, attempts = 4) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'ARTFrance-WaybackShots/1.0',
          Accept: 'application/json,text/plain,*/*',
        },
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(1200 * (i + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      lastError = error;
      await sleep(1000 * (i + 1));
    }
  }
  throw lastError || new Error('CDX request failed');
}

async function getSnapshots(target, frequency, maxSnapshots) {
  const collapse = FREQUENCY_COLLAPSE[frequency] ?? '6';
  const params = new URLSearchParams({
    url: targetCdxUrl(target),
    output: 'json',
    fl: 'timestamp,original,statuscode,mime',
    filter: 'statuscode:200',
    from: '1996',
  });

  // Exact page for paths; root host still matches homepage snapshots.
  if (target.includes('/')) {
    params.set('matchType', 'exact');
  }

  if (collapse) params.set('collapse', `timestamp:${collapse}`);
  params.set('limit', String(Math.min(Math.max(maxSnapshots * 8, 40), 400)));

  const data = await fetchJsonWithRetry(
    `https://web.archive.org/cdx/search/cdx?${params.toString()}`
  );

  if (!Array.isArray(data) || data.length <= 1) return [];

  const rows = data.slice(1);
  const htmlRows = rows.filter((row) => {
    const mime = String(row[3] || '').toLowerCase();
    return !mime || mime.includes('html') || mime.includes('text');
  });

  const unique = [];
  const seen = new Set();
  for (const row of htmlRows) {
    const timestamp = String(row[0] || '');
    if (!timestamp || seen.has(timestamp)) continue;
    seen.add(timestamp);
    unique.push({
      timestamp,
      original: cleanArchiveOriginal(String(row[1] || `https://${targetCdxUrl(target)}`)),
    });
  }

  if (unique.length > maxSnapshots) {
    const step = unique.length / maxSnapshots;
    const picked = [];
    for (let i = 0; i < maxSnapshots; i += 1) {
      picked.push(unique[Math.min(unique.length - 1, Math.floor(i * step))]);
    }
    const deduped = [];
    const seenTs = new Set();
    for (const item of picked) {
      if (seenTs.has(item.timestamp)) continue;
      seenTs.add(item.timestamp);
      deduped.push(item);
    }
    return deduped;
  }

  return unique;
}

async function setupPage(page) {
  page.setDefaultTimeout(45000);
  page.setDefaultNavigationTimeout(45000);

  await page.route('**/*', (route) => {
    const req = route.request();
    const type = req.resourceType();
    const url = req.url();

    if (type === 'media' || type === 'websocket' || type === 'eventsource') {
      route.abort();
      return;
    }

    if (
      /google-analytics|googletagmanager|doubleclick|mc\.yandex|metrika\.yandex|hotjar|clarity\.ms|facebook\.net|vk\.com\/rtrg|top-fwz1\.mail\.ru/i.test(
        url
      )
    ) {
      route.abort();
      return;
    }

    route.continue();
  });

  await page.addInitScript(() => {
    try {
      const style = document.createElement('style');
      style.textContent = `
        *, *::before, *::after {
          animation: none !important;
          transition: none !important;
          scroll-behavior: auto !important;
        }
        #wm-ipp-base, #wm-ipp, #donato, #wm-ipp-print, .wb-autocomplete-suggestions {
          display: none !important;
          height: 0 !important;
          overflow: hidden !important;
        }
        html { margin-top: 0 !important; }
      `;
      document.documentElement.appendChild(style);
    } catch {
      // ignore
    }
  });
}

async function hideWaybackChrome(page) {
  await page.evaluate(() => {
    for (const sel of ['#wm-ipp-base', '#wm-ipp', '#donato']) {
      document.querySelector(sel)?.remove();
    }
    document.querySelectorAll('.t-popup_show, .fancybox-container').forEach((el) => {
      el.style.setProperty('display', 'none', 'important');
    });
    document.body?.classList.remove('t-body_popupshowed');
    if (document.body) document.body.style.overflow = 'auto';
  }).catch(() => {});
}

function cleanArchiveOriginal(url) {
  return String(url || '')
    .replace(/^(https?:\/\/[^/:]+):80(?=\/|$)/i, '$1')
    .replace(/^(https:\/\/[^/:]+):443(?=\/|$)/i, '$1');
}

async function gotoArchive(page, archiveUrl) {
  // commit быстрее и реже зависает на тяжёлых страницах Wayback
  try {
    await page.goto(archiveUrl, {
      waitUntil: 'commit',
      timeout: 50000,
    });
    await Promise.race([
      page.waitForFunction(
        () => !!(document.body && (document.body.childElementCount > 0 || document.body.innerText.length > 10)),
        { timeout: 20000 }
      ),
      sleep(4000),
    ]);
    return 'commit';
  } catch {
    // fallback
  }

  try {
    await page.goto(archiveUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    return 'domcontentloaded';
  } catch (error) {
    const hasContent = await page
      .evaluate(() => {
        const text = document.body?.innerText || '';
        const nodes = document.body?.childElementCount || 0;
        return nodes > 0 || text.length > 30;
      })
      .catch(() => false);

    if (hasContent) return 'partial';
    throw error;
  }
}

async function preparePageForScreenshot(page) {
  await hideWaybackChrome(page);

  await page.evaluate(() => {
    document.querySelectorAll('img').forEach((img) => {
      const lazy =
        img.getAttribute('data-src') ||
        img.getAttribute('data-lazy-src') ||
        img.getAttribute('data-original') ||
        img.getAttribute('data-lazy');
      if (lazy && (!img.getAttribute('src') || img.getAttribute('src')?.startsWith('data:'))) {
        img.setAttribute('src', lazy);
      }
      img.loading = 'eager';
    });
  }).catch(() => {});

  await sleep(200);
  await hideWaybackChrome(page);
}

async function screenshotSnapshot(page, snapshot, domainDir, { overwrite = false } = {}) {
  const original = cleanArchiveOriginal(snapshot.original);
  const archiveUrl = `https://web.archive.org/web/${snapshot.timestamp}/${original}`;
  const baseName = `${formatTimestamp(snapshot.timestamp)}_${snapshot.timestamp}`;
  const filePath = path.join(domainDir, `${baseName}.jpg`);
  const legacyPng = path.join(domainDir, `${baseName}.png`);

  if (!overwrite && (fs.existsSync(filePath) || fs.existsSync(legacyPng))) {
    return { skipped: true, filePath: fs.existsSync(filePath) ? filePath : legacyPng };
  }

  await gotoArchive(page, archiveUrl);

  await Promise.race([
    page.waitForLoadState('load'),
    sleep(1500),
  ]).catch(() => {});

  await preparePageForScreenshot(page);

  await page.screenshot({
    path: filePath,
    fullPage: true,
    type: 'jpeg',
    quality: 78,
    animations: 'disabled',
  });

  return { skipped: false, filePath };
}

function abortCapture() {
  abortRequested = true;
  if (activeBrowser) {
    activeBrowser.close().catch(() => {});
    activeBrowser = null;
  }
}

async function captureWithPool(context, jobs, hooks, counters, totalShots) {
  // 3 вкладки: быстрее, чем 1, но Archive.org меньше душит, чем при 6
  const concurrency = Math.min(3, Math.max(1, jobs.length));
  let cursor = 0;

  const worker = async (page) => {
    await setupPage(page);

    while (!abortRequested) {
      const index = cursor;
      cursor += 1;
      if (index >= jobs.length) break;

      const job = jobs[index];
      const { domain, snapshot } = job;

      hooks.onProgress?.({
        phase: 'capture',
        domainIndex: job.domainIndex,
        domainTotal: job.domainTotal,
        shotIndex: counters.done + 1,
        shotTotal: totalShots,
        currentDomain: domain,
        currentDate: formatTimestamp(snapshot.timestamp),
        percent: Math.round((counters.done / totalShots) * 100),
      });

      try {
        const result = await screenshotSnapshot(page, snapshot, job.domainDir);
        if (result.skipped) {
          counters.skipped += 1;
          hooks.onLog?.({
            level: 'info',
            message: `${domain} ${formatTimestamp(snapshot.timestamp)} — уже есть`,
          });
        } else {
          counters.saved += 1;
          hooks.onLog?.({
            level: 'success',
            message: `${domain} ${formatTimestamp(snapshot.timestamp)} — сохранено`,
          });
        }
      } catch (error) {
        try {
          await sleep(1200);
          const result = await screenshotSnapshot(page, snapshot, job.domainDir);
          if (result.skipped) counters.skipped += 1;
          else counters.saved += 1;
          hooks.onLog?.({
            level: 'success',
            message: `${domain} ${formatTimestamp(snapshot.timestamp)} — сохранено (повтор)`,
          });
        } catch (retryError) {
          counters.failed += 1;
          const msg = String(retryError?.message || error.message || retryError);
          hooks.onLog?.({
            level: 'error',
            message: `${domain} ${formatTimestamp(snapshot.timestamp)} — ${msg.split('\n')[0]}`,
          });
        }
      }

      counters.done += 1;
      hooks.onProgress?.({
        phase: 'capture',
        domainIndex: job.domainIndex,
        domainTotal: job.domainTotal,
        shotIndex: counters.done,
        shotTotal: totalShots,
        currentDomain: domain,
        currentDate: formatTimestamp(snapshot.timestamp),
        percent: Math.round((counters.done / totalShots) * 100),
      });

      await sleep(250);
    }
  };

  const pages = await Promise.all(
    Array.from({ length: concurrency }, () => context.newPage())
  );

  try {
    await Promise.all(pages.map((page) => worker(page)));
  } finally {
    await Promise.all(pages.map((page) => page.close().catch(() => {})));
  }
}

async function runCapture(options, hooks) {
  abortRequested = false;
  const targets = parseTargets(options.domainsText);
  const resultsDir = options.resultsDir;
  const frequency = options.frequency || 'monthly';
  const maxSnapshots = Math.max(1, Math.min(200, Number(options.maxSnapshots) || 36));

  if (!targets.length) {
    return { ok: false, error: 'Добавьте хотя бы один корректный домен или URL' };
  }

  fs.mkdirSync(resultsDir, { recursive: true });

  const plan = [];
  hooks.onLog?.({ level: 'info', message: `URL к обработке: ${targets.length}` });

  // CDX параллельно (до 3 запросов сразу)
  const cdxConcurrency = Math.min(3, targets.length);
  let targetIndex = 0;
  const cdxWorkers = Array.from({ length: cdxConcurrency }, async () => {
    while (!abortRequested) {
      const i = targetIndex;
      targetIndex += 1;
      if (i >= targets.length) break;
      const target = targets[i];
      hooks.onLog?.({ level: 'info', message: `CDX: ищем снимки для ${target}…` });
      try {
        const snapshots = await getSnapshots(target, frequency, maxSnapshots);
        plan[i] = { target, snapshots };
        hooks.onLog?.({
          level: snapshots.length ? 'success' : 'warn',
          message: snapshots.length
            ? `${target}: найдено ${snapshots.length} снимков`
            : `${target}: снимков в архиве нет`,
        });
      } catch (error) {
        plan[i] = { target, snapshots: [], error: error.message };
        hooks.onLog?.({
          level: 'error',
          message: `${target}: ошибка CDX — ${error.message}`,
        });
      }
    }
  });
  await Promise.all(cdxWorkers);
  const orderedPlan = plan.filter(Boolean);

  const jobs = [];
  for (let di = 0; di < orderedPlan.length; di += 1) {
    const { target, snapshots } = orderedPlan[di];
    if (!snapshots.length) continue;
    const domainDir = path.join(resultsDir, targetFolderName(target));
    fs.mkdirSync(domainDir, { recursive: true });
    hooks.onLog?.({ level: 'info', message: `Скриншоты: ${target}` });

    for (const snapshot of snapshots) {
      jobs.push({
        domain: target,
        snapshot,
        domainDir,
        domainIndex: di + 1,
        domainTotal: orderedPlan.length,
      });
    }
  }

  const totalShots = jobs.length;
  const counters = { done: 0, saved: 0, skipped: 0, failed: 0 };

  hooks.onProgress?.({
    phase: 'capture',
    domainIndex: 0,
    domainTotal: orderedPlan.length,
    shotIndex: 0,
    shotTotal: totalShots,
    currentDomain: '',
    percent: 0,
  });

  if (!totalShots) {
    hooks.onLog?.({ level: 'warn', message: 'Нет снимков для скриншотов' });
    return {
      ok: true,
      aborted: abortRequested,
      resultsDir,
      saved: 0,
      skipped: 0,
      failed: 0,
      domains: targets.length,
    };
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: bundled?.executablePath || undefined,
      args: [
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-sync',
        '--no-first-run',
      ],
    });
  } catch (error) {
    const msg = String(error?.message || error);
    if (msg.includes("Executable doesn't exist") || msg.includes('playwright install')) {
      const hint =
        'Не найден браузер Playwright. Закройте программу и выполните: npx playwright install chromium';
      hooks.onLog?.({ level: 'error', message: hint });
      return { ok: false, error: hint };
    }
    throw error;
  }

  activeBrowser = browser;

  const context = await browser.newContext({
    viewport: { width: 1360, height: 800 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    ignoreHTTPSErrors: true,
    javaScriptEnabled: true,
    serviceWorkers: 'block',
  });

  try {
    await captureWithPool(context, jobs, hooks, counters, totalShots);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    activeBrowser = null;
  }

  const summary = abortRequested
    ? 'Остановлено пользователем'
    : `Готово: сохранено ${counters.saved}, пропущено ${counters.skipped}, ошибок ${counters.failed}`;

  hooks.onLog?.({ level: abortRequested ? 'warn' : 'success', message: summary });
  hooks.onProgress?.({
    phase: 'done',
    domainIndex: orderedPlan.length,
    domainTotal: orderedPlan.length,
    shotIndex: counters.done,
    shotTotal: totalShots,
    currentDomain: '',
    percent: 100,
  });

  return {
    ok: true,
    aborted: abortRequested,
    resultsDir,
    saved: counters.saved,
    skipped: counters.skipped,
    failed: counters.failed,
    domains: targets.length,
  };
}

module.exports = {
  runCapture,
  abortCapture,
  parseDomains,
  parseTargets,
  normalizeDomain,
  normalizeTarget,
  targetFolderName,
};
