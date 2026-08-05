/** Полный набор (медленно: Majestic / Keys.so / LRT могут считать много минут) */
const PARAMETER_LIST_FULL = [
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

/** Базовый набор для UI: ИКС + возраст Webarchive — обычно приходит за 1–2 мин */
const PARAMETER_LIST_BASIC = [
  'trust',
  'spam',
  'sqi',
  'webarchive',
  'webarchiveDays',
].join(',');

/** @deprecated alias — по умолчанию больше не тянем полный список */
const PARAMETER_LIST = PARAMETER_LIST_BASIC;

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
  'CheckTrust ещё считает метрики. Подождите — приложение продолжает опрос; если сообщение останется, нажмите кнопку ещё раз.';

/** Default poll for basic list: обычно хватает 1–3 мин; запас до ~8 мин */
const DEFAULT_POLL_ATTEMPTS = 96;
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

function digMetricsBlob(root, domain) {
  let metrics = pickMetrics(root);
  if (metrics && typeof metrics === 'object') {
    if (domain && metrics[domain] && typeof metrics[domain] === 'object') {
      metrics = metrics[domain];
    } else if (metrics.host && typeof metrics.host === 'object' && !('sqi' in metrics)) {
      metrics = metrics.host;
    }
  }
  return metrics && typeof metrics === 'object' ? metrics : null;
}

/** CheckTrust часто отдаёт «заглушки», пока считает: -1, 0000-00-00, дни=0 без даты */
function isPlaceholderMetricValue(key, value) {
  if (value == null || value === '') return true;
  if (value === -1 || value === '-1') return true;
  const s = String(value).trim();
  if (!s || s === 'n/a' || s === 'N/A' || s === '-') return true;
  if (/^0{4}-0{2}-0{2}/.test(s)) return true;
  return false;
}

function sanitizeMetrics(metrics) {
  if (!metrics || typeof metrics !== 'object') return null;
  const out = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (key === 'success' || key === 'message' || key === 'error' || key.startsWith('_')) continue;
    if (isPlaceholderMetricValue(key, value)) continue;
    out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

/** Есть ли хоть что-то полезное (ИКС / возраст), даже при «in process». */
function extractUsableFields(metrics) {
  if (!metrics || typeof metrics !== 'object') {
    return { usable: false, sqi: null, webarchiveDays: null, ageYears: null, webarchiveFirst: null };
  }
  let sqi = toNumber(metrics.sqi ?? metrics.SQI ?? metrics.iks);
  if (sqi != null && sqi < 0) sqi = null;

  let webarchiveFirst = metrics.webarchive ?? metrics.webarchiveFirst ?? null;
  if (isPlaceholderMetricValue('webarchive', webarchiveFirst)) webarchiveFirst = null;

  let webarchiveDays = toNumber(metrics.webarchiveDays ?? metrics.webarchive_days);
  if (webarchiveDays != null && webarchiveDays < 0) webarchiveDays = null;
  // 0 дней без реальной даты — заглушка CheckTrust, не возраст
  if (webarchiveDays === 0 && !webarchiveFirst) webarchiveDays = null;

  const ageYears =
    webarchiveDays != null ? Math.max(0, Math.floor(webarchiveDays / 365.25)) : null;

  // trust=0 / spam=-1 сами по себе не считаем «метриками пришли»
  const usable = sqi != null || webarchiveDays != null || Boolean(webarchiveFirst);
  return { usable, sqi, webarchiveDays, ageYears, webarchiveFirst };
}

/** Для basic-набора достаточно ИКС + возраста — можно завершать опрос раньше. */
function hasCoreMetrics(fieldsOrResult) {
  if (!fieldsOrResult) return false;
  const sqi = fieldsOrResult.sqi;
  const age =
    fieldsOrResult.ageYears != null ||
    (fieldsOrResult.webarchiveDays != null && fieldsOrResult.webarchiveDays > 0) ||
    Boolean(fieldsOrResult.webarchiveFirst);
  return sqi != null && age;
}

function mergeMetricMaps(prev, next) {
  const out = { ...(prev && typeof prev === 'object' ? prev : {}) };
  if (!next || typeof next !== 'object') return out;
  for (const [key, value] of Object.entries(next)) {
    if (isPlaceholderMetricValue(key, value)) continue;
    out[key] = value;
  }
  return out;
}

function interpretResponse(domain, res, json) {
  const body = unwrapBody(json);
  const stillProcessing = isInProcessPayload(body) || isInProcessPayload(json);

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

  // Сначала пробуем вытащить метрики — CheckTrust отдаёт поля постепенно, пока «in process»
  const metricsCandidate = sanitizeMetrics(
    digMetricsBlob(body, domain) || digMetricsBlob(json, domain) || null
  );
  const fields = extractUsableFields(metricsCandidate);

  if (fields.usable) {
    const payload = {
      host: domain,
      metrics: metricsCandidate,
      sqi: fields.sqi,
      webarchiveDays: fields.webarchiveDays,
      ageYears: fields.ageYears,
      webarchiveFirst: fields.webarchiveFirst,
      balance: body?.hostLimitsBalance ?? json?.hostLimitsBalance,
      partial: stillProcessing && !hasCoreMetrics(fields),
    };

    // Ещё считает, но уже есть куски — UI покажет и продолжит ждать
    if (stillProcessing && !hasCoreMetrics(fields)) {
      return {
        ok: false,
        code: 'CT_PARTIAL',
        error: IN_PROCESS_ERROR,
        ...payload,
        raw: body || json,
      };
    }

    return {
      ok: true,
      code: 'OK',
      ...payload,
      partial: false,
    };
  }

  if (stillProcessing) {
    return {
      ok: false,
      code: 'CT_IN_PROCESS',
      error: IN_PROCESS_ERROR,
      metrics: null,
      raw: body || json,
    };
  }

  // Расчёт на стороне CT уже завершён, но ИКС/возраст — заглушки (-1 / 0000-00-00).
  // Повторные запросы только тратят баланс — дальше UI/Wayback.
  if (res.ok && body?.success === true) {
    return {
      ok: false,
      code: 'CT_DONE_EMPTY',
      error:
        'CheckTrust завершил проверку, но не вернул ИКС/возраст (типично для free-доменов без сайта).',
      metrics: metricsCandidate,
      balance: body?.hostLimitsBalance ?? json?.hostLimitsBalance,
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

  let metricsRaw = digMetricsBlob(body, domain) || {};
  if (metricsRaw.success === false) {
    if (isLimitsPayload(metricsRaw)) {
      return { ok: false, code: 'CT_LIMITS', error: LIMITS_ERROR, metrics: null, raw: metricsRaw };
    }
    if (isInProcessPayload(metricsRaw)) {
      return { ok: false, code: 'CT_IN_PROCESS', error: IN_PROCESS_ERROR, metrics: null, raw: metricsRaw };
    }
    return {
      ok: false,
      code: 'API',
      error: String(metricsRaw.message || metricsRaw.error || 'CheckTrust ошибка'),
      metrics: null,
      raw: metricsRaw,
    };
  }

  const metrics = sanitizeMetrics(metricsRaw) || {};
  const finalFields = extractUsableFields(metrics);
  if (!finalFields.usable) {
    return {
      ok: false,
      code: 'CT_EMPTY',
      error: 'CheckTrust не вернул ИКС/возраст по этому домену',
      metrics: Object.keys(metrics).length ? metrics : null,
      raw: body || json,
    };
  }

  return {
    ok: true,
    code: 'OK',
    host: domain,
    metrics,
    sqi: finalFields.sqi,
    webarchiveDays: finalFields.webarchiveDays,
    ageYears: finalFields.ageYears,
    webarchiveFirst: finalFields.webarchiveFirst,
    balance: body?.hostLimitsBalance ?? json?.hostLimitsBalance,
    partial: false,
  };
}

async function requestCheckTrustOnce(domain, applicationKey, parameterList = PARAMETER_LIST_BASIC) {
  const url =
    `https://checktrust.ru/app.php?r=host/app/summary/basic` +
    `&applicationKey=${encodeURIComponent(applicationKey.trim())}` +
    `&host=${encodeURIComponent(domain)}` +
    `&parameterList=${encodeURIComponent(parameterList)}`;

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
 * Fetch host summary from CheckTrust.
 * By default uses BASIC parameter list (sqi + webarchive) so first request finishes in time.
 * Pass { full: true } for the heavy Majestic/Keys.so/LRT set.
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
  const parameterList =
    options.parameterList ||
    (options.full ? PARAMETER_LIST_FULL : PARAMETER_LIST_BASIC);

  // UI крутит опрос сама с maxAttempts:1 — Wayback только по явному флагу
  // или после длинного серверного poll (maxAttempts > 1).
  const useWaybackFallback =
    options.waybackFallback === true ||
    (options.waybackFallback !== false && maxAttempts > 1);

  try {
    let last = null;
    let bestPartial = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      onAttempt?.({ attempt, maxAttempts, domain, partial: bestPartial });
      last = await requestCheckTrustOnce(domain, applicationKey, parameterList);

      if (last.code === 'CT_PARTIAL') {
        bestPartial = {
          ...last,
          metrics: mergeMetricMaps(bestPartial?.metrics, last.metrics),
          sqi: last.sqi ?? bestPartial?.sqi ?? null,
          webarchiveDays: last.webarchiveDays ?? bestPartial?.webarchiveDays ?? null,
          ageYears: last.ageYears ?? bestPartial?.ageYears ?? null,
          webarchiveFirst: last.webarchiveFirst ?? bestPartial?.webarchiveFirst ?? null,
        };
        if (typeof options.onPartial === 'function') options.onPartial(bestPartial);
        if (hasCoreMetrics(bestPartial)) {
          return { ...bestPartial, ok: true, code: 'OK', partial: false, error: undefined };
        }
        if (attempt < maxAttempts) await sleep(delayMs);
        continue;
      }

      if (last.ok) {
        const merged = {
          ...last,
          metrics: mergeMetricMaps(bestPartial?.metrics, last.metrics),
          sqi: last.sqi ?? bestPartial?.sqi ?? null,
          webarchiveDays: last.webarchiveDays ?? bestPartial?.webarchiveDays ?? null,
          ageYears: last.ageYears ?? bestPartial?.ageYears ?? null,
          webarchiveFirst: last.webarchiveFirst ?? bestPartial?.webarchiveFirst ?? null,
          partial: false,
        };
        return merged;
      }

      // CT уже закончил с пустыми ИКС/возрастом — не жжём баланс повторными запросами
      if (last.code === 'CT_DONE_EMPTY') break;

      if (last.code !== 'CT_IN_PROCESS' && last.code !== 'CT_EMPTY') return last;
      if (attempt < maxAttempts) await sleep(delayMs);
    }

    // После полного ожидания: если есть частичные метрики CT — отдаём их
    if (bestPartial && extractUsableFields(bestPartial.metrics || bestPartial).usable) {
      return {
        ...bestPartial,
        ok: true,
        code: 'OK_PARTIAL',
        partial: true,
        error: undefined,
        note:
          bestPartial.note ||
          'Показаны уже пришедшие метрики CheckTrust.',
      };
    }

    // Только если CT так ничего и не отдал — возраст из Wayback (не вместо CT)
    if (useWaybackFallback) {
      try {
        const { checkOldSnapshot } = require('./wayback-check.cjs');
        const wb = await checkOldSnapshot(domain, 0);
        if (wb?.ok && wb.oldest) {
          const ageYears = wb.ageYears != null ? wb.ageYears : null;
          const stamp = String(wb.oldest);
          const webarchiveFirst =
            stamp.length >= 8
              ? `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`
              : stamp;
          return {
            ok: true,
            code: 'OK_WAYBACK',
            host: domain,
            metrics: {
              webarchive: webarchiveFirst,
              webarchiveDays:
                ageYears != null ? Math.round(ageYears * 365.25) : null,
              sqi: null,
              _source: 'wayback-fallback',
            },
            sqi: null,
            webarchiveDays: ageYears != null ? Math.round(ageYears * 365.25) : null,
            ageYears,
            webarchiveFirst,
            source: 'wayback',
          };
        }
        if (wb?.ok && !wb.oldest) {
          return {
            ok: false,
            code: 'CT_NO_DATA',
            error:
              'CheckTrust не вернул ИКС/возраст, и в Wayback нет снимков этого домена.',
            metrics: null,
          };
        }
      } catch {
        // ignore
      }
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
    if (key === 'host' || key === 'success' || key.startsWith('_')) continue;
    rows.push({ key, label: key, value });
  }
  return rows;
}

module.exports = {
  PARAMETER_LIST,
  PARAMETER_LIST_BASIC,
  PARAMETER_LIST_FULL,
  PARAM_LABELS,
  fetchCheckTrust,
  metricsToDetails,
  toNumber,
  isLimitsPayload,
  isInProcessPayload,
  hasCoreMetrics,
  mergeMetricMaps,
  interpretResponse,
  sanitizeMetrics,
  extractUsableFields,
  LIMITS_ERROR,
  IN_PROCESS_ERROR,
  DEFAULT_POLL_ATTEMPTS,
  DEFAULT_POLL_DELAY_MS,
};
