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

/** Базовый набор метрик (ИКС/возраст) — ждём до ~8 мин с первого нажатия */
const POLL_ATTEMPTS = 96;
const POLL_DELAY_MS = 5000;

export type CheckTrustResult = {
  host?: string;
  sqi?: number | null;
  ageYears?: number | null;
  metrics?: Record<string, unknown> | null;
};

export type CheckTrustSession = {
  domain: string;
  loading: boolean;
  progress: string;
  error: string;
  errorCode: string;
  result: CheckTrustResult | null;
};

export function emptyCheckTrustSession(): CheckTrustSession {
  return {
    domain: '',
    loading: false,
    progress: '',
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

export default function CheckTrustView({ settings, session, setSession, onOpenSettings }: Props) {
  const { domain, loading, progress, error, errorCode, result } = session;

  const detailRows = useMemo(() => {
    const metrics = result?.metrics;
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
      progress: '',
      result: null,
    });

    try {
      let lastCode = '';
      let lastError = '';

      for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
        if (runId !== activeCheckRunId) return;

        patch({
          progress:
            attempt === 1
              ? 'Запрос к CheckTrust…'
              : `CheckTrust считает метрики… ${attempt}/${POLL_ATTEMPTS}`,
        });

        const res = await window.artfrance?.lookupCheckTrust({
          host,
          applicationKey: settings.checkTrustKey,
          maxAttempts: 1,
        });

        if (runId !== activeCheckRunId) return;

        if (res?.ok) {
          patch({
            result: {
              host: res.host,
              sqi: res.sqi,
              ageYears: res.ageYears,
              metrics: res.metrics || null,
            },
            progress: '',
            loading: false,
          });
          return;
        }

        lastCode = res?.code || '';
        lastError = res?.error || 'Не удалось проверить домен';

        if (res?.code !== 'CT_IN_PROCESS') {
          patch({
            error: lastError,
            errorCode: lastCode,
            progress: '',
            loading: false,
          });
          return;
        }

        if (attempt < POLL_ATTEMPTS) {
          await sleep(POLL_DELAY_MS);
        }
      }

      if (runId !== activeCheckRunId) return;
      patch({
        error:
          'CheckTrust не успел посчитать метрики за отведённое время. Нажмите «Проверить» ещё раз — анализ уже запущен на стороне сервиса.',
        errorCode: lastCode || 'CT_IN_PROCESS',
        progress: '',
        loading: false,
      });
    } catch (err) {
      if (runId !== activeCheckRunId) return;
      patch({
        error: err instanceof Error ? err.message : 'Ошибка запроса',
        progress: '',
        loading: false,
      });
    }
  }

  return (
    <div className="ct-layout">
      <section className="panel">
        <h2>Проверка CheckTrust</h2>
        <p className="muted">
          Если во время поиска закончились средства, здесь можно позже вручную проверить свободные
          домены после пополнения баланса. Запрашиваются основные метрики (ИКС, возраст Webarchive).
          Первый запрос по новому домену может занять несколько минут — приложение ждёт ответ само
          (до ~8 мин).
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

        {progress ? <div className="status-pill warn">{progress}</div> : null}

        {error ? (
          <div
            className={`status-pill ${
              errorCode === 'CT_LIMITS' || errorCode === 'CT_IN_PROCESS' ? 'warn' : 'err'
            }`}
          >
            {error}
          </div>
        ) : null}
      </section>

      <section className="panel">
        <h2>{result?.host || 'Результат'}</h2>
        {result ? (
          <>
            <div className="detail-summary">
              <span className="metric-na">Возраст: {result.ageYears ?? '—'}</span>
              <span className="metric-na">ИКС: {result.sqi ?? '—'}</span>
            </div>
            <div className="detail-list">
              {detailRows.length === 0 ? (
                <div className="muted">Метрики не пришли.</div>
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
