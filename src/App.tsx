import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSettings, DomainRow, JobLog, JobProgress } from './vite-env';
import logoUrl from '/app-icon.svg';
import DropsView from './DropsView';
import ScreenshotsView from './ScreenshotsView';
import SettingsView from './SettingsView';
import CheckTrustView, { type CheckTrustSession, emptyCheckTrustSession } from './CheckTrustView';

type Mode = 'drops' | 'shots' | 'checktrust' | 'settings';

export type DropsSession = {
  query: string;
  good: DomainRow[];
  bad: DomainRow[];
  sources: Array<{ position?: number; title?: string; link: string; domain: string }>;
  logs: JobLog[];
  progress: JobProgress | null;
  status: string;
  logHeight: number;
  /** Persist selection across tab switches */
  selectedDomain: string | null;
  resultsTab: 'good' | 'bad' | 'sources';
  metricsLoadingDomain: string | null;
  jobRunning: boolean;
};

const emptyDrops = (): DropsSession => ({
  query: '',
  good: [],
  bad: [],
  sources: [],
  logs: [],
  progress: null,
  status: '',
  logHeight: 180,
  selectedDomain: null,
  resultsTab: 'good',
  metricsLoadingDomain: null,
  jobRunning: false,
});

export default function App() {
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<Mode>('drops');
  const [settings, setSettings] = useState<AppSettings>({
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
    hasSemrushSession: false,
    domains: '',
    frequency: 'monthly',
    resultsDir: '',
    maxSnapshots: 36,
    uiMode: 'drops',
    semrushLastLoginAt: 0,
    loginCooldownRemainingMs: 0,
    loginCooldownMinutes: 30,
  });
  const [drops, setDrops] = useState<DropsSession>(emptyDrops);
  const [checkTrust, setCheckTrust] = useState<CheckTrustSession>(emptyCheckTrustSession);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    const api = window.artfrance;
    if (!api) {
      setReady(true);
      return;
    }
    (async () => {
      try {
        const s = await api.getSettings();
        setSettings(s);
        setDrops((prev) => ({ ...prev, query: s.lastQuery || '' }));
        if (
          s.uiMode === 'shots' ||
          s.uiMode === 'settings' ||
          s.uiMode === 'drops' ||
          s.uiMode === 'checktrust'
        ) {
          setMode(s.uiMode);
        }
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const scheduleSave = useCallback((partial: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
    if (!window.artfrance) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const next = await window.artfrance.saveSettings(partial);
      setSettings(next);
    }, 400);
  }, []);

  function switchMode(next: Mode) {
    setMode(next);
    scheduleSave({ uiMode: next });
  }

  if (!ready) {
    return (
      <div className="app">
        <div className="muted">Загрузка…</div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="top titlebar-drag">
        <div className="brand titlebar-no-drag">
          <img src={logoUrl} alt="ART France" />
          <div>
            <h1>ART France — Drop Domains</h1>
            <p>Поиск дропов · скриншоты</p>
          </div>
        </div>

        <div className="titlebar-no-drag mode-switch">
          <button type="button" className={`tab ${mode === 'drops' ? 'active' : ''}`} onClick={() => switchMode('drops')}>
            Дропы
          </button>
          <button type="button" className={`tab ${mode === 'shots' ? 'active' : ''}`} onClick={() => switchMode('shots')}>
            Скриншоты
          </button>
          <button
            type="button"
            className={`tab ${mode === 'checktrust' ? 'active' : ''}`}
            onClick={() => switchMode('checktrust')}
          >
            CheckTrust
          </button>
          <button
            type="button"
            className={`tab ${mode === 'settings' ? 'active' : ''}`}
            onClick={() => switchMode('settings')}
          >
            Настройки
          </button>
        </div>

        <div className="titlebar-no-drag window-controls">
          <button
            type="button"
            className="win-btn win-min"
            title="Свернуть"
            aria-label="Свернуть"
            onClick={() => window.artfrance?.windowMinimize()}
          >
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <path d="M1 5h8" />
            </svg>
          </button>
          <button
            type="button"
            className="win-btn win-max"
            title="Развернуть"
            aria-label="Развернуть"
            onClick={() => window.artfrance?.windowMaximize()}
          >
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <rect x="1.5" y="1.5" width="7" height="7" />
            </svg>
          </button>
          <button
            type="button"
            className="win-btn win-close"
            title="Закрыть"
            aria-label="Закрыть"
            onClick={() => window.artfrance?.windowClose()}
          >
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
            </svg>
          </button>
        </div>
      </header>

      <div className="titlebar-no-drag app-body">
        <div className={`view-slot ${mode === 'drops' ? 'view-slot-active' : ''}`}>
          <DropsView
            settings={settings}
            scheduleSave={scheduleSave}
            session={drops}
            setSession={setDrops}
            onGoShots={(domainsText) => {
              scheduleSave({ domains: domainsText, uiMode: 'shots' });
              setMode('shots');
            }}
            onOpenSettings={() => switchMode('settings')}
            onOpenCheckTrust={(domain) => {
              if (domain) {
                setCheckTrust((prev) => ({ ...prev, domain }));
              }
              switchMode('checktrust');
            }}
          />
        </div>
        {mode === 'shots' ? (
          <ScreenshotsView settings={settings} scheduleSave={scheduleSave} onOpenSettings={() => switchMode('settings')} />
        ) : null}
        {mode === 'checktrust' ? (
          <CheckTrustView
            settings={settings}
            session={checkTrust}
            setSession={setCheckTrust}
            onOpenSettings={() => switchMode('settings')}
          />
        ) : null}
        {mode === 'settings' ? (
          <SettingsView settings={settings} setSettings={setSettings} scheduleSave={scheduleSave} />
        ) : null}
      </div>
    </div>
  );
}
