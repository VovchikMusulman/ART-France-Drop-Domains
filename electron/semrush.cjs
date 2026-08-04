const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { getLaunchOptions } = require('./chromium.cjs');
const { extractDomainFromUrl, isNoiseDomain, sleep } = require('./utils.cjs');

let metaCache = {
  email: '',
  updatedAt: 0,
};

function getStatePath(userDataPath) {
  return path.join(userDataPath, 'semrush-state.json');
}

function getStorageStatePath(userDataPath) {
  return path.join(userDataPath, 'semrush-storage.json');
}

function loadPersisted(userDataPath) {
  try {
    const raw = fs.readFileSync(getStatePath(userDataPath), 'utf8');
    const data = JSON.parse(raw);
    const storageStatePath = getStorageStatePath(userDataPath);
    if (fs.existsSync(storageStatePath)) {
      metaCache = {
        email: data.email || '',
        updatedAt: data.updatedAt || Date.now(),
      };
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

function persistMeta(userDataPath, email) {
  fs.mkdirSync(userDataPath, { recursive: true });
  metaCache = { email, updatedAt: Date.now() };
  fs.writeFileSync(
    getStatePath(userDataPath),
    JSON.stringify({ email, updatedAt: metaCache.updatedAt }, null, 2),
    'utf8'
  );
}

function clearSession(userDataPath) {
  metaCache = { email: '', updatedAt: 0 };
  for (const file of [getStatePath(userDataPath), getStorageStatePath(userDataPath)]) {
    try {
      fs.unlinkSync(file);
    } catch {
      // ignore
    }
  }
}

async function dismissOverlays(page) {
  const candidates = [
    'button:has-text("Accept all")',
    'button:has-text("Accept All")',
    'button:has-text("I agree")',
    'button:has-text("Agree")',
    'button:has-text("Принять")',
    'button:has-text("Принять все")',
    '#onetrust-accept-btn-handler',
  ];
  for (const sel of candidates) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 800 })) {
        await btn.click({ timeout: 2000 }).catch(() => null);
      }
    } catch {
      // ignore
    }
  }
}

/**
 * Multi-login warning + free-limit paywall.
 * Returns a blocking reason string if we cannot continue.
 */
async function handleSemrushGates(page, onLog) {
  await dismissOverlays(page);
  await page.waitForTimeout(600);

  // "You have too many active sessions" → click Continue once
  const multiLogin = page.getByText(/too many active sessions|Multi-login activity/i).first();
  if (await multiLogin.isVisible({ timeout: 1500 }).catch(() => false)) {
    onLog?.({
      level: 'warn',
      message: 'Semrush: слишком много активных сессий — нажимаю Continue',
    });
    const cont = page.getByRole('button', { name: /^Continue$/i }).first();
    if (await cont.isVisible({ timeout: 2000 }).catch(() => false)) {
      await cont.click({ timeout: 5000 }).catch(() => null);
      await page.waitForTimeout(1500);
    }
  }

  const body = (await page.locator('body').innerText().catch(() => '')) || '';

  if (
    /access no longer available/i.test(body) ||
    /international sanctions/i.test(body) ||
    /no longer accessible to businesses registered or based in russia/i.test(body)
  ) {
    return 'SEMRUSH_SANCTIONS';
  }

  if (/You’ve used \d+ free requests|You've used \d+ free requests|used \d+ free requests/i.test(body)) {
    return 'SEMRUSH_FREE_LIMIT';
  }
  if (/Get free trial|Upgrade to Starter|7 days free, then/i.test(body) && /free requests/i.test(body)) {
    return 'SEMRUSH_FREE_LIMIT';
  }
  if (/temporary account block|account (has been )?blocked/i.test(body)) {
    return 'SEMRUSH_ACCOUNT_BLOCK';
  }

  return null;
}

function gateErrorMessage(code) {
  if (code === 'SEMRUSH_SANCTIONS') {
    return 'Semrush недоступен из‑за санкций (Access no longer available для РФ / санкционных территорий). Включите TUN в VPN для получения Outbound Domains';
  }
  if (code === 'SEMRUSH_FREE_LIMIT') {
    return 'Лимит Semrush Free исчерпан (10 free requests). Нужен платный план или подождать сброса лимита. Outbound Domains сейчас недоступен.';
  }
  if (code === 'SEMRUSH_ACCOUNT_BLOCK') {
    return 'Semrush временно заблокировал аккаунт из‑за multi-login. Подождите и зайдите один раз вручную в браузере.';
  }
  return code;
}

