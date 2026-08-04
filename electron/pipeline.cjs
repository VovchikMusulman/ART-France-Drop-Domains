const { searchTopSources } = require('./search.cjs');
const { openLiveSession } = require('./semrush.cjs');
const { lookupDomain } = require('./rdap.cjs');
const { checkWhoisAvailability } = require('./whois.cjs');
const { fetchCheckTrust } = require('./checktrust.cjs');
const { fetchDomainRating } = require('./ahrefs.cjs');
const { extractDomainFromUrl, sleep } = require('./utils.cjs');
const { DEFAULT_YANDEX_REGION_ID } = require('./yandex-regions.cjs');

let abortRequested = false;

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

/** User-facing reasons only — no technical DNS/RDAP jargon */
function classifyAvailability({ dnsLive, availability, registered }) {
  if (dnsLive === true || availability === 'registered' || registered === true) {
    return { bucket: 'bad', reason: 'домен занят' };
  }
  if (availability !== 'available') {
    return { bucket: 'bad', reason: 'не удалось проверить свободу' };
  }
  return { bucket: 'good', reason: 'свободен' };
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

async function inspectAvailability(domain) {
  const dnsAndRdap = await lookupDomain(domain);
  await sleep(120);
  const whois = await checkWhoisAvailability(domain);

  let availability = whois.availability;
  let registered = null;

  if (availability === 'registered') {
    registered = true;
  } else if (dnsAndRdap.registered === true) {
    registered = true;
    availability = 'registered';
  } else if (availability === 'available') {
    registered = false;
  } else {
    registered = dnsAndRdap.registered === true ? true : null;
  }

  return {
    dnsLive: dnsAndRdap.dnsLive === true,
    availability,
    registered,
    created: whois.created || dnsAndRdap.created || null,
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
    checkTrustKey = '',
    ahrefsApiKey = '',
    minAgeYears = 2,
    minIks = 100,
    minDr: _minDr = 20,
    minAs: _minAs = 20,
    maxOutlinksPerSource = 40,
    delayMs = 1200,
  } = options;

  const emit = (level, message) => hooks.onLog?.({ level, message });
  const onProgress = (payload) => hooks.onProgress?.(payload);

  const good = [];
  const bad = [];
  const seen = new Set();
  let ctLimitsHit = false;

  if (!String(checkTrustKey || '').trim()) {
    emit('warn', 'Нет ключа CheckTrust — показатели ИКС и возраста не загрузятся');
  }
  if (provider === 'serper' && !String(ahrefsApiKey || '').trim()) {
    emit('warn', 'Нет ключа Ahrefs — Domain Rating (DR) не загрузится');
  }

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
        const count = out.domains?.length || 0;
        if (count) {
          emit('success', `${source.domain}: нашёл ${count} доменов для проверки`);
        } else {
          const reason = out.note ? ` — ${out.note}` : '';
          emit('warn', `${source.domain}: исходящих доменов не найдено${reason}`);
          // If Semrush consistently fails to return the API payload, stop burning queries
          if (
            out.source === 'none' &&
            /лимит|подписк|не получен ответ Outbound API/i.test(String(out.note || ''))
          ) {
            emit(
              'warn',
              'Похоже, Semrush не отдаёт Outbound Domains (лимит Free или нет доступа к отчёту). Проверьте подписку в браузере на странице Outbound Domains.'
            );
          }
        }
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

      const candidates = (
        out.entries?.length
          ? out.entries
          : (out.domains || []).map((domain) => ({ domain, as: null, dr: null }))
      ).slice(0, maxOutlinksPerSource);
      let candIndex = 0;
      for (const candidate of candidates) {
        assertNotAborted();
        candIndex += 1;
        const domain = candidate.domain;
        if (!domain || seen.has(domain)) continue;
        seen.add(domain);
        const semrushAs =
          candidate.as != null && Number.isFinite(Number(candidate.as)) ? Number(candidate.as) : null;

        const basePercent = 40 + Math.round(((sourceIndex - 1) / sources.length) * 60);
        const inner = Math.round((candIndex / Math.max(candidates.length, 1)) * (60 / sources.length));
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
          await sleep(Math.max(350, Math.floor(delayMs / 3)));
          continue;
        }

        let ct = null;
        let ageYears = null;
        let iks = null;
        let ahrefsDr = null;
        let ctReason = 'свободен';

        if (String(checkTrustKey || '').trim() && !ctLimitsHit) {
          emit('info', `${domain} — свободен, загружаю ИКС и возраст…`);
          ct = await fetchCheckTrust(domain, checkTrustKey, {
            maxAttempts: 24,
            delayMs: 5000,
          });
          if (ct.ok) {
            ageYears = ct.ageYears;
            iks = ct.sqi;
            ctReason = 'свободен';
          } else if (ct.code === 'CT_LIMITS') {
            ctLimitsHit = true;
            ctReason = 'свободен';
            emit(
              'warn',
              'На CheckTrust не хватает средств. ИКС и возраст не загрузятся — проверьте домены позже во вкладке CheckTrust.'
            );
          } else if (ct.code === 'CT_IN_PROCESS') {
            ctReason = 'свободен';
            emit(
              'warn',
              `${domain} — CheckTrust ещё обрабатывает домен, метрики появятся позже (вкладка CheckTrust)`
            );
          } else {
            ctReason = 'свободен (метрики не загрузились)';
            emit('warn', `${domain} — свободен, но показатели CheckTrust не загрузились`);
          }
          await sleep(250);
        }

        if (String(ahrefsApiKey || '').trim()) {
          emit('info', `${domain} — загружаю DR (Ahrefs)…`);
          const ah = await fetchDomainRating(domain, ahrefsApiKey);
          if (ah.ok) {
            ahrefsDr = ah.dr;
          } else if (ah.code === 'AHREFS_AUTH') {
            emit('warn', 'Ahrefs: неверный API key или нужна авторизация для Domain Rating');
          } else if (ah.code === 'AHREFS_RATE') {
            emit('warn', 'Ahrefs: слишком много запросов DR, подождите и повторите');
          } else {
            emit('warn', `${domain} — DR не загрузился`);
          }
          await sleep(200);
        }

        if (ct?.ok) {
          emit(
            'success',
            `${domain} — свободен · ИКС ${iks ?? '—'} · возраст ${ageYears ?? '—'} · DR ${ahrefsDr ?? '—'} · AS ${semrushAs ?? '—'}`
          );
        } else if (ctLimitsHit) {
          emit('success', `${domain} — свободен · DR ${ahrefsDr ?? '—'} · AS ${semrushAs ?? '—'} (CheckTrust: нет средств)`);
        } else if (!String(checkTrustKey || '').trim()) {
          emit('success', `${domain} — свободен · DR ${ahrefsDr ?? '—'} · AS ${semrushAs ?? '—'}`);
        } else {
          emit('success', `${domain} — свободен · DR ${ahrefsDr ?? '—'} · AS ${semrushAs ?? '—'}`);
        }

        good.push({
          domain,
          sourceDomain: source.domain,
          sourceUrl: source.link,
          registered: false,
          created: avail.created,
          ageYears,
          iks,
          dr: ahrefsDr,
          as: semrushAs,
          hasSnapshots2y: ageYears != null ? ageYears >= minAgeYears : false,
          waybackOldest: ct?.webarchiveFirst ? String(ct.webarchiveFirst) : null,
          reason: ctReason,
          checkTrust: ct?.ok
            ? {
                sqi: ct.sqi,
                ageYears: ct.ageYears,
                webarchiveDays: ct.webarchiveDays,
                webarchiveFirst: ct.webarchiveFirst,
                metrics: ct.metrics,
              }
            : ct
              ? { error: ct.error, code: ct.code || undefined }
              : ctLimitsHit
                ? {
                    error:
                      'На CheckTrust не хватает средств. Пополните баланс и проверьте домен во вкладке CheckTrust.',
                    code: 'CT_LIMITS',
                  }
                : null,
          checkedAt: new Date().toISOString(),
        });

        await sleep(Math.max(400, Math.floor(delayMs / 3)));
      }

      await sleep(delayMs);
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
    emit('success', `Готово: свободных ${good.length}, занятых ${bad.length}`);
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
