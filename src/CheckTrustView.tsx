import { useMemo, type Dispatch, type SetStateAction } from 'react';
import type { AppSettings } from './vite-env';

/** Shared across remounts so tab switch doesn't spawn parallel polls */
let activeCheckRunId = 0;

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

/** Ждём CheckTrust до ~8 мин; метрики рисуем по мере поступления, опрос не рвём раньше времени */
const POLL_ATTEMPTS = 96;
const POLL_DELAY_MS = 5000;

export type CheckTrustResult = {
  host?: string;
  sqi?: number | null;
  ageYears?: number | null;
  metrics?: Record<string, unknown> | null;
  note?: string;
  pending?: boolean;
  /** checktrust | wayback */
  source?: string;
};

export type CheckTrustSession = {
  domain: string;
  loading: boolean;
  progress: string;
  /** Текущая попытка опроса 1…POLL_ATTEMPTS */
  progressAttempt: number;
  error: string;
  errorCode: string;
  result: CheckTrustResult | null;
};

export function emptyCheckTrustSession(): CheckTrustSession {
  return {
    domain: '',
    loading: false,
    progress: '',
    progressAttempt: 0,
    error: '',
    errorCode: '',
    result: null,
  };
}

type Props = {
  settings: AppSettings;
  session: CheckTrustSession;
  setSession: Dispatch<SetStateAction<CheckTrustSession>>;
  onOpenSettings?: () => void;
};