async function waitForLoginFields(page) {
  const emailCandidates = ['#email', 'input[name="email"]', 'input[type="email"]'];
  const passCandidates = ['#password', 'input[name="password"]', 'input[type="password"]'];
  const deadline = Date.now() + 45000;

  while (Date.now() < deadline) {
    await dismissOverlays(page);
    let emailInput = null;
    let passInput = null;
    for (const sel of emailCandidates) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 200 }).catch(() => false)) {
        emailInput = el;
        break;
      }
    }
    for (const sel of passCandidates) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 200 }).catch(() => false)) {
        passInput = el;
        break;
      }
    }
    if (emailInput && passInput) return { emailInput, passInput };
    await page.waitForTimeout(400);
  }
  throw new Error(`Не найдено поле email/пароля. URL: ${page.url()}`);
}

async function fillLogin(page, email, password) {
  await dismissOverlays(page);
  const { emailInput, passInput } = await waitForLoginFields(page);
  await emailInput.fill(email);
  await passInput.fill(password);

  const submit = page
    .locator('button[type="submit"], button:has-text("Log in"), button:has-text("Войти")')
    .first();
  if (await submit.count()) await submit.click({ timeout: 10000 });
  else await passInput.press('Enter');

  try {
    await page.waitForURL((url) => !/\/login\/?$/i.test(url.pathname), { timeout: 60000 });
  } catch {
    // fallthrough
  }
  await page.waitForTimeout(1200);

  if (/\/login/i.test(page.url())) {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    if (/captcha|recaptcha|2fa|two-factor|verification/i.test(bodyText)) {
      throw new Error('Semrush требует капчу или 2FA.');
    }
    if (/incorrect|invalid|wrong password|неверн/i.test(bodyText)) {
      throw new Error('Неверный email или пароль Semrush.');
    }
    throw new Error('Не удалось войти в Semrush.');
  }
}

function extractRows(data) {
  if (!data || typeof data !== 'object') {
    return { rows: [], total: 0, meta: { keys: [], status: null, error: null, is_limited: null } };
  }

  const candidates = [
    data.data,
    data.outgoing_domains?.data,
    data.outbound_domains?.data,
    data.result?.data,
    data.report?.data,
    data.rows,
    data.items,
    Array.isArray(data) ? data : null,
  ];

  let rows = [];
  for (const c of candidates) {
    if (Array.isArray(c)) {
      rows = c;
      break;
    }
  }

  // Sometimes: { data: { data: [...], total } }
  if (!rows.length && data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
    if (Array.isArray(data.data.data)) rows = data.data.data;
    else if (Array.isArray(data.data.rows)) rows = data.data.rows;
  }

  const total = Number(
    data.total ??
      data.outgoing_domains?.total ??
      data.outbound_domains?.total ??
      data.result?.total ??
      data.data?.total ??
      rows.length ??
      0
  );

  return {
    rows,
    total: total || rows.length,
    meta: {
      keys: Object.keys(data),
      status: data.status ?? data.data?.status ?? null,
      error: data.error || data.message || data.data?.error || null,
      is_limited: data.is_limited ?? data.data?.is_limited ?? null,
    },
  };
}

function mapRows(rows) {
  return rows.map((row) => ({
    domain: extractDomainFromUrl(
      row.domain || row.root_domain || row.target || row.url || row.host || ''
    ),
    linksNum: Number(row.links_num || row.linksNum || 0),
    domainAscore: Number(row.domain_ascore || row.ascore || 0),
    firstSeen: row.first_seen || null,
    lastSeen: row.last_seen || null,
    category: row.category || '',
  }));
}

function isOutgoingApiUrl(url) {
  const u = String(url || '').toLowerCase();
  if (!u.includes('semrush.com')) return false;
  // Classic UI webapi2
  if (
    u.includes('/analytics/backlinks/webapi2/') &&
    (u.includes('backlinks_outgoing_domains') ||
      u.includes('type=backlinks_outgoing') ||
      u.includes('outgoing_domains') ||
      u.includes('outbound'))
  ) {
    return true;
  }
  // Newer REST-ish endpoints used by the same UI
  if (
    (u.includes('/backlinks/') || u.includes('/analytics/ba/')) &&
    (u.includes('outgoing') || u.includes('outbound'))
  ) {
    return true;
  }
  return false;
}

