const { searchTopSources } = require('./search.cjs');
const { openLiveSession } = require('./semrush.cjs');
const { probeDns } = require('./rdap.cjs');
const { checkWhoisAvailability } = require('./whois.cjs');
const { extractDomainFromUrl, sleep } = require('./utils.cjs');
const { DEFAULT_YANDEX_REGION_ID } = require('./yandex-regions.cjs');

let abortRequested = false;

/** Parallel map with fixed concurrency. */
async function mapPool(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : [];
  const n = Math.max(1, Math.min(concurrency, list.length || 1));
  const results = new Array(list.length);
  let next = 0;

  async function run() {
    while (true) {
      const idx = next;
      next += 1;
      if (idx >= list.length) return;
      results[idx] = await worker(list[idx], idx);
    }
  }

  await Promise.all(Array.from({ length: n }, () => run()));
  return results;
}

function abortPipeline() {
  abortRequested = true;
}

function assertNotAborted() {
  if (abortRequested) {
    const err = new Error('Остановлено пользователем');
    err.code = 'ABORTED';
    throw err;
  }
}

/** User-facing reasons only — no technical jargon */
function classifyAvailability({ dnsLive, availability, registered }) {
  // WHOIS "available" wins even if residual DNS exists (typical for drops / parking)
  if (availability === 'available' || registered === false) {
    return { bucket: 'good', reason: 'свободен' };
  }
  if (availability === 'registered' || registered === true) {
    return { bucket: 'bad', reason: 'домен занят' };
  }
  // WHOIS unknown → DNS as weak fallback
  if (dnsLive === true) {
    return { bucket: 'bad', reason: 'домен занят' };
  }
  return { bucket: 'bad', reason: 'не удалось проверить свободу' };
}

function softenSemrushLog(payload) {
  const msg = String(payload?.message || '');
  if (!msg) return null;

  if (/Проверяю сохранённую сессию/i.test(msg)) {
    return { level: 'info', message: 'Проверяю вход в Semrush…' };
  }
  if (/Сессия Semrush рабочая|уже авторизованы/i.test(msg)) {
    return { level: 'success', message: 'Semrush: вход уже есть' };
  }
  if (/сессия недействительна|нужен вход/i.test(msg)) {
    return { level: 'warn', message: 'Semrush: нужен повторный вход' };
  }
  if (/Вход в Semrush…/i.test(msg)) {
    return { level: 'info', message: 'Вхожу в Semrush…' };
  }
  if (/Вход в Semrush выполнен|Semrush готов/i.test(msg)) {
    return { level: 'success', message: 'Semrush готов' };
  }
  if (/Прогрев Outbound/i.test(msg)) {
    return { level: 'info', message: 'Готовлю раздел исходящих ссылок…' };
  }
  if (/multi-login|Continue|несколько устройств/i.test(msg)) {
    return { level: 'warn', message: 'Semrush: подтверждение входа с другого устройства' };
  }
  if (/лимит|Forbidden|free limit|is_limited|subscription|подписк/i.test(msg)) {
    return {
      level: 'warn',
      message: 'Подписка Semrush закончилась или недоступна',
    };
  }
  // Skip raw technical dumps
  if (/HTTP\s|webapi2|rawCount|is_limited=|playwright|storage\.json/i.test(msg)) {
    return null;
  }
  return null;
}

/**
 * Free-check: WHOIS is the source of truth (no RDAP).
 * DNS alone must NOT mark a domain occupied — expired drops often keep parking DNS.
 */
async function inspectAvailability(domain) {
  const dnsProbe = await probeDns(domain);
  const dnsLive = dnsProbe.live === true || dnsProbe.delegated === true;
  const whois = await checkWhoisAvailability(domain);

  let availability = whois.availability;
  let registered = null;
  if (availability === 'registered') registered = true;
  else if (availability === 'available') registered = false;

  if (availability === 'available') {
    return {
      dnsLive,
      availability: 'available',
      registered: false,
      created: whois.created || null,
    };
  }

  if (availability === 'registered') {
    return {
      dnsLive,
      availability: 'registered',
      registered: true,
      created: whois.created || null,
    };
  }

  // WHOIS unknown/timeout: only then trust DNS as "занят"
  if (dnsLive) {
    return {
      dnsLive: true,
      availability: 'registered',
      registered: true,
      created: null,
    };
  }

  return {
    dnsLive: false,
    availability: 'unknown',
    registered: null,
    created: null,
  };
}

