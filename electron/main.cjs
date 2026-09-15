const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

if (app.isPackaged) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.resourcesPath, 'ms-playwright');
}

const { runPipeline, abortPipeline } = require('./pipeline.cjs');
const { loginAndCaptureSession, clearSession, loadPersisted } = require('./semrush.cjs');
const { runCapture, abortCapture } = require('./wayback.cjs');

const isDev = process.env.ELECTRON_DEV === '1';
let mainWindow = null;

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function getDefaultResultsDir() {
  return path.join(app.getPath('documents'), 'ART France', 'Wayback Shots');
}

function readSettings() {
  const defaults = {
    serperKey: '',
    searchProvider: 'serper',
    yandexApiKey: '',
    yandexFolderId: '',
    yandexRegionId: 213,
    semrushEmail: '',
    semrushPassword: '',
    checkTrustKey: '',
    ahrefsApiKey: '',
    lastQuery: '',
    minAgeYears: 2,
    minIks: 100,
    minDr: 20,
    minAs: 20,
    topSourcesCount: 5,
    maxOutlinksPerSource: 40,
    domains: '',
    frequency: 'monthly',
    resultsDir: getDefaultResultsDir(),
    maxSnapshots: 36,
    uiMode: 'drops',
    semrushLastLoginAt: 0,
  };

  try {
    const raw = fs.readFileSync(getSettingsPath(), 'utf8');
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

function writeSettings(partial) {
  const next = { ...readSettings(), ...partial };
  fs.mkdirSync(path.dirname(getSettingsPath()), { recursive: true });
  fs.writeFileSync(getSettingsPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function createWindow() {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1380,
    height: 920,
    minWidth: 980,
    minHeight: 720,
    backgroundColor: '#0b0c10',
    title: 'ART France — Drop Domains',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('did-fail-load', code, desc, url);
    dialog.showErrorBox(
      'Не удалось открыть интерфейс',
      `Код: ${code}\n${desc}\n${url}\n\nЗапустите через npm start`
    );
  });

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5174');
  } else {
    const indexHtml = path.join(__dirname, '..', 'dist', 'index.html');
    if (!fs.existsSync(indexHtml)) {
      dialog.showErrorBox(
        'Сборка не найдена',
        `Нет файла:\n${indexHtml}\n\nСначала выполните: npm run build`
      );
      app.quit();
      return;
    }
    mainWindow.loadFile(indexHtml);
  }
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  abortPipeline();
  abortCapture();
  if (process.platform !== 'darwin') app.quit();
});

const LOGIN_COOLDOWN_MS = 30 * 60 * 1000; // 30 минут между принудительными входами

function getSessionInfo() {
  const settings = readSettings();
  const hasSession = loadPersisted(app.getPath('userData'));
  const last = Number(settings.semrushLastLoginAt) || 0;
  const elapsed = Date.now() - last;
  const cooldownRemainingMs =
    hasSession && last > 0 ? Math.max(0, LOGIN_COOLDOWN_MS - elapsed) : 0;
  return {
    hasSemrushSession: Boolean(hasSession),
    semrushLastLoginAt: last,
    loginCooldownRemainingMs: cooldownRemainingMs,
    loginCooldownMinutes: Math.ceil(LOGIN_COOLDOWN_MS / 60000),
  };
}

ipcMain.handle('settings:get', () => {
  const settings = readSettings();
  return { ...settings, ...getSessionInfo() };
});

ipcMain.handle('settings:save', (_event, partial) => {
  const settings = writeSettings(partial || {});
  return { ...settings, ...getSessionInfo() };
});

ipcMain.handle('semrush:login', async (_event, options = {}) => {
  const force = Boolean(options?.force);
  const settings = readSettings();
  const info = getSessionInfo();

  if (!force && info.loginCooldownRemainingMs > 0 && info.hasSemrushSession) {
    const mins = Math.ceil(info.loginCooldownRemainingMs / 60000);
    return {
      ok: false,
      error: `Повторный вход недоступен ещё ~${mins} мин. Сессия уже сохранена — просто запускайте поиск. Сброс сессии снимает ограничение.`,
      ...info,
    };
  }

  if (!settings.semrushEmail?.trim() || !settings.semrushPassword) {
    return { ok: false, error: 'Сначала сохраните email и пароль Semrush', ...info };
  }

  try {
    const result = await loginAndCaptureSession({
      email: settings.semrushEmail,
      password: settings.semrushPassword,
      userDataPath: app.getPath('userData'),
      onLog: (payload) => send('job:log', payload),
    });
    writeSettings({ semrushLastLoginAt: Date.now() });
    return { ok: true, ...result, ...getSessionInfo() };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ...getSessionInfo(),
    };
  }
});

ipcMain.handle('semrush:logout', () => {
  clearSession(app.getPath('userData'));
  writeSettings({ semrushLastLoginAt: 0 });
  return { ok: true, ...getSessionInfo() };
});

