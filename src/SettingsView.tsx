import { useEffect, useMemo, useState } from 'react';
import type { AppSettings, SearchProvider } from './vite-env';
import {
  DEFAULT_YANDEX_REGION_ID,
  YANDEX_CITIES,
  YANDEX_COUNTRIES,
} from './yandexRegions';

type Props = {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  scheduleSave: (partial: Partial<AppSettings>) => void;
};

function formatCooldown(ms: number) {
  if (ms <= 0) return '';
  const m = Math.ceil(ms / 60000);
  return `~${m} мин`;
}

function clampNumber(raw: string, min: number, max: number, fallback: number) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export default function SettingsView({ settings, setSettings, scheduleSave }: Props) {
  const [loggingIn, setLoggingIn] = useState(false);
  const [status, setStatus] = useState('');
  const [statusKind, setStatusKind] = useState<'on' | 'warn' | 'err' | ''>('');
  const [now, setNow] = useState(Date.now());

  const provider: SearchProvider = settings.searchProvider === 'yandex' ? 'yandex' : 'serper';

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (loggingIn) return;
    if (settings.hasSemrushSession) {
      setStatus('Сессия Semrush сохранена');
      setStatusKind('on');
    } else {
      setStatus('Сессия Semrush отсутствует');
      setStatusKind('');
    }
  }, [settings.hasSemrushSession, loggingIn]);

  const cooldownMs = useMemo(() => {
    const stored = Number(settings.loginCooldownRemainingMs) || 0;
    if (stored <= 0) return 0;
    const last = Number(settings.semrushLastLoginAt) || 0;
    if (!last) return stored;
    const total = (settings.loginCooldownMinutes || 30) * 60000;
    return Math.max(0, total - (now - last));
  }, [
    settings.loginCooldownRemainingMs,
    settings.semrushLastLoginAt,
    settings.loginCooldownMinutes,
    now,
  ]);

  const loginDisabled =
    loggingIn ||
    (settings.hasSemrushSession && cooldownMs > 0) ||
    !settings.semrushEmail?.trim() ||
    !settings.semrushPassword;

  async function handleLogin() {
    if (!window.artfrance) return;
    setLoggingIn(true);
    setStatus('Подключение Semrush…');
    setStatusKind('warn');
    await window.artfrance.saveSettings({
      semrushEmail: settings.semrushEmail,
      semrushPassword: settings.semrushPassword,
      searchProvider: settings.searchProvider,
      serperKey: settings.serperKey,
      yandexApiKey: settings.yandexApiKey,
      yandexFolderId: settings.yandexFolderId,
      yandexRegionId: settings.yandexRegionId,
      checkTrustKey: settings.checkTrustKey,
      ahrefsApiKey: settings.ahrefsApiKey,
      minAgeYears: settings.minAgeYears,
      minIks: settings.minIks,
      minDr: settings.minDr,
      minAs: settings.minAs,
      maxOutlinksPerSource: settings.maxOutlinksPerSource,
    });
    const result = await window.artfrance.loginSemrush();
    setLoggingIn(false);
    if (result.ok) {
      const next = await window.artfrance.getSettings();
      setSettings(next);
      setStatus(`Semrush подключён (${result.email || settings.semrushEmail})`);
      setStatusKind('on');
    } else {
      const next = await window.artfrance.getSettings();
      setSettings(next);
      setStatus(result.error || 'Ошибка входа');
      setStatusKind('err');
    }
  }

  async function handleLogout() {
    if (!window.artfrance) return;
    await window.artfrance.logoutSemrush();
    const next = await window.artfrance.getSettings();
    setSettings(next);
    setStatus('Сессия сброшена');
    setStatusKind('warn');
  }

  function setProvider(next: SearchProvider) {
    scheduleSave({ searchProvider: next });
  }

  return (
    <div className="settings-layout">
      <div className="settings-left">
        <section className="panel">
          <h2>API поиска конкурентов</h2>
          <p className="muted">
            Ключи для топ‑5 источников: Serper (Google) или Yandex Search API — в зависимости от
            выбора в параметрах поиска.
          </p>

          {provider === 'serper' ? (
            <div className="field">
              <label>Serper API key</label>
              <input
                type="password"
                value={settings.serperKey}
                onChange={(e) => scheduleSave({ serperKey: e.target.value })}
                placeholder="ключ Serper"
                autoComplete="off"
              />
            </div>
          ) : (
            <>
              <div className="field">
                <label>Yandex API key</label>
                <input
                  type="password"
                  value={settings.yandexApiKey || ''}
                  onChange={(e) => scheduleSave({ yandexApiKey: e.target.value })}
                  placeholder="Api-Key из Yandex Cloud"
                  autoComplete="off"
                />
              </div>
              <div className="field">
                <label>Yandex Folder ID</label>
                <input
                  value={settings.yandexFolderId || ''}
                  onChange={(e) => scheduleSave({ yandexFolderId: e.target.value })}
                  placeholder="b1g…"
                  autoComplete="off"
                />
              </div>
            </>
          )}
        </section>

        <section className="panel">
          <h2>API сбора статистики</h2>
          <p className="muted">
            Метрики свободных доменов и исходящие ссылки. Semrush: не подключайте сессию при каждом
            запуске — сохранённая переиспользуется.
          </p>

          <div className="field">
            <label>CheckTrust API key</label>
            <input
              type="password"
              value={settings.checkTrustKey || ''}
              onChange={(e) => scheduleSave({ checkTrustKey: e.target.value })}
              placeholder="applicationKey из кабинета CheckTrust"
              autoComplete="off"
            />
          </div>

          <div className="field">
            <label>Ahrefs API key (DR)</label>
            <input
              type="password"
              value={settings.ahrefsApiKey || ''}
              onChange={(e) => scheduleSave({ ahrefsApiKey: e.target.value })}
              placeholder="бесплатный ключ Ahrefs API v3"
              autoComplete="off"
            />
            <div className="muted" style={{ marginTop: 6 }}>
              Domain Rating by{' '}
              <button
                type="button"
                className="linkish"
                onClick={() => window.artfrance?.openExternal('https://ahrefs.com/')}
              >
                Ahrefs
              </button>
              {' · '}
              <button
                type="button"
                className="linkish"
                onClick={() =>
                  window.artfrance?.openExternal(
                    'https://docs.ahrefs.com/en/api/reference/public/get-domain-rating-free'
                  )
                }
              >
                docs
              </button>
            </div>
          </div>

          <div className="field">
            <label>Semrush email</label>
            <input
              type="email"
              value={settings.semrushEmail}
              onChange={(e) => scheduleSave({ semrushEmail: e.target.value })}
              placeholder="you@company.com"
              autoComplete="off"
            />
          </div>

          <div className="field">
            <label>Semrush пароль</label>
            <input
              type="password"
              value={settings.semrushPassword}
              onChange={(e) => scheduleSave({ semrushPassword: e.target.value })}
              placeholder="пароль"
              autoComplete="off"
            />
          </div>

          <div className={`status-pill ${statusKind}`}>{status || 'Сессия Semrush отсутствует'}</div>

          <div className="actions">
            <button type="button" className="btn-primary" disabled={loginDisabled} onClick={handleLogin}>
              {loggingIn
                ? 'Подключение…'
                : settings.hasSemrushSession && cooldownMs > 0
                  ? `Повтор через ${formatCooldown(cooldownMs)}`
                  : settings.hasSemrushSession
                    ? 'Обновить сессию Semrush'
                    : 'Подключить Semrush'}
            </button>
            {settings.hasSemrushSession ? (
              <button type="button" className="btn-ghost" disabled={loggingIn} onClick={handleLogout}>
                Сбросить сессию
              </button>
            ) : null}
          </div>

          <div className="muted">
            Кулдаун повторного входа: {settings.loginCooldownMinutes || 30} мин после успешного
            подключения. Сброс сессии снимает кулдаун.
          </div>
        </section>
      </div>

      <section className="panel">
        <h2>Параметры поиска дропов</h2>

        <div className="field">
          <label>Поиск конкурентов</label>
          <div className="seg seg-2">
            <button
              type="button"
              className={`seg-btn ${provider === 'serper' ? 'active' : ''}`}
              onClick={() => setProvider('serper')}
            >
              <strong>Serper</strong>
              <span>Google top‑5</span>
            </button>
            <button
              type="button"
              className={`seg-btn ${provider === 'yandex' ? 'active' : ''}`}
              onClick={() => setProvider('yandex')}
            >
              <strong>Yandex</strong>
              <span>выдача + регион</span>
            </button>
          </div>
        </div>

        {provider === 'yandex' ? (
          <div className="field">
            <label>Регион поиска</label>
            <select
              value={Number(settings.yandexRegionId) || DEFAULT_YANDEX_REGION_ID}
              onChange={(e) =>
                scheduleSave({
                  yandexRegionId: clampNumber(
                    e.target.value,
                    1,
                    999999,
                    DEFAULT_YANDEX_REGION_ID
                  ),
                })
              }
            >
              <optgroup label="Страны">
                {YANDEX_COUNTRIES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.id})
                  </option>
                ))}
              </optgroup>
              <optgroup label="Города России">
                {YANDEX_CITIES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.id})
                  </option>
                ))}
              </optgroup>
            </select>
            <div className="muted" style={{ marginTop: 6 }}>
              Список регионов из{' '}
              <button
                type="button"
                className="linkish"
                onClick={() =>
                  window.artfrance?.openExternal(
                    'https://aistudio.yandex.ru/docs/ru/search-api/reference/regions.html'
                  )
                }
              >
                документации Yandex Search API
              </button>
              .
            </div>
          </div>
        ) : null}

        {provider === 'yandex' ? (
          <div className="row">
            <div className="field">
              <label>Мин. возраст (лет) — подсветка</label>
              <input
                type="number"
                min={1}
                max={20}
                value={settings.minAgeYears}
                onChange={(e) =>
                  scheduleSave({ minAgeYears: clampNumber(e.target.value, 1, 20, 2) })
                }
              />
            </div>
            <div className="field">
              <label>Мин. ИКС — подсветка</label>
              <input
                type="number"
                min={0}
                max={100000}
                value={settings.minIks ?? 100}
                onChange={(e) => scheduleSave({ minIks: clampNumber(e.target.value, 0, 100000, 100) })}
              />
            </div>
          </div>
        ) : (
          <div className="row">
            <div className="field">
              <label>Мин. DR — подсветка</label>
              <input
                type="number"
                min={0}
                max={100}
                value={settings.minDr ?? 20}
                onChange={(e) => scheduleSave({ minDr: clampNumber(e.target.value, 0, 100, 20) })}
              />
            </div>
            <div className="field">
              <label>Мин. AS — подсветка</label>
              <input
                type="number"
                min={0}
                max={100}
                value={settings.minAs ?? 20}
                onChange={(e) => scheduleSave({ minAs: clampNumber(e.target.value, 0, 100, 20) })}
              />
            </div>
          </div>
        )}
        <div className="row">
          <div className="field">
            <label>Макс. outlinks / источник</label>
            <input
              type="number"
              min={5}
              max={200}
              value={settings.maxOutlinksPerSource}
              onChange={(e) =>
                scheduleSave({ maxOutlinksPerSource: clampNumber(e.target.value, 5, 200, 40) })
              }
            />
          </div>
        </div>
        <div className="muted">
          {provider === 'yandex'
            ? 'Режим Яндекс: в Good подсвечиваются Возраст и ИКС (CheckTrust). Все свободные домены попадают в Good.'
            : 'Режим Google: в Good подсвечиваются DR (Ahrefs) и AS (Semrush Outbound).'}
        </div>
      </section>

      <section className="panel">
        <h2>Скриншоты</h2>
        <div className="field">
          <label>Папка результатов</label>
          <div className="path-row">
            <input className="path" value={settings.resultsDir || ''} readOnly />
            <button
              type="button"
              className="btn-ghost"
              onClick={async () => {
                const next = await window.artfrance?.pickResultsDir();
                if (next) scheduleSave({ resultsDir: next });
              }}
            >
              Выбрать
            </button>
            {settings.resultsDir ? (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => window.artfrance?.openPath(settings.resultsDir)}
              >
                Открыть
              </button>
            ) : null}
          </div>
        </div>
        <div className="field">
          <label>Макс. снимков на URL</label>
          <input
            type="number"
            min={1}
            max={200}
            value={settings.maxSnapshots || 36}
            onChange={(e) => scheduleSave({ maxSnapshots: clampNumber(e.target.value, 1, 200, 36) })}
          />
        </div>
      </section>
    </div>
  );
}