function formatValue(value: unknown) {
  if (value == null || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPlaceholderValue(key: string, value: unknown) {
  if (value == null || value === '') return true;
  if (value === -1 || value === '-1') return true;
  const s = String(value).trim();
  if (!s || s === 'n/a' || s === 'N/A' || s === '-') return true;
  if (/^0{4}-0{2}-0{2}/.test(s)) return true;
  return false;
}

function mergeResult(
  prev: CheckTrustResult | null,
  res: {
    host?: string;
    sqi?: number | null;
    ageYears?: number | null;
    metrics?: Record<string, unknown> | null;
    note?: string;
    code?: string;
    source?: string;
  },
  pending: boolean
): CheckTrustResult {
  const metrics = { ...(prev?.metrics || {}) };
  if (res.metrics && typeof res.metrics === 'object') {
    for (const [key, value] of Object.entries(res.metrics)) {
      if (isPlaceholderValue(key, value)) continue;
      // дни=0 без даты — заглушка
      if (
        (key === 'webarchiveDays' || key === 'webarchive_days') &&
        (value === 0 || value === '0') &&
        !metrics.webarchive
      ) {
        continue;
      }
      metrics[key] = value;
    }
  }

  let ageYears = res.ageYears ?? prev?.ageYears ?? null;
  if (ageYears === 0) {
    const days = Number(metrics.webarchiveDays);
    const hasRealWa =
      (Number.isFinite(days) && days > 0) || Boolean(metrics.webarchive);
    if (!hasRealWa) ageYears = null;
  }

  const source =
    res.source ||
    (res.code === 'OK_WAYBACK' ? 'wayback' : undefined) ||
    prev?.source ||
    (pending ? undefined : 'checktrust');

  return {
    host: res.host || prev?.host,
    sqi: res.sqi ?? prev?.sqi ?? null,
    ageYears,
    metrics: Object.keys(metrics).length ? metrics : null,
    // Не тащим «страшные» пояснения из Wayback — это нормальный результат
    note: res.code === 'OK_WAYBACK' ? undefined : res.note || prev?.note,
    pending,
    source,
  };
}

function hasCore(result: CheckTrustResult | null) {
  return Boolean(result && result.sqi != null && result.ageYears != null);
}

export default function CheckTrustView({ settings, session, setSession, onOpenSettings }: Props) {
  const { domain, loading, progress, progressAttempt, error, errorCode, result } = session;
  const progressPct = loading
    ? Math.min(100, Math.round((Math.max(progressAttempt, 1) / POLL_ATTEMPTS) * 100))
    : 0;

  const detailRows = useMemo(() => {
    const metrics = result?.metrics;
    if (!metrics) return [];
    const rows: Array<{ key: string; label: string; value: unknown }> = [];
    for (const [key, label] of Object.entries(CT_LABELS)) {
      if (!(key in metrics)) continue;
      if (isPlaceholderValue(key, metrics[key])) continue;
      rows.push({ key, label, value: metrics[key] });
    }
    for (const [key, value] of Object.entries(metrics)) {
      if (CT_LABELS[key]) continue;
      if (key.startsWith('_')) continue;
      if (isPlaceholderValue(key, value)) continue;
      rows.push({ key, label: key, value });
    }
    return rows;
  }, [result]);

  function patch(partial: Partial<CheckTrustSession>) {
    setSession((prev) => ({ ...prev, ...partial }));
  }

  async function handleCheck() {
    const host = domain.trim();
    if (!host) {
      patch({ error: 'Введите домен', errorCode: '' });
      return;
    }
    if (!settings.checkTrustKey?.trim()) {
      patch({ error: 'Нет ключа CheckTrust — откройте Настройки', errorCode: 'NO_KEY' });
      return;
    }

    const runId = ++activeCheckRunId;
    patch({
      loading: true,
      error: '',
      errorCode: '',
      progress: 'Запрос к CheckTrust…',
      progressAttempt: 1,
      result: null,
    });

    try {
      let lastCode = '';
      let lastError = '';
      let acc: CheckTrustResult | null = null;

      for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
        if (runId !== activeCheckRunId) return;

        const waitingHint = acc
          ? `Уже есть: ${[
              acc.ageYears != null ? `возраст ${acc.ageYears}` : null,
              acc.sqi != null ? `ИКС ${acc.sqi}` : null,
            ]
              .filter(Boolean)
              .join(', ') || 'частичные данные'} · жду остальные… ${attempt}/${POLL_ATTEMPTS}`
          : attempt === 1
            ? 'Запрос к CheckTrust…'
            : `CheckTrust считает метрики… ${attempt}/${POLL_ATTEMPTS}`;

        patch({ progress: waitingHint, progressAttempt: attempt });

        const res = await window.artfrance?.lookupCheckTrust({
          host,
          applicationKey: settings.checkTrustKey,
          maxAttempts: 1,
        });

        if (runId !== activeCheckRunId) return;

        // Полный ответ CheckTrust
        if (res?.ok && !res.partial) {
          acc = mergeResult(acc, res, false);
          patch({
            result: acc,
            progress: '',
            progressAttempt: 0,
            loading: false,
          });
          return;
        }

        // Частичные метрики — показываем сразу и продолжаем ждать CT
        if (res?.code === 'CT_PARTIAL' || (res?.ok && res.partial)) {
          acc = mergeResult(acc, res, true);
          patch({
            result: acc,
            error: '',
            errorCode: '',
            progress: waitingHint,
            progressAttempt: attempt,
            loading: true,
          });
          if (hasCore(acc)) {
            patch({
              result: { ...acc, pending: false },
              progress: '',
              progressAttempt: 0,
              loading: false,
            });
            return;
          }
          if (attempt < POLL_ATTEMPTS) await sleep(POLL_DELAY_MS);
          continue;
        }

        lastCode = res?.code || '';
        lastError = res?.error || 'Не удалось проверить домен';

        // CT уже закончил с пустыми ИКС/возрастом — не ждём 8 мин и не жжём баланс
        if (res?.code === 'CT_DONE_EMPTY') {
          break;
        }

        if (res?.code !== 'CT_IN_PROCESS' && res?.code !== 'CT_EMPTY') {
          // Если уже показали куски — оставляем их, ошибку только если пусто
          if (acc && (acc.sqi != null || acc.ageYears != null || acc.metrics)) {
            patch({
              result: {
                ...acc,
                pending: false,
                note: lastError,
              },
              progress: '',
              progressAttempt: 0,
              loading: false,
            });
            return;
          }
          patch({
            error: lastError,
            errorCode: lastCode,
            progress: '',
            progressAttempt: 0,
            loading: false,
          });
          return;
        }

        if (attempt < POLL_ATTEMPTS) {
          await sleep(POLL_DELAY_MS);
        }
      }

      if (runId !== activeCheckRunId) return;

      // Полное ожидание закончилось: если CT уже что-то отдал — фиксируем это
      if (acc && (acc.sqi != null || acc.ageYears != null || acc.metrics)) {
        patch({
          result: {
            ...acc,
            pending: false,
            note:
              acc.note ||
              'Показаны метрики, которые успел отдать CheckTrust. Можно нажать «Проверить» ещё раз позже.',
          },
          progress: '',
          progressAttempt: 0,
          loading: false,
        });
        return;
      }

      // CT ничего не отдал — возраст из Wayback
      patch({
        progress: 'Беру возраст из Webarchive…',
        progressAttempt: POLL_ATTEMPTS,
      });
      const fallback = await window.artfrance?.lookupCheckTrust({
        host,
        applicationKey: settings.checkTrustKey,
        maxAttempts: 1,
        waybackFallback: true,
      });

      if (runId !== activeCheckRunId) return;

      if (fallback?.ok) {
        patch({
          result: mergeResult(acc, { ...fallback, code: fallback.code }, false),
          progress: '',
          progressAttempt: 0,
          loading: false,
        });
        return;
      }

      patch({
        error:
          fallback?.error ||
          'CheckTrust не успел посчитать метрики за отведённое время. Нажмите «Проверить» ещё раз — анализ уже запущен на стороне сервиса.',
        errorCode: fallback?.code || lastCode || 'CT_IN_PROCESS',
        progress: '',
        progressAttempt: 0,
        loading: false,
      });
    } catch (err) {
      if (runId !== activeCheckRunId) return;
      patch({
        error: err instanceof Error ? err.message : 'Ошибка запроса',
        progress: '',
        progressAttempt: 0,
        loading: false,
      });
    }
  }

  return (
    <div className="ct-layout">
      <section className="panel">
        <h2>Проверка CheckTrust</h2>
        <p className="muted">
          Ручная проверка домена в CheckTrust (ИКС и возраст). Ожидание до ~8 мин — метрики
          появляются по мере поступления.
        </p>

        {!settings.checkTrustKey?.trim() ? (
          <div className="muted">
            Укажите API key в{' '}
            <button type="button" className="linkish" onClick={onOpenSettings}>
              Настройках
            </button>
            .
          </div>
        ) : null}

        <div className="field">
          <label>Домен</label>
          <input
            value={domain}
            onChange={(e) => patch({ domain: e.target.value })}
            placeholder="example.com"
            disabled={loading}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCheck();
            }}
          />
        </div>

        <div className="actions">
          <button
            type="button"
            className="btn-primary"
            disabled={loading || !domain.trim() || !settings.checkTrustKey?.trim()}
            onClick={() => void handleCheck()}
          >
            {loading ? 'Жду CheckTrust…' : 'Проверить'}
          </button>
        </div>

        {loading ? (
          <div className="ct-progress-block">
            <div
              className="progress ct-progress-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPct}
            >
              <span style={{ width: `${progressPct}%` }} />
            </div>
            {progress ? <div className="ct-progress-label">{progress}</div> : null}
          </div>
        ) : null}

        {!loading && progress ? <div className="status-pill warn">{progress}</div> : null}

        {error ? (
          <div
            className={`status-pill ${
              errorCode === 'CT_LIMITS' ||
              errorCode === 'CT_IN_PROCESS' ||
              errorCode === 'CT_NO_DATA'
                ? 'warn'
                : 'err'
            }`}
          >
            {error}
          </div>
        ) : null}
      </section>

      <section className="panel">
        <h2>
          {result?.host || 'Результат'}
          {result?.pending ? ' · обновляется…' : ''}
        </h2>
        {result ? (
          <>
            <div className="detail-summary">
              <span className="metric-na">
                Возраст: {result.ageYears ?? (result.pending ? '…' : '—')}
              </span>
              <span className="metric-na">
                ИКС: {result.sqi ?? (result.pending ? '…' : '—')}
              </span>
            </div>
            {result.pending ? (
              <div className="muted">Метрики обновляются…</div>
            ) : null}
            {!result.pending && result.source === 'wayback' && result.ageYears != null ? (
              <div className="muted">Возраст из Webarchive · ИКС для этого домена недоступен</div>
            ) : null}
            {!result.pending && result.note && result.source !== 'wayback' ? (
              <div className="muted">{result.note}</div>
            ) : null}
            <div className="detail-list">
              {detailRows.length === 0 ? (
                <div className="muted">
                  {result.pending ? 'Жду первые поля от CheckTrust…' : 'Метрики не пришли.'}
                </div>
              ) : (
                detailRows.map((row) => (
                  <div key={row.key} className="detail-row">
                    <span>{row.label}</span>
                    <strong>{formatValue(row.value)}</strong>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="muted">Введите домен и нажмите «Проверить».</div>
        )}
      </section>
    </div>
  );
}