ipcMain.handle('job:start', async (_event, options) => {
  const current = readSettings();
  const settings = writeSettings({
    lastQuery: options?.query ?? '',
    searchProvider: options?.searchProvider ?? current.searchProvider,
    serperKey: options?.serperKey ?? current.serperKey,
    yandexApiKey: options?.yandexApiKey ?? current.yandexApiKey,
    yandexFolderId: options?.yandexFolderId ?? current.yandexFolderId,
    yandexRegionId: options?.yandexRegionId ?? current.yandexRegionId,
    semrushEmail: options?.semrushEmail ?? current.semrushEmail,
    semrushPassword: options?.semrushPassword ?? current.semrushPassword,
    checkTrustKey: options?.checkTrustKey ?? current.checkTrustKey,
    ahrefsApiKey: options?.ahrefsApiKey ?? current.ahrefsApiKey,
    minAgeYears: options?.minAgeYears ?? current.minAgeYears,
    minIks: options?.minIks ?? current.minIks,
    minDr: options?.minDr ?? current.minDr,
    minAs: options?.minAs ?? current.minAs,
    topSourcesCount: options?.topSourcesCount ?? current.topSourcesCount,
    maxOutlinksPerSource: options?.maxOutlinksPerSource ?? current.maxOutlinksPerSource,
  });

  try {
    const result = await runPipeline(
      {
        query: settings.lastQuery,
        searchProvider: settings.searchProvider,
        serperKey: settings.serperKey,
        yandexApiKey: settings.yandexApiKey,
        yandexFolderId: settings.yandexFolderId,
        yandexRegionId: Number(settings.yandexRegionId) || 213,
        semrushEmail: settings.semrushEmail,
        semrushPassword: settings.semrushPassword,
        checkTrustKey: settings.checkTrustKey,
        ahrefsApiKey: settings.ahrefsApiKey,
        userDataPath: app.getPath('userData'),
        minAgeYears: Number(settings.minAgeYears) || 2,
        minIks: Number(settings.minIks) || 100,
        minDr: Number(settings.minDr) || 20,
        minAs: Number(settings.minAs) || 20,
        topSourcesCount: Number(settings.topSourcesCount) || 5,
        maxOutlinksPerSource: Number(settings.maxOutlinksPerSource) || 40,
      },
      {
        onProgress: (payload) => send('job:progress', payload),
        onLog: (payload) => send('job:log', payload),
      }
    );
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    send('job:log', { level: 'error', message });
    send('job:log', {
      level: 'warn',
      message: err?.code === 'ABORTED' ? 'Поиск остановлен пользователем.' : 'Поиск завершён с ошибкой.',
    });
    if (err?.code === 'ABORTED') {
      return { ok: false, aborted: true, error: 'Остановлено пользователем', good: [], bad: [] };
    }
    return {
      ok: false,
      error: message,
      good: [],
      bad: [],
    };
  }
});

ipcMain.handle('job:stop', () => {
  abortPipeline();
  return { ok: true };
});

ipcMain.handle('export:csv', async (_event, payload) => {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const kind = payload?.kind === 'bad' ? 'bad' : 'good';
  if (!rows.length) return { ok: false, error: 'Нет строк для экспорта' };

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Сохранить CSV',
    defaultPath: path.join(
      app.getPath('documents'),
      'ART France',
      `drop-domains-${kind}-${new Date().toISOString().slice(0, 10)}.csv`
    ),
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });

  if (result.canceled || !result.filePath) return { ok: false, canceled: true };

  const header = [
    'domain',
    'age_years',
    'iks',
    'dr',
    'as',
    'source_domain',
    'source_url',
    'reason',
    'checked_at',
  ];

  // В русской Excel разделитель столбцов — «;», не «,»
  const SEP = ';';

  const escape = (value) => {
    const s = value == null ? '' : String(value);
    if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const lines = [header.join(SEP)];
  for (const row of rows) {
    lines.push(
      [
        row.domain,
        row.ageYears,
        row.iks,
        row.dr,
        row.as,
        row.sourceDomain,
        row.sourceUrl,
        row.reason,
        row.checkedAt,
      ]
        .map(escape)
        .join(SEP)
    );
  }

  fs.mkdirSync(path.dirname(result.filePath), { recursive: true });
  fs.writeFileSync(result.filePath, `\uFEFF${lines.join('\n')}`, 'utf8');
  return { ok: true, path: result.filePath };
});

ipcMain.handle('dialog:pickResultsDir', async () => {
  const current = readSettings().resultsDir || getDefaultResultsDir();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Папка для результатов',
    defaultPath: current,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return writeSettings({ resultsDir: result.filePaths[0] }).resultsDir;
});

ipcMain.handle('shell:openPath', async (_event, targetPath) => {
  if (!targetPath) return;
  fs.mkdirSync(targetPath, { recursive: true });
  return shell.openPath(targetPath);
});