async function detectEmptyOutboundReason(page) {
  const body = ((await page.locator('body').innerText().catch(() => '')) || '').slice(0, 8000);
  if (/you.?ve used \d+ free requests|used \d+ free requests|upgrade to (starter|pro|guru)/i.test(body)) {
    return {
      code: 'SEMRUSH_LIMIT',
      note: 'Semrush ограничил отчёт (лимит Free / нужна подписка)',
    };
  }
  if (/no data|nothing found|нет данных|0 outbound|no outbound domains/i.test(body)) {
    return { code: 'EMPTY', note: 'Semrush показал пустой отчёт Outbound Domains' };
  }
  if (/get full access|unlock|subscribe|trial ended|подписк/i.test(body) && /outbound|backlink/i.test(body)) {
    return {
      code: 'SEMRUSH_LIMIT',
      note: 'Отчёт Outbound Domains недоступен на текущем тарифе Semrush',
    };
  }
  return null;
}

/** Fallback: scrape domains from the rendered table if API JSON was missed */
async function scrapeOutboundTable(page) {
  return page
    .evaluate(() => {
      const out = [];
      const links = Array.from(
        document.querySelectorAll(
          'a[href*="outbound"], a[data-test*="domain"], table a[href*="/analytics/"], [data-ui-name="Table"] a'
        )
      );
      for (const a of links) {
        const text = (a.textContent || '').trim().toLowerCase();
        if (!text || text.includes(' ') || text.length < 3) continue;
        if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(text)) continue;
        out.push(text);
      }
      // Also plain cells that look like domains
      const cells = Array.from(document.querySelectorAll('td, [role="cell"]'));
      for (const cell of cells) {
        const text = (cell.textContent || '').trim().toLowerCase();
        if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(text)) out.push(text);
      }
      return [...new Set(out)];
    })
    .catch(() => []);
}