async function runPipeline(options, hooks = {}) {
  abortRequested = false;
  const {
    query,
    searchProvider = 'serper',
    serperKey,
    yandexApiKey = '',
    yandexFolderId = '',
    yandexRegionId = DEFAULT_YANDEX_REGION_ID,
    semrushEmail,
    semrushPassword,
    userDataPath,
    maxOutlinksPerSource = 40,
    delayMs = 1200,
  } = options;

  const emit = (level, message) => hooks.onLog?.({ level, message });
  const onProgress = (payload) => hooks.onProgress?.(payload);

  const good = [];
  const bad = [];
  const seen = new Set();

  const provider = String(searchProvider || 'serper').toLowerCase() === 'yandex' ? 'yandex' : 'serper';

  if (provider === 'yandex') {
    emit('info', `Ищу топ-5 сайтов в Яндексе по запросу «${query}»…`);
  } else {
    emit('info', `Ищу топ-5 сайтов в Google по запросу «${query}»…`);
  }

  const search = await searchTopSources({
    searchProvider: provider,
    query,
    num: 5,
    serperKey,
    yandexApiKey,
    yandexFolderId,
    yandexRegionId,
  });
  const organic = search.organic || [];
  assertNotAborted();

  if (provider === 'yandex' && search.regionName) {
    emit('info', `Регион Яндекса: ${search.regionName} (${search.regionId})`);
  }

  if (!organic.length) {
    emit(
      'warn',
      provider === 'yandex'
        ? 'Поиск Яндекса не вернул сайтов. Попробуйте другой запрос или регион.'
        : 'Поиск Google не вернул сайтов. Попробуйте другой запрос.'
    );
    return { ok: true, organic: [], good, bad, message: 'Нет результатов поиска' };
  }

  const sources = organic
    .map((item) => ({
      ...item,
      domain: extractDomainFromUrl(item.link),
    }))
    .filter((item) => item.domain);

  emit('success', `Нашёл источники: ${sources.map((s) => s.domain).join(', ')}`);

  emit('info', 'Открываю Semrush…');
  let session;
  try {
    session = await openLiveSession({
      email: semrushEmail,
      password: semrushPassword,
      userDataPath,
      onLog: (payload) => {
        const soft = softenSemrushLog(payload);
        if (soft) emit(soft.level, soft.message);
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit('error', msg);
    emit('warn', 'Поиск завершён с ошибкой — Semrush недоступен.');
    return {
      ok: false,
      error: msg,
      organic: sources,
      good,
      bad,
      aborted: false,
    };
  }

  try {
    let sourceIndex = 0;
    for (const source of sources) {
      assertNotAborted();
      sourceIndex += 1;
      onProgress({
        phase: 'outlinks',
        percent: Math.round(((sourceIndex - 1) / sources.length) * 40),
        current: source.domain,
        sourceIndex,
        sourceTotal: sources.length,
        message: `Ссылки с сайта ${source.domain}`,
      });
      emit('info', `Смотрю исходящие ссылки с ${source.domain}…`);

      let out;
      try {
        out = await session.getOutgoingDomains(source.domain);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const code = err?.code || '';
        if (
          code === 'SEMRUSH_FREE_LIMIT' ||
          code === 'SEMRUSH_ACCOUNT_BLOCK' ||
          code === 'SEMRUSH_FORBIDDEN' ||
          code === 'SEMRUSH_LOGIN_REQUIRED' ||
          code === 'SEMRUSH_SANCTIONS' ||
          /Лимит Semrush Free|Forbidden|multi-login|требует повторный логин|subscription|подписк|санкц|Access no longer available/i.test(
            msg
          )
        ) {
          emit(
            'warn',
            code === 'SEMRUSH_SANCTIONS' || /санкц|Access no longer available/i.test(msg)
              ? msg
              : 'Подписка Semrush закончилась или недоступна. Сбор ссылок остановлен — продлите подписку и попробуйте снова.'
          );
          break;
        }
        emit('warn', `${source.domain}: не удалось получить ссылки`);
        await sleep(delayMs);
        continue;
      }

      const rawEntries = (
        out.entries?.length
          ? out.entries
          : (out.domains || []).map((domain) => ({ domain, as: null, dr: null }))
      ).filter((e) => e?.domain);
      const limited = rawEntries.slice(0, maxOutlinksPerSource);
      const truncated = Math.max(0, rawEntries.length - limited.length);

      const fresh = [];
      let skippedDup = 0;
      for (const entry of limited) {
        if (seen.has(entry.domain)) {
          skippedDup += 1;
          continue;
        }
        seen.add(entry.domain);
        fresh.push(entry);
      }

      if (!rawEntries.length) {
        const reason = out.note ? ` — ${out.note}` : '';
        emit('warn', `${source.domain}: исходящих доменов не найдено${reason}`);
        if (
          out.source === 'none' &&
          /лимит|подписк|не получен ответ Outbound API/i.test(String(out.note || ''))
        ) {
          emit(
            'warn',
            'Похоже, Semrush не отдаёт Outbound Domains (лимит Free или нет доступа к отчёту). Проверьте подписку в браузере на странице Outbound Domains.'
          );
        }
      } else {
        const parts = [`Semrush: ${rawEntries.length}`];
        if (truncated) parts.push(`лимит ${maxOutlinksPerSource}, отброшено ${truncated}`);
        if (skippedDup) parts.push(`уже встречались: ${skippedDup}`);
        parts.push(`к проверке: ${fresh.length}`);
        emit(
          fresh.length ? 'success' : 'info',
          `${source.domain}: ${parts.join(' · ')}`
        );
      }

      let candIndex = 0;
      for (const candidate of fresh) {
        assertNotAborted();
        candIndex += 1;
        const domain = candidate.domain;
        const semrushAs =
          candidate.as != null && Number.isFinite(Number(candidate.as)) ? Number(candidate.as) : null;

        const basePercent = 40 + Math.round(((sourceIndex - 1) / sources.length) * 60);
        const inner = Math.round((candIndex / Math.max(fresh.length, 1)) * (60 / sources.length));
        onProgress({
          phase: 'check',
          percent: Math.min(99, basePercent + inner),
          current: domain,
          sourceIndex,
          sourceTotal: sources.length,
          message: `Проверяю ${domain}`,
        });

        const avail = await inspectAvailability(domain);
        const { bucket, reason } = classifyAvailability(avail);

        if (bucket === 'bad') {
          bad.push({
            domain,
            sourceDomain: source.domain,
            sourceUrl: source.link,
            registered: avail.registered,
            created: avail.created,
            ageYears: null,
            iks: null,
            dr: null,
            as: semrushAs,
            hasSnapshots2y: false,
            waybackOldest: null,
            reason,
            checkTrust: null,
            checkedAt: new Date().toISOString(),
          });
          emit('warn', `${domain} — ${reason}`);
          await sleep(Math.max(80, Math.floor(delayMs / 8)));
          continue;
        }

        emit('success', `${domain} — свободен${semrushAs != null ? ` · AS ${semrushAs}` : ''}`);
        good.push({
          domain,
          sourceDomain: source.domain,
          sourceUrl: source.link,
          registered: false,
          created: avail.created,
          ageYears: null,
          iks: null,
          dr: null,
          as: semrushAs,
          hasSnapshots2y: false,
          waybackOldest: null,
          reason: 'свободен',
          checkTrust: null,
          checkedAt: new Date().toISOString(),
        });

        await sleep(Math.max(80, Math.floor(delayMs / 8)));
      }

      await sleep(Math.max(200, Math.floor(delayMs / 2)));
    }
  } finally {
    await session.close();
  }

  onProgress({
    phase: 'done',
    percent: 100,
    current: '',
    sourceIndex: sources.length,
    sourceTotal: sources.length,
    message: 'Готово',
  });

  if (!good.length && !bad.length) {
    emit('warn', 'Кандидатов не нашлось. Попробуйте другой поисковый запрос.');
  } else if (!good.length) {
    emit(
      'info',
      `Готово: свободных доменов нет (проверено занятых: ${bad.length}). Это нормально — попробуйте другой запрос.`
    );
  } else {
    emit(
      'success',
      `Готово: свободных ${good.length}, занятых ${bad.length}. Метрики загружайте кнопкой по выбранному домену.`
    );
  }

  return {
    ok: true,
    organic: sources,
    good,
    bad,
    aborted: false,
  };
}

module.exports = { runPipeline, abortPipeline, classifyAvailability };
