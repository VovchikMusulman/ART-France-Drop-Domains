const PARAMETER_LIST = [
  'trust',
  'spam',
  'sqi',
  'hostQuality',
  'liVisitors',
  'liDepth',
  'loadingTime',
  'prcyRank',
  'statusCode',
  'xToolTrust',
  'yaIndex',
  'googleIndex',
  'googleVirus',
  'hasSsl',
  'sucuriSecurity',
  'webarchive',
  'webarchiveDays',
  'ip',
  'mjDin',
  'mjHin',
  'mjCF',
  'mjTF',
  'semrushRuRating',
  'semrushRuSeTraffic',
  'semrushRuSeKWords',
  'keysSoDBUDomainsGoogle',
  'keysSoODUUrlsYa',
  'keysSoODUDomainsYa',
  'keysSoDBUUrlsYa',
  'keysSoDBUDomainsYa',
  'keysSoDBUUrlsGoogle',
  'keysSoODUDomainsGoogle',
  'keysSoODUUrlsGoogle',
  'keysSoTop10YaMSK',
  'keysSoResultYaMSK',
  'keysSoVisYaMSK',
  'keysSoTrafYaMSK',
  'keysSoPagesYaMSK',
  'keysSoTop10GoogleMSK',
  'keysSoResultGoogleMSK',
  'keysSoVisGoogleMSK',
  'keysSoTrafGoogleMSK',
  'keysSoPagesGoogleMSK',
  'lrtPowerTrust',
  'lrtPower',
  'lrtTrust',
  'lrtBacklinks',
  'lrtRefDomains',
].join(',');

/** Human-readable labels for detail panel */
const PARAM_LABELS = {
  trust: 'Траст сайта',
  spam: 'Заспамленность',
  sqi: 'ИКС',
  hostQuality: 'Оценка качества хоста',
  liVisitors: 'Посетители LiveInternet',
  liDepth: 'Глубина просмотра LI',
  loadingTime: 'Время загрузки (мс)',
  prcyRank: 'PR-CY Rank',
  statusCode: 'Код ответа сервера',
  xToolTrust: 'XTool Trust',
  yaIndex: 'Яндекс индекс',
  googleIndex: 'Google индекс',
  googleVirus: 'Google Вирусы',
  hasSsl: 'SSL',
  sucuriSecurity: 'Sucuri security',
  webarchive: 'Webarchive: первое упоминание',
  webarchiveDays: 'Webarchive: возраст (дней)',
  ip: 'IP',
  mjDin: 'Majestic входящих уникальных',
  mjHin: 'Majestic входящих ссылок',
  mjCF: 'Majestic Citation Flow',
  mjTF: 'Majestic Trust Flow',
  semrushRuRating: 'SEMrush Rank',
  semrushRuSeTraffic: 'SEMrush трафик',
  semrushRuSeKWords: 'SEMrush ключевые слова',
  keysSoDBUDomainsGoogle: 'Keys.so вх. уникальных Google',
  keysSoODUUrlsYa: 'Keys.so исх. URL Яндекс',
  keysSoODUDomainsYa: 'Keys.so исх. доменов Яндекс',
  keysSoDBUUrlsYa: 'Keys.so вх. URL Яндекс',
  keysSoDBUDomainsYa: 'Keys.so вх. уникальных Яндекс',
  keysSoDBUUrlsGoogle: 'Keys.so вх. URL Google',
  keysSoODUDomainsGoogle: 'Keys.so исх. доменов Google',
  keysSoODUUrlsGoogle: 'Keys.so исх. URL Google',
  keysSoTop10YaMSK: 'Keys.so топ-10 Яндекс МСК',
  keysSoResultYaMSK: 'Keys.so результат. Яндекс МСК',
  keysSoVisYaMSK: 'Keys.so видимость Яндекс МСК',
  keysSoTrafYaMSK: 'Keys.so трафик Яндекс МСК',
  keysSoPagesYaMSK: 'Keys.so страниц в топе Яндекс',
  keysSoTop10GoogleMSK: 'Keys.so топ-10 Google МСК',
  keysSoResultGoogleMSK: 'Keys.so результат. Google МСК',
  keysSoVisGoogleMSK: 'Keys.so видимость Google МСК',
  keysSoTrafGoogleMSK: 'Keys.so трафик Google МСК',
  keysSoPagesGoogleMSK: 'Keys.so страниц в топе Google',
  lrtPowerTrust: 'LRT PowerTrust',
  lrtPower: 'LRT Power',
  lrtTrust: 'LRT Trust',
  lrtBacklinks: 'LRT входящих ссылок',
  lrtRefDomains: 'LRT входящих уникальных',
};