async function createBrowserContext(storageStatePath) {
  const browser = await chromium.launch(
    getLaunchOptions({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled'],
    })
  );

  const options = {
    viewport: { width: 1440, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    locale: 'en-US',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  };
  if (storageStatePath && fs.existsSync(storageStatePath)) {
    options.storageState = storageStatePath;
  }

  const context = await browser.newContext(options);
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  return { browser, context, page };
}

async function probeAuthenticated(page, onLog) {
  await page.goto(
    'https://www.semrush.com/analytics/backlinks/outbound-domains/?q=example.com&searchType=domain',
    { waitUntil: 'domcontentloaded', timeout: 90000 }
  );
  await page.waitForTimeout(1500);
  const gate = await handleSemrushGates(page, onLog);
  if (gate) throw new Error(gateErrorMessage(gate));
  return !/\/login/i.test(page.url());
}

/**
 * Reuse saved cookies when possible. Password login only if session is dead or forceLogin=true.
 */
async function ensureLoggedIn(page, { email, password, onLog, forceLogin = false, hasStorage = false }) {
  if (!forceLogin && hasStorage) {
    onLog?.({ level: 'info', message: 'Проверяю сохранённую сессию Semrush…' });
    const ok = await probeAuthenticated(page, onLog);
    if (ok) {
      onLog?.({ level: 'success', message: 'Сессия Semrush рабочая — повторный вход не нужен' });
      return { reused: true };
    }
    onLog?.({ level: 'warn', message: 'Сохранённая сессия недействительна — нужен вход' });
  }

  if (!email || !password) {
    throw new Error('Нет рабочей сессии Semrush. Откройте Настройки и нажмите «Подключить Semrush».');
  }

  await page.goto('https://www.semrush.com/login/', {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
  await page.waitForTimeout(1200);

  if (!forceLogin && !/\/login/i.test(page.url())) {
    onLog?.({ level: 'info', message: 'Semrush: уже авторизованы' });
    return { reused: true };
  }

  if (/\/login/i.test(page.url())) {
    await page.waitForSelector('#email, input[name="email"], input[type="email"]', {
      state: 'visible',
      timeout: 45000,
    });
    onLog?.({ level: 'info', message: 'Вход в Semrush…' });
    await fillLogin(page, email, password);
  }

  const gate = await handleSemrushGates(page, onLog);
  if (gate) throw new Error(gateErrorMessage(gate));
  onLog?.({ level: 'success', message: 'Вход в Semrush выполнен' });
  return { reused: false };
}

/**
 * Live browser session: open once, fetch outlinks via UI network calls.
 */
async function openLiveSession({ email, password, userDataPath, onLog, forceLogin = false }) {
  const user = String(email || '').trim();
  const pass = String(password || '');
  const storageStatePath = getStorageStatePath(userDataPath);
  const hasStorage = fs.existsSync(storageStatePath);

  if (!hasStorage && (!user || !pass)) {
    throw new Error('Укажите email/пароль Semrush в Настройках и подключите сессию');
  }

  const { browser, context, page } = await createBrowserContext(hasStorage ? storageStatePath : '');

  try {
    await ensureLoggedIn(page, {
      email: user,
      password: pass,
      onLog,
      forceLogin,
      hasStorage,
    });
    await context.storageState({ path: storageStatePath });
    persistMeta(userDataPath, user || metaCache.email || '');

    // Warm-up only if we didn't just land on outbound via probe
    if (!page.url().includes('/outbound-domains/')) {
      onLog?.({ level: 'info', message: 'Прогрев Outbound Domains…' });
      await page.goto(
        'https://www.semrush.com/analytics/backlinks/outbound-domains/?q=example.com&searchType=domain',
        { waitUntil: 'domcontentloaded', timeout: 90000 }
      );
      await page.waitForTimeout(1500);
      const warmGate = await handleSemrushGates(page, onLog);
      if (warmGate) throw new Error(gateErrorMessage(warmGate));
    }

    if (/\/login/i.test(page.url())) {
      throw new Error('После входа Semrush вернул на login — сессия не принята');
    }

    const getOutgoingDomains = async (targetRaw) => {
      const target = extractDomainFromUrl(targetRaw);
      if (!target) throw new Error('Пустой target');

      let apiPayload = null;
      let apiStatus = 0;
      let apiUrlHit = '';

      const onResponse = async (res) => {
        try {
          if (!isOutgoingApiUrl(res.url())) return;
          apiStatus = res.status();
          apiUrlHit = res.url();
          const text = await res.text();
          if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
            apiPayload = JSON.parse(text);
          }
        } catch {
          // ignore parse errors
        }
      };

      page.on('response', onResponse);
      try {
        const reportUrl = `https://www.semrush.com/analytics/backlinks/outbound-domains/?q=${encodeURIComponent(target)}&searchType=domain`;
        await page.goto(reportUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
        const gate = await handleSemrushGates(page, onLog);
        if (gate) {
          const err = new Error(gateErrorMessage(gate));
          err.code = gate;
          throw err;
        }

        // Wait for API response up to ~35s
        for (let i = 0; i < 70 && !apiPayload; i += 1) {
          if (/\/login/i.test(page.url())) {
            throw new Error('SEMRUSH_LOGIN_REQUIRED');
          }
          await page.waitForTimeout(500);
        }

        // One soft reload if UI fired nothing (SPA race)
        if (!apiPayload) {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => null);
          await handleSemrushGates(page, onLog);
          for (let i = 0; i < 40 && !apiPayload; i += 1) {
            await page.waitForTimeout(500);
          }
        }
      } finally {
        page.off('response', onResponse);
      }

      if (!apiPayload) {
        const pageReason = await detectEmptyOutboundReason(page);
        if (pageReason?.code === 'SEMRUSH_LIMIT') {
          const err = new Error(pageReason.note);
          err.code = 'SEMRUSH_FREE_LIMIT';
          throw err;
        }

        const scraped = await scrapeOutboundTable(page);
        const filteredScraped = scraped.filter((d) => d && !isNoiseDomain(d, target));
        if (filteredScraped.length) {
          const entries = filteredScraped.map((domain) => ({ domain, as: null, dr: null }));
          return {
            target,
            total: filteredScraped.length,
            domains: filteredScraped,
            entries,
            rawCount: filteredScraped.length,
            httpStatus: apiStatus || 0,
            note: 'данные из таблицы UI (JSON API не поймали)',
            source: 'dom',
          };
        }

        return {
          target,
          total: 0,
          domains: [],
          entries: [],
          rawCount: 0,
          httpStatus: apiStatus || 0,
          note:
            pageReason?.note ||
            'не получен ответ Outbound API (лимит Free / подписка / блок отчёта / смена API)',
          source: 'none',
          apiUrlHit: apiUrlHit || null,
        };
      }

      const parsed = extractRows(apiPayload);
      if (
        apiStatus === 403 ||
        String(parsed.meta.status || '').toLowerCase() === 'forbidden' ||
        parsed.meta.is_limited === true
      ) {
        const gate = await handleSemrushGates(page, onLog);
        if (gate) {
          const err = new Error(gateErrorMessage(gate));
          err.code = gate;
          throw err;
        }
        const err = new Error(
          'Semrush ограничил Outbound Domains (Forbidden / is_limited). Проверьте подписку и лимит запросов.'
        );
        err.code = 'SEMRUSH_FORBIDDEN';
        throw err;
      }

      const mapped = mapRows(parsed.rows).filter((r) => r.domain && !isNoiseDomain(r.domain, target));
      const byDomain = new Map();
      for (const row of mapped) {
        const prev = byDomain.get(row.domain);
        if (!prev || (row.domainAscore || 0) > (prev.as || 0)) {
          byDomain.set(row.domain, {
            domain: row.domain,
            as: Number.isFinite(row.domainAscore) ? row.domainAscore : null,
            dr: null,
          });
        }
      }
      const entries = [...byDomain.values()];
      const filtered = entries.map((e) => e.domain);

      if (!filtered.length) {
        const scraped = await scrapeOutboundTable(page);
        const filteredScraped = scraped.filter((d) => d && !isNoiseDomain(d, target));
        if (filteredScraped.length) {
          const scrapedEntries = filteredScraped.map((domain) => ({ domain, as: null, dr: null }));
          return {
            target,
            total: filteredScraped.length,
            domains: filteredScraped,
            entries: scrapedEntries,
            rawCount: filteredScraped.length,
            httpStatus: apiStatus,
            note: 'JSON пустой, домены взяты из таблицы UI',
            source: 'dom',
            meta: parsed.meta,
          };
        }
      }

      return {
        target,
        total: parsed.total,
        domains: filtered,
        entries,
        rawCount: mapped.length,
        httpStatus: apiStatus,
        meta: parsed.meta,
        source: 'api',
        note: filtered.length ? null : 'API ответил, но список доменов пуст',
      };
    };

    return {
      getOutgoingDomains,
      async close() {
        try {
          await context.storageState({ path: storageStatePath });
        } catch {
          // ignore
        }
        await browser.close().catch(() => null);
      },
    };
  } catch (err) {
    await browser.close().catch(() => null);
    throw err;
  }
}

/**
 * Manual login button: force password login and refresh saved session.
 */
async function loginAndCaptureSession({ email, password, userDataPath, onLog }) {
  clearSession(userDataPath);
  const session = await openLiveSession({
    email,
    password,
    userDataPath,
    onLog,
    forceLogin: true,
  });
  try {
    const probe = await session.getOutgoingDomains('netology.ru');
    onLog?.({
      level: probe.rawCount ? 'success' : 'warn',
      message: `Пробный Outbound: HTTP ${probe.httpStatus || '—'}, total=${probe.total}, rows=${probe.rawCount}${
        probe.meta?.status != null ? `, status=${JSON.stringify(probe.meta.status)}` : ''
      }${probe.meta?.is_limited != null ? `, is_limited=${probe.meta.is_limited}` : ''}${
        probe.note ? ` — ${probe.note}` : ''
      }`,
    });
    if (probe.meta?.error) {
      onLog?.({
        level: 'warn',
        message: `Semrush error: ${typeof probe.meta.error === 'string' ? probe.meta.error : JSON.stringify(probe.meta.error)}`,
      });
    }
    onLog?.({ level: 'success', message: 'Semrush готов к запросам' });
    return { ok: true, email: String(email || '').trim(), reused: false };
  } finally {
    await session.close();
  }
}

async function getOutgoingDomainsFiltered(targetRaw, options = {}) {
  // Backward-compatible wrapper for one-off calls
  const { onLog, email, password, userDataPath } = options;
  const session = options.session || (await openLiveSession({ email, password, userDataPath, onLog }));
  const ownsSession = !options.session;

  try {
    const report = await session.getOutgoingDomains(targetRaw);
    if (!report.rawCount) {
      onLog?.({
        level: 'warn',
        message: `${report.target}: outlinks пусто (HTTP ${report.httpStatus || '—'}, total=${report.total}${
          report.meta?.is_limited != null ? `, is_limited=${report.meta.is_limited}` : ''
        }${report.meta?.status != null ? `, status=${JSON.stringify(report.meta.status)}` : ''})`,
      });
    }
    return report;
  } finally {
    if (ownsSession) await session.close();
  }
}

module.exports = {
  loginAndCaptureSession,
  openLiveSession,
  clearSession,
  getOutgoingDomainsFiltered,
  loadPersisted,
};
