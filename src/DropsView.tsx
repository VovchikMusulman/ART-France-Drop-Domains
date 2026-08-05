import { useEffect, useMemo, useRef, type Dispatch, type MouseEvent, type SetStateAction } from 'react';
import type { AppSettings, DomainRow, JobLog, JobProgress } from './vite-env';
import type { DropsSession } from './App';

const CT_LABELS: Record<string, string> = {
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

type Props = {
  settings: AppSettings;
  scheduleSave: (partial: Partial<AppSettings>) => void;
  session: DropsSession;
  setSession: Dispatch<SetStateAction<DropsSession>>;
  onGoShots?: (domainsText: string) => void;
  onOpenSettings?: () => void;
  onOpenCheckTrust?: (domain?: string) => void;
};

function formatValue(value: unknown) {
  if (value == null || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function DropsView({
  settings,
  scheduleSave,
  session,
  setSession,
  onGoShots,
  onOpenSettings,
  onOpenCheckTrust,
}: Props) {
  const logRef = useRef<HTMLDivElement | null>(null);
  const stickBottom = useRef(true);

  const {
    query,
    good,
    bad,
    sources,
    logs,
    progress,
    status,
    logHeight,
    selectedDomain,
    resultsTab: tab,
    metricsLoadingDomain,
    jobRunning: running,
  } = session;
  const isGoogle = settings.searchProvider !== 'yandex';
  const minAge = settings.minAgeYears || 2;
  const minIks = settings.minIks ?? 100;
  const minDr = settings.minDr ?? 20;
  const minAs = settings.minAs ?? 20;

  const selected = useMemo(() => {
    if (!selectedDomain) return null;
    return good.find((r) => r.domain === selectedDomain) || null;
  }, [good, selectedDomain]);

  const goodEmptyText = running
    ? 'Ищем дропы'
    : good.length === 0 && (bad.length > 0 || /Готово|Остановлено|Ошибка|свободных/i.test(status))
      ? 'Пусто — попробуйте другой поисковый запрос'
      : 'Пока пусто — запустите поиск';

  function openUrl(raw: string) {
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    void window.artfrance?.openExternal(href);
  }

  function setTab(next: 'good' | 'bad' | 'sources') {
    setSession((p) => ({ ...p, resultsTab: next }));
  }

  function selectDomain(row: DomainRow | null) {
    setSession((p) => ({ ...p, selectedDomain: row?.domain || null }));
  }

  useEffect(() => {
    if (!window.artfrance) return;
    const offProgress = window.artfrance.onProgress((payload: JobProgress) => {
      setSession((prev) => ({ ...prev, progress: payload }));
    });
    const offLog = window.artfrance.onLog((payload: JobLog) => {
      setSession((prev) => ({ ...prev, logs: [...prev.logs.slice(-400), payload] }));
    });
    return () => {
      offProgress();
      offLog();
    };
  }, [setSession]);

  useEffect(() => {
    const el = logRef.current;
    if (!el || !stickBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [logs]);

  const detailRows = useMemo(() => {
    const metrics = selected?.checkTrust?.metrics;
    if (!metrics) return [];
    const rows: Array<{ key: string; label: string; value: unknown }> = [];
    for (const [key, label] of Object.entries(CT_LABELS)) {
      if (!(key in metrics)) continue;
      rows.push({ key, label, value: metrics[key] });
    }
    for (const [key, value] of Object.entries(metrics)) {
      if (CT_LABELS[key]) continue;
      rows.push({ key, label: key, value });
    }
    return rows;
  }, [selected]);

  function onLogScroll() {
    const el = logRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickBottom.current = dist < 48;
  }

  function startLogResize(e: MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = logHeight;
    function onMove(ev: globalThis.MouseEvent) {
      const next = Math.min(420, Math.max(120, startH + (ev.clientY - startY)));
      setSession((p) => ({ ...p, logHeight: next }));
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function ageClass(age: number | null | undefined) {
    if (age == null) return 'metric-na';
    return age >= minAge ? 'metric-ok' : 'metric-bad';
  }

  function iksClass(iks: number | null | undefined) {
    if (iks == null) return 'metric-na';
    return iks >= minIks ? 'metric-ok' : 'metric-bad';
  }

  function drClass(dr: number | null | undefined) {
    if (dr == null) return 'metric-na';
    return dr >= minDr ? 'metric-ok' : 'metric-bad';
  }

  function asClass(as: number | null | undefined) {
    if (as == null) return 'metric-na';
    return as >= minAs ? 'metric-ok' : 'metric-bad';
  }

  async function handleStart() {
    if (!window.artfrance) return;
    const q = query.trim();
    if (!q) return setSession((p) => ({ ...p, status: 'Введите поисковый запрос' }));
    if (!settings.hasSemrushSession && (!settings.semrushEmail.trim() || !settings.semrushPassword)) {
      return setSession((p) => ({ ...p, status: 'Подключите Semrush в Настройках' }));
    }

    const provider = settings.searchProvider === 'yandex' ? 'yandex' : 'serper';
    if (provider === 'serper' && !settings.serperKey.trim()) {
      return setSession((p) => ({ ...p, status: 'Нет Serper key — откройте Настройки' }));
    }
    if (provider === 'yandex') {
      if (!settings.yandexApiKey?.trim()) {
        return setSession((p) => ({ ...p, status: 'Нет Yandex API key — откройте Настройки' }));
      }
      if (!settings.yandexFolderId?.trim()) {
        return setSession((p) => ({ ...p, status: 'Нет Yandex Folder ID — откройте Настройки' }));
      }
    }

    stickBottom.current = true;
    setSession((p) => ({
      ...p,
      jobRunning: true,
      selectedDomain: null,
      resultsTab: 'good',
      logs: [],
      good: [],
      bad: [],
      sources: [],
      status: 'Поиск запущен…',
      progress: {
        phase: 'outlinks',
        percent: 0,
        current: '',
        sourceIndex: 0,
        sourceTotal: 0,
        message: 'Старт…',
      },
    }));

    const result = await window.artfrance.startJob({
      query: q,
      searchProvider: provider,
      serperKey: settings.serperKey,
      yandexApiKey: settings.yandexApiKey,
      yandexFolderId: settings.yandexFolderId,
      yandexRegionId: settings.yandexRegionId,
      semrushEmail: settings.semrushEmail,
      semrushPassword: settings.semrushPassword,
      checkTrustKey: settings.checkTrustKey,
      ahrefsApiKey: settings.ahrefsApiKey,
      minAgeYears: settings.minAgeYears,
      minIks: settings.minIks,
      minDr: settings.minDr,
      minAs: settings.minAs,
      maxOutlinksPerSource: settings.maxOutlinksPerSource,
    });

    const failed = Boolean(result && !result.ok && !result.aborted);
    const finishedMsg = result?.aborted
      ? 'Остановлено'
      : failed
        ? 'Поиск завершён с ошибкой — детали в логе'
        : `Готово: good ${result.good?.length || 0}, bad ${result.bad?.length || 0}. Метрики — по кнопке у домена.`;

    setSession((p) => {
      const nextLogs = [...(p.logs || [])];
      if (failed && result.error) {
        const already = nextLogs.some((l) => l.message === result.error);
        if (!already) {
          nextLogs.push({ level: 'error', message: result.error });
          nextLogs.push({ level: 'warn', message: 'Поиск завершён с ошибкой.' });
        }
      }
      return {
        ...p,
        jobRunning: false,
        resultsTab: 'good',
        good: result.good || [],
        bad: result.bad || [],
        sources: result.organic || p.sources || [],
        logs: nextLogs,
        status: finishedMsg,
        progress: {
          phase: 'done',
          percent: failed || result?.aborted ? p.progress?.percent || 0 : 100,
          current: '',
          sourceIndex: 0,
          sourceTotal: 0,
          message: finishedMsg,
        },
      };
    });
  }

  async function handleFetchMetrics(domain: string) {
    if (!window.artfrance || !domain) return;
    if (!settings.checkTrustKey?.trim() && !settings.ahrefsApiKey?.trim()) {
      setSession((p) => ({
        ...p,
        status: 'Нет ключей CheckTrust / Ahrefs — откройте Настройки',
      }));
      return;
    }
    if (metricsLoadingDomain) return;

    setSession((p) => ({
      ...p,
      metricsLoadingDomain: domain,
      selectedDomain: domain,
      status: `Загружаю метрики для ${domain}…`,
    }));

    const applyPartial = (patch: {
      ageYears?: number | null;
      iks?: number | null;
      dr?: number | null;
      waybackOldest?: string | null;
      hasSnapshots2y?: boolean;
      checkTrust?: DomainRow['checkTrust'];
      reason?: string;
      status?: string;
    }) => {
      setSession((p) => {
        const goodNext = p.good.map((row) => {
          if (row.domain !== domain) return row;
          return {
            ...row,
            ageYears: patch.ageYears !== undefined ? patch.ageYears : row.ageYears,
            iks: patch.iks !== undefined ? patch.iks : row.iks,
            dr: patch.dr !== undefined ? patch.dr : row.dr,
            waybackOldest:
              patch.waybackOldest !== undefined ? patch.waybackOldest : row.waybackOldest,
            hasSnapshots2y:
              patch.hasSnapshots2y !== undefined ? patch.hasSnapshots2y : row.hasSnapshots2y,
            checkTrust: patch.checkTrust !== undefined ? patch.checkTrust : row.checkTrust,
            reason: patch.reason !== undefined ? patch.reason : row.reason,
          };
        });
        return {
          ...p,
          good: goodNext,
          selectedDomain: p.selectedDomain || domain,
          status: patch.status ?? p.status,
        };
      });
    };

    try {
      // Ahrefs DR quickly (if key), then long CheckTrust poll with live status
      if (settings.ahrefsApiKey?.trim()) {
        const quick = await window.artfrance.fetchDomainMetrics({
          host: domain,
          checkTrustKey: '',
          ahrefsApiKey: settings.ahrefsApiKey,
          maxAttempts: 1,
        });
        if (quick.dr != null) {
          applyPartial({
            dr: quick.dr,
            status: `DR загружен · жду CheckTrust для ${domain}…`,
          });
        }
      }

      if (settings.checkTrustKey?.trim()) {
        const POLL_ATTEMPTS = 96; // ~8 мин, basic metrics
        const POLL_DELAY_MS = 5000;
        let lastError = '';
        let lastCode = '';
        let gotCt = false;

        for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
          setSession((p) => ({
            ...p,
            status:
              attempt === 1
                ? `CheckTrust: запрос по ${domain}…`
                : `CheckTrust считает метрики ${domain}… ${attempt}/${POLL_ATTEMPTS}`,
          }));

          const res = await window.artfrance.lookupCheckTrust({
            host: domain,
            applicationKey: settings.checkTrustKey,
            maxAttempts: 1,
          });

          if (res?.ok) {
            gotCt = true;
            applyPartial({
              ageYears: res.ageYears ?? null,
              iks: res.sqi ?? null,
              waybackOldest: null,
              hasSnapshots2y:
                res.ageYears != null ? res.ageYears >= (settings.minAgeYears || 2) : false,
              checkTrust: {
                sqi: res.sqi,
                ageYears: res.ageYears,
                webarchiveDays: res.webarchiveDays,
                metrics: res.metrics || null,
              },
              reason: 'свободен · метрики загружены',
              status: `Метрики готовы: ${domain}`,
            });
            break;
          }

          lastCode = res?.code || '';
          lastError = res?.error || 'CheckTrust не ответил';

          if (res?.code !== 'CT_IN_PROCESS') {
            applyPartial({
              checkTrust: { error: lastError, code: lastCode || undefined },
              status: `Метрики ${domain}: ${lastError}`,
            });
            break;
          }

          if (attempt < POLL_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, POLL_DELAY_MS));
          }
        }

        if (!gotCt && lastCode === 'CT_IN_PROCESS') {
          applyPartial({
            checkTrust: {
              error:
                'CheckTrust ещё считает метрики. Подождите и нажмите «Обновить метрики» ещё раз — анализ уже запущен.',
              code: 'CT_IN_PROCESS',
            },
            status: `CheckTrust ещё считает ${domain} — нажмите «Обновить метрики» через минуту`,
          });
        }
      }
    } finally {
      setSession((p) => ({
        ...p,
        metricsLoadingDomain: p.metricsLoadingDomain === domain ? null : p.metricsLoadingDomain,
      }));
    }
  }

  async function handleExport(kind: 'good' | 'bad') {
    const rows = kind === 'good' ? good : bad;
    const result = await window.artfrance?.exportCsv({ kind, rows });
    if (!result || result.canceled) return;
    if (!result.ok) {
      setSession((p) => ({ ...p, status: result.error || 'Не удалось сохранить CSV' }));
      return;
    }
    setSession((p) => ({ ...p, status: `CSV сохранён: ${result.path}` }));
  }

  return (
    <div className="layout">
      <aside className="panel side-panel">
        <h2>Поиск дропов</h2>

        {!settings.hasSemrushSession ? (
          <div className="status-pill err">Semrush: нет сессии</div>
        ) : null}
        {!settings.checkTrustKey?.trim() ? (
          <div className="status-pill">CheckTrust: нет ключа (метрики вручную)</div>
        ) : null}
        {isGoogle && !settings.ahrefsApiKey?.trim() ? (
          <div className="status-pill">Ahrefs DR: нет ключа (метрики вручную)</div>
        ) : null}
        {settings.searchProvider === 'yandex' && !settings.yandexApiKey?.trim() ? (
          <div className="status-pill err">Yandex: нет API key</div>
        ) : null}
        {settings.searchProvider === 'yandex' && !settings.yandexFolderId?.trim() ? (
          <div className="status-pill err">Yandex: нет Folder ID</div>
        ) : null}
        {settings.searchProvider !== 'yandex' && !settings.serperKey?.trim() ? (
          <div className="status-pill err">Serper: нет ключа</div>
        ) : null}

        {!settings.hasSemrushSession ? (
          <div className="muted">
            Сначала откройте{' '}
            <button type="button" className="linkish" onClick={onOpenSettings}>
              Настройки
            </button>{' '}
            и подключите Semrush / CheckTrust.
          </div>
        ) : (
          <div className="threshold-card">
            {isGoogle ? (
              <>
                <div className="threshold-item">
                  <span>DR</span>
                  <strong>≥ {minDr}</strong>
                </div>
                <div className="threshold-item">
                  <span>AS</span>
                  <strong>≥ {minAs}</strong>
                </div>
                <div className="threshold-note">
                  Режим Google: подсветка DR / AS. Все свободные — в Good.
                </div>
              </>
            ) : (
              <>
                <div className="threshold-item">
                  <span>Возраст</span>
                  <strong>≥ {minAge} лет</strong>
                </div>
                <div className="threshold-item">
                  <span>ИКС</span>
                  <strong>≥ {minIks}</strong>
                </div>
                <div className="threshold-note">
                  Режим Яндекс: подсветка возраста / ИКС. Все свободные — в Good.
                </div>
              </>
            )}
          </div>
        )}

        <div className="field">
          <label>Поисковый запрос</label>
          <textarea
            className="query-box"
            rows={4}
            value={query}
            onChange={(e) => {
              const value = e.target.value;
              setSession((p) => ({ ...p, query: value }));
              scheduleSave({ lastQuery: value });
            }}
            placeholder="например: курсы дизайна логотипа"
          />
        </div>

        <div className="actions">
          <button type="button" className="btn-primary" disabled={running} onClick={handleStart}>
            {running ? 'Идёт поиск…' : 'Найти дропы'}
          </button>
          {running ? (
            <button type="button" className="btn-danger" onClick={() => window.artfrance?.stopJob()}>
              Стоп
            </button>
          ) : null}
          {!running && good.length > 0 ? (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                onGoShots?.(good.map((g) => g.domain).join('\n'));
                setSession((p) => ({ ...p, status: 'Good-домены открыты во вкладке Скриншоты' }));
              }}
            >
              Good → скриншоты
            </button>
          ) : null}
        </div>

        {running ? (
          <>
            <div className="progress">
              <span style={{ width: `${progress?.percent || 0}%` }} />
            </div>
            <div className="muted">{progress?.message || status}</div>
          </>
        ) : status ? (
          <div
            className={`status-pill ${
              /ошибк|Остановлено|Нет |Подключите/i.test(status) ? 'err' : status.startsWith('Готово') ? 'on' : ''
            }`}
          >
            {status}
          </div>
        ) : null}
      </aside>

      <section className="main-col">
        <div className="panel results-toolbar">
          <div className="tabs">
            <button type="button" className={`tab ${tab === 'good' ? 'active' : ''}`} onClick={() => setTab('good')}>
              Good ({good.length})
            </button>
            <button type="button" className={`tab ${tab === 'bad' ? 'active' : ''}`} onClick={() => setTab('bad')}>
              Bad ({bad.length})
            </button>
            <button
              type="button"
              className={`tab ${tab === 'sources' ? 'active' : ''}`}
              onClick={() => setTab('sources')}
            >
              Топ-5 ({sources.length})
            </button>
          </div>
          <div className="actions">
            {good.length > 0 ? (
              <button type="button" className="btn-ghost" onClick={() => handleExport('good')}>
                CSV good
              </button>
            ) : null}
            {bad.length > 0 ? (
              <button type="button" className="btn-ghost" onClick={() => handleExport('bad')}>
                CSV bad
              </button>
            ) : null}
          </div>
        </div>

        <div className="panel results-table-panel">
          <div className="table-wrap">
            {tab === 'sources' ? (
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Домен</th>
                    <th>URL</th>
                    <th>Title</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((s, i) => (
                    <tr key={`${s.domain}-${i}`}>
                      <td>{s.position || i + 1}</td>
                      <td>{s.domain}</td>
                      <td>
                        {s.link ? (
                          <button
                            type="button"
                            className="linkish table-link"
                            title={s.link}
                            onClick={() => openUrl(s.link)}
                          >
                            {s.link}
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{s.title}</td>
                    </tr>
                  ))}
                  {!sources.length && (
                    <tr>
                      <td colSpan={4} className="muted">
                        {running ? 'Ищем дропы' : 'Пока пусто — запустите поиск'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : tab === 'good' ? (
              <table>
                <thead>
                  <tr>
                    <th>Домен</th>
                    {isGoogle ? (
                      <>
                        <th>DR</th>
                        <th>AS</th>
                      </>
                    ) : (
                      <>
                        <th>Возраст</th>
                        <th>ИКС</th>
                      </>
                    )}
                    <th>Источник</th>
                  </tr>
                </thead>
                <tbody>
                  {good.map((r) => (
                    <tr
                      key={`${r.domain}-${r.sourceDomain}-${r.checkedAt}`}
                      className={`row-clickable ${selected?.domain === r.domain ? 'row-selected' : ''}`}
                      onClick={() => selectDomain(r)}
                    >
                      <td>
                        {r.domain}
                        {metricsLoadingDomain === r.domain ? (
                          <span className="muted"> · метрики…</span>
                        ) : null}
                      </td>
                      {isGoogle ? (
                        <>
                          <td className={drClass(r.dr)}>{r.dr ?? '—'}</td>
                          <td className={asClass(r.as)}>{r.as ?? '—'}</td>
                        </>
                      ) : (
                        <>
                          <td className={ageClass(r.ageYears)}>{r.ageYears ?? '—'}</td>
                          <td className={iksClass(r.iks)}>{r.iks ?? '—'}</td>
                        </>
                      )}
                      <td>{r.sourceDomain}</td>
                    </tr>
                  ))}
                  {!good.length && (
                    <tr>
                      <td colSpan={4} className="muted">
                        {goodEmptyText}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Домен</th>
                    <th>Источник</th>
                    <th>Причина</th>
                  </tr>
                </thead>
                <tbody>
                  {bad.map((r) => (
                    <tr key={`${r.domain}-${r.sourceDomain}-${r.checkedAt}`}>
                      <td>{r.domain}</td>
                      <td>{r.sourceDomain}</td>
                      <td>{r.reason}</td>
                    </tr>
                  ))}
                  {!bad.length && (
                    <tr>
                      <td colSpan={3} className="muted">
                        Пока пусто
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="panel log-panel">
          <div className="log-head">
            <h2>Лог</h2>
            <span className="muted">тяните ползунок для изменения размера окна</span>
          </div>
          <div
            className="logs resizable-log"
            ref={logRef}
            onScroll={onLogScroll}
            style={{ height: logHeight }}
          >
            {logs.map((log, i) => (
              <div key={`${i}-${log.message}`} className={`log-${log.level}`}>
                {log.message}
              </div>
            ))}
          </div>
          <div className="log-resize-handle" title="Изменить высоту лога" onMouseDown={startLogResize} />
          <input
            className="log-height-range"
            type="range"
            min={120}
            max={420}
            value={logHeight}
            onChange={(e) => setSession((p) => ({ ...p, logHeight: Number(e.target.value) || 180 }))}
          />
        </div>
      </section>

      {selected && tab === 'good' ? (
        <aside className="panel detail-panel">
          <div className="log-head">
            <h2>{selected.domain}</h2>
            <button type="button" className="btn-ghost" onClick={() => selectDomain(null)}>
              Закрыть
            </button>
          </div>
          <div className="muted">
            Источник: {selected.sourceDomain}
            {selected.checkTrust?.code === 'CT_LIMITS' ||
            /не хватает средств|Limits expired/i.test(selected.checkTrust?.error || '')
              ? ''
              : selected.checkTrust?.error
                ? ` · ${selected.checkTrust.error}`
                : ''}
          </div>
          <div className="actions" style={{ marginBottom: 10 }}>
            <button
              type="button"
              className="btn-primary"
              disabled={Boolean(metricsLoadingDomain) || running}
              onClick={() => void handleFetchMetrics(selected.domain)}
            >
              {metricsLoadingDomain === selected.domain
                ? 'Загружаю метрики…'
                : selected.checkTrust?.metrics || selected.dr != null
                  ? 'Обновить метрики'
                  : 'Загрузить метрики'}
            </button>
          </div>
          <div className="detail-summary">
            {isGoogle ? (
              <>
                <span className={drClass(selected.dr)}>DR: {selected.dr ?? '—'}</span>
                <span className={asClass(selected.as)}>AS: {selected.as ?? '—'}</span>
              </>
            ) : (
              <>
                <span className={ageClass(selected.ageYears)}>Возраст: {selected.ageYears ?? '—'}</span>
                <span className={iksClass(selected.iks)}>ИКС: {selected.iks ?? '—'}</span>
              </>
            )}
          </div>
          <div className="detail-list">
            {detailRows.length === 0 ? (
              selected.checkTrust?.code === 'CT_LIMITS' ||
              /не хватает средств|Limits expired/i.test(selected.checkTrust?.error || '') ? (
                <div className="ct-limits-box">
                  <p>На CheckTrust не хватает средств.</p>
                  <p className="muted">Пополните баланс и проверьте домен вручную.</p>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => onOpenCheckTrust?.(selected.domain)}
                  >
                    Открыть CheckTrust
                  </button>
                </div>
              ) : selected.checkTrust?.error ? (
                <div className="muted">{selected.checkTrust.error}</div>
              ) : (
                <div className="muted">
                  Метрики ещё не загружены. Нажмите «Загрузить метрики», чтобы запросить CheckTrust
                  {isGoogle ? ' и Ahrefs DR' : ' (ИКС / возраст)'} только для этого домена.
                </div>
              )
            ) : (
              detailRows.map((row) => (
                <div key={row.key} className="detail-row">
                  <span>{row.label}</span>
                  <strong>{formatValue(row.value)}</strong>
                </div>
              ))
            )}
          </div>
        </aside>
      ) : null}
    </div>
  );
}