function toNumber(value) {
  if (value == null || value === '' || value === 'n/a' || value === 'N/A' || value === '-') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const cleaned = String(value).replace(/\s+/g, '').replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function pickMetrics(obj) {
  if (!obj || typeof obj !== 'object') return {};
  // Common CheckTrust shapes: { data: {...} }, { result: {...} }, flat object, or { [host]: {...} }
  if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) return obj.data;
  if (obj.result && typeof obj.result === 'object' && !Array.isArray(obj.result)) return obj.result;
  if (obj.summary && typeof obj.summary === 'object') return obj.summary;
  return obj;
}

function isLimitsPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const msg = String(payload.message || payload.error || '').toLowerCase();
  if (/limits?\s*expired|недостаточно|баланс|no\s*funds|hostlimitsbalance/i.test(msg)) return true;
  if (payload.hostLimitsBalance === 0 && payload.success === false) return true;
  if (payload.success === false && /limit/i.test(msg)) return true;
  return false;
}

function isInProcessPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const msg = String(payload.message || payload.error || '');
  // CheckTrust: сначала "Host saved. Waiting for data.", потом "Host is in process."
  return (
    /host\s+is\s+in\s+process\.?/i.test(msg) ||
    /waiting\s+for\s+data/i.test(msg) ||
    /host\s+saved/i.test(msg)
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const LIMITS_ERROR =
  'На CheckTrust не хватает средств. Пополните баланс и проверьте домен во вкладке CheckTrust.';

const IN_PROCESS_ERROR =
  'CheckTrust ещё считает метрики. Подождите и нажмите «Обновить метрики» ещё раз — анализ уже запущен на стороне сервиса.';

/** Default poll: full parameterList (Majestic/Keys.so/…) often needs 1–3 min for a new host */
const DEFAULT_POLL_ATTEMPTS = 36;
const DEFAULT_POLL_DELAY_MS = 5000;

function unwrapBody(json) {
  if (
    json &&
    typeof json === 'object' &&
    json.data &&
    typeof json.data === 'object' &&
    ('success' in json.data || 'message' in json.data) &&
    !('sqi' in json.data) &&
    !('trust' in json.data)
  ) {
    return json.data;
  }
  return json;
}

function interpretResponse(domain, res, json) {
  const body = unwrapBody(json);

  if (isLimitsPayload(body) || isLimitsPayload(json)) {
    return {
      ok: false,
      code: 'CT_LIMITS',
      error: LIMITS_ERROR,
      metrics: null,
      balance: body?.hostLimitsBalance ?? json?.hostLimitsBalance ?? 0,
      raw: body || json,
    };
  }

  if (isInProcessPayload(body) || isInProcessPayload(json)) {
    return {
      ok: false,
      code: 'CT_IN_PROCESS',
      error: IN_PROCESS_ERROR,
      metrics: null,
      raw: body || json,
    };
  }

  if (!res.ok) {
    const errText =
      body?.error || body?.message || json?.error || json?.message || `CheckTrust HTTP ${res.status}`;
    if (isInProcessPayload({ message: errText }) || isInProcessPayload(body)) {
      return { ok: false, code: 'CT_IN_PROCESS', error: IN_PROCESS_ERROR, metrics: null, raw: json };
    }
    return {
      ok: false,
      code: 'HTTP',
      error: String(errText),
      metrics: null,
      raw: json,
    };
  }

  if (body?.success === false || body?.error) {
    const errText = String(body.error || body.message || 'CheckTrust ошибка');
    if (/limits?\s*expired|limit/i.test(errText)) {
      return { ok: false, code: 'CT_LIMITS', error: LIMITS_ERROR, metrics: null, raw: body };
    }
    if (isInProcessPayload(body) || isInProcessPayload({ message: errText })) {
      return { ok: false, code: 'CT_IN_PROCESS', error: IN_PROCESS_ERROR, metrics: null, raw: body };
    }
    return { ok: false, code: 'API', error: errText, metrics: null, raw: body };
  }

  let metrics = pickMetrics(body);
  if (isInProcessPayload(metrics)) {
    return { ok: false, code: 'CT_IN_PROCESS', error: IN_PROCESS_ERROR, metrics: null, raw: metrics };
  }
  if (metrics.success === false || isLimitsPayload(metrics)) {
    if (isInProcessPayload(metrics)) {
      return { ok: false, code: 'CT_IN_PROCESS', error: IN_PROCESS_ERROR, metrics: null, raw: metrics };
    }
    return { ok: false, code: 'CT_LIMITS', error: LIMITS_ERROR, metrics: null, raw: metrics };
  }

  if (metrics[domain] && typeof metrics[domain] === 'object') {
    metrics = metrics[domain];
  } else if (metrics.host && typeof metrics.host === 'object' && !('sqi' in metrics)) {
    metrics = metrics.host;
  }

  if (metrics.success === false) {
    if (isLimitsPayload(metrics)) {
      return { ok: false, code: 'CT_LIMITS', error: LIMITS_ERROR, metrics: null, raw: metrics };
    }
    if (isInProcessPayload(metrics)) {
      return { ok: false, code: 'CT_IN_PROCESS', error: IN_PROCESS_ERROR, metrics: null, raw: metrics };
    }
    return {
      ok: false,
      code: 'API',
      error: String(metrics.message || metrics.error || 'CheckTrust ошибка'),
      metrics: null,
      raw: metrics,
    };
  }

  // CheckTrust uses -1 as "нет данных"
  let sqi = toNumber(metrics.sqi ?? metrics.SQI ?? metrics.iks);
  if (sqi != null && sqi < 0) sqi = null;
  let webarchiveDays = toNumber(metrics.webarchiveDays ?? metrics.webarchive_days);
  if (webarchiveDays != null && webarchiveDays < 0) webarchiveDays = null;
  const ageYears =
    webarchiveDays != null ? Math.max(0, Math.floor(webarchiveDays / 365.25)) : null;

  return {
    ok: true,
    code: 'OK',
    host: domain,
    metrics,
    sqi,
    webarchiveDays,
    ageYears,
    webarchiveFirst: metrics.webarchive ?? metrics.webarchiveFirst ?? null,
    balance: body?.hostLimitsBalance ?? json?.hostLimitsBalance,
  };
}

async function requestCheckTrustOnce(domain, applicationKey) {
  const url =
    `https://checktrust.ru/app.php?r=host/app/summary/basic` +
    `&applicationKey=${encodeURIComponent(applicationKey.trim())}` +
    `&host=${encodeURIComponent(domain)}` +
    `&parameterList=${encodeURIComponent(PARAMETER_LIST)}`;

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(45000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    return {
      ok: false,
      code: 'PARSE',
      error: `CheckTrust: не JSON (HTTP ${res.status})`,
      metrics: null,
      raw: text.slice(0, 400),
    };
  }
  return interpretResponse(domain, res, json);
}

/**
 * Fetch full CheckTrust host summary.
 * Polls while API returns "Waiting for data" / "Host is in process."
 * Pass { maxAttempts: 1 } for a single shot (UI can poll itself).
 * @see https://checktrust.ru/cabinet/api.html
 */
async function fetchCheckTrust(host, applicationKey, options = {}) {
  const domain = String(host || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];

  if (!domain) {
    return { ok: false, code: 'EMPTY', error: 'Пустой хост', metrics: null };
  }
  if (!applicationKey?.trim()) {
    return { ok: false, code: 'NO_KEY', error: 'Нет CheckTrust API key', metrics: null };
  }

  const maxAttempts =
    Number(options.maxAttempts) > 0 ? Number(options.maxAttempts) : DEFAULT_POLL_ATTEMPTS;
  const delayMs =
    Number(options.delayMs) > 0 ? Number(options.delayMs) : DEFAULT_POLL_DELAY_MS;
  const onAttempt = typeof options.onAttempt === 'function' ? options.onAttempt : null;

  try {
    let last = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      onAttempt?.({ attempt, maxAttempts, domain });
      last = await requestCheckTrustOnce(domain, applicationKey);
      if (last.ok || last.code !== 'CT_IN_PROCESS') return last;
      if (attempt < maxAttempts) await sleep(delayMs);
    }
    return (
      last || {
        ok: false,
        code: 'CT_IN_PROCESS',
        error: IN_PROCESS_ERROR,
        metrics: null,
      }
    );
  } catch (err) {
    return {
      ok: false,
      code: 'NETWORK',
      error: err instanceof Error ? err.message : String(err),
      metrics: null,
    };
  }
}

function metricsToDetails(metrics) {
  if (!metrics || typeof metrics !== 'object') return [];
  const rows = [];
  for (const [key, label] of Object.entries(PARAM_LABELS)) {
    if (!(key in metrics)) continue;
    rows.push({ key, label, value: metrics[key] });
  }
  // Any extra keys not in our map
  for (const [key, value] of Object.entries(metrics)) {
    if (PARAM_LABELS[key]) continue;
    if (key === 'host' || key === 'success') continue;
    rows.push({ key, label: key, value });
  }
  return rows;
}

module.exports = {
  PARAMETER_LIST,
  PARAM_LABELS,
  fetchCheckTrust,
  metricsToDetails,
  toNumber,
  isLimitsPayload,
  isInProcessPayload,
  LIMITS_ERROR,
  IN_PROCESS_ERROR,
  DEFAULT_POLL_ATTEMPTS,
  DEFAULT_POLL_DELAY_MS,
};