ipcMain.handle('shell:openExternal', async (_event, url) => {
  const value = String(url || '').trim();
  if (!/^https?:\/\//i.test(value)) return { ok: false };
  await shell.openExternal(value);
  return { ok: true };
});

ipcMain.handle('window:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});

ipcMain.handle('window:maximize', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});

ipcMain.handle('window:close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});

ipcMain.handle('checktrust:lookup', async (_event, payload) => {
  const { fetchCheckTrust } = require('./checktrust.cjs');
  const maxAttempts = Number(payload?.maxAttempts);
  const delayMs = Number(payload?.delayMs);
  return fetchCheckTrust(payload?.host, payload?.applicationKey || readSettings().checkTrustKey, {
    // UI обычно шлёт maxAttempts:1 и крутит опрос сама; без опций — длинный poll
    ...(Number.isFinite(maxAttempts) && maxAttempts > 0 ? { maxAttempts } : {}),
    ...(Number.isFinite(delayMs) && delayMs > 0 ? { delayMs } : {}),
    ...(payload?.waybackFallback === true ? { waybackFallback: true } : {}),
  });
});

/** On-demand metrics for one Good domain (CheckTrust + Ahrefs DR). */
ipcMain.handle('domain:metrics', async (_event, payload) => {
  const { fetchCheckTrust, DEFAULT_POLL_ATTEMPTS, DEFAULT_POLL_DELAY_MS } = require('./checktrust.cjs');
  const { fetchDomainRating } = require('./ahrefs.cjs');
  const settings = readSettings();
  const host = String(payload?.host || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];

  if (!host) {
    return { ok: false, error: 'Пустой домен', host: '' };
  }

  const ctKey = String(payload?.checkTrustKey || settings.checkTrustKey || '').trim();
  const ahKey = String(payload?.ahrefsApiKey || settings.ahrefsApiKey || '').trim();

  if (!ctKey && !ahKey) {
    return {
      ok: false,
      host,
      error: 'Нет ключей CheckTrust / Ahrefs — откройте Настройки',
    };
  }

  let checkTrust = null;
  let ageYears = null;
  let iks = null;
  let waybackOldest = null;
  let dr = null;
  const notes = [];

  // Ahrefs DR — быстро, параллельно с долгим CheckTrust
  const ahPromise = ahKey
    ? fetchDomainRating(host, ahKey)
    : Promise.resolve(null);

  if (ctKey) {
    // Новые хосты у CheckTrust часто считают 2–4 минуты
    const maxAttempts =
      Number(payload?.maxAttempts) > 0 ? Number(payload.maxAttempts) : Math.max(DEFAULT_POLL_ATTEMPTS, 48);
    const delayMs =
      Number(payload?.delayMs) > 0 ? Number(payload.delayMs) : DEFAULT_POLL_DELAY_MS;
    const ct = await fetchCheckTrust(host, ctKey, {
      maxAttempts,
      delayMs,
      waybackFallback: true,
    });
    if (ct.ok) {
      ageYears = ct.ageYears ?? null;
      iks = ct.sqi ?? null;
      waybackOldest = ct.webarchiveFirst ? String(ct.webarchiveFirst) : null;
      checkTrust = {
        sqi: ct.sqi,
        ageYears: ct.ageYears,
        webarchiveDays: ct.webarchiveDays,
        webarchiveFirst: ct.webarchiveFirst,
        metrics: ct.metrics,
        note: ct.note || undefined,
        code: ct.code || undefined,
      };
    } else {
      checkTrust = { error: ct.error || 'CheckTrust не ответил', code: ct.code || undefined };
      notes.push(ct.error || 'CheckTrust: ошибка');
    }
  } else {
    notes.push('CheckTrust key не задан');
  }

  const ah = await ahPromise;
  if (ah) {
    if (ah.ok) {
      dr = ah.dr;
    } else {
      notes.push(ah.error || 'Ahrefs DR не загрузился');
    }
  }

  const hasAny = Boolean(checkTrust?.metrics) || dr != null;
  return {
    ok: hasAny,
    host,
    ageYears,
    iks,
    dr,
    waybackOldest,
    hasSnapshots2y: ageYears != null ? ageYears >= (Number(settings.minAgeYears) || 2) : false,
    checkTrust,
    error: hasAny ? undefined : notes.filter(Boolean).join(' · ') || undefined,
    code: checkTrust?.code,
  };
});

ipcMain.handle('capture:start', async (_event, options) => {
  const settings = writeSettings({
    domains: options.domainsText ?? '',
    frequency: options.frequency,
    resultsDir: options.resultsDir,
    maxSnapshots: options.maxSnapshots,
  });

  return runCapture(
    {
      domainsText: settings.domains,
      frequency: settings.frequency,
      resultsDir: settings.resultsDir,
      maxSnapshots: settings.maxSnapshots,
    },
    {
      onProgress: (payload) => send('capture:progress', payload),
      onLog: (payload) => send('capture:log', payload),
    }
  );
});

ipcMain.handle('capture:stop', () => {
  abortCapture();
  return { ok: true };
});
