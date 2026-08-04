import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react';
import type { AppSettings, CaptureLog, CaptureProgress } from './vite-env';

const FREQUENCY_OPTIONS: { value: AppSettings['frequency']; label: string; hint: string }[] = [
  { value: 'yearly', label: 'Раз в год', hint: 'быстро' },
  { value: 'quarterly', label: 'Раз в квартал', hint: 'баланс' },
  { value: 'monthly', label: 'Раз в месяц', hint: 'подробно' },
  { value: 'all', label: 'Все снимки', hint: 'лимит в настройках' },
];

function parseTargetPreview(text: string) {
  const parts = text
    .split(/[\n\r,;]+|\s+/)
    .map((raw) => {
      let value = raw.trim().toLowerCase();
      if (!value) return '';
      value = value.replace(/^https?:\/\//, '').replace(/^www\./, '');
      value = value.split('#')[0].split('?')[0];
      const match = value.match(/^([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d+)?(\/.*)?$/i);
      if (!match) return '';
      const host = match[1];
      let pathname = match[2] || '/';
      pathname = pathname.replace(/\/{2,}/g, '/');
      if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
      return pathname === '/' ? host : `${host}${pathname}`;
    })
    .filter(Boolean);

  return [...new Set(parts)];
}

function normalizePaste(text: string) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[,\t;]+/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

type Props = {
  settings: AppSettings;
  scheduleSave: (partial: Partial<AppSettings>) => void;
  onOpenSettings?: () => void;
};

export default function ScreenshotsView({ settings, scheduleSave, onOpenSettings }: Props) {
  const [domainsText, setDomainsText] = useState(settings.domains || '');
  const [frequency, setFrequency] = useState<AppSettings['frequency']>(settings.frequency || 'monthly');
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<CaptureLog[]>([]);
  const [progress, setProgress] = useState<CaptureProgress | null>(null);
  const [lastResult, setLastResult] = useState('');
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<number | null>(null);
  const resultsDir = settings.resultsDir || '';
  const maxSnapshots = settings.maxSnapshots || 36;

  const domains = useMemo(() => parseTargetPreview(domainsText), [domainsText]);

  useEffect(() => {
    setDomainsText(settings.domains || '');
    setFrequency(settings.frequency || 'monthly');
  }, [settings.domains, settings.frequency]);

  useEffect(() => {
    if (!window.artfrance) return;
    const offProgress = window.artfrance.onCaptureProgress((payload) => setProgress(payload));
    const offLog = window.artfrance.onCaptureLog((payload) => {
      setLogs((prev) => [...prev.slice(-300), payload]);
    });
    return () => {
      offProgress();
      offLog();
    };
  }, []);

  useEffect(() => {
    const box = logEndRef.current?.parentElement;
    if (box) box.scrollTop = box.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (!window.artfrance) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      scheduleSave({
        domains: domainsText,
        frequency,
      });
    }, 400);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [domainsText, frequency, scheduleSave]);

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = event.clipboardData.getData('text');
    if (!pasted) return;
    if (!/[\n,\t; ]/.test(pasted.trim())) return;
    event.preventDefault();
    const normalized = normalizePaste(pasted);
    const el = event.currentTarget;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next =
      domainsText.slice(0, start) +
      (start > 0 && domainsText[start - 1] !== '\n' && domainsText.slice(0, start).trim() ? '\n' : '') +
      normalized +
      (end < domainsText.length && domainsText[end] !== '\n' ? '\n' : '') +
      domainsText.slice(end);
    setDomainsText(normalizePaste(next));
  };

  async function start() {
    if (!window.artfrance) {
      setLastResult('Запустите десктоп-приложение');
      return;
    }
    setLogs([]);
    setProgress(null);
    setLastResult('');
    setRunning(true);
    try {
      const result = await window.artfrance.startCapture({
        domainsText,
        frequency,
        resultsDir,
        maxSnapshots,
      });
      if (!result.ok) setLastResult(result.error || 'Не удалось запустить');
      else if (result.aborted) setLastResult('Остановлено. Часть скриншотов уже сохранена.');
      else {
        setLastResult(
          `Готово: ${result.saved ?? 0} новых, ${result.skipped ?? 0} уже было, ошибок ${result.failed ?? 0}`
        );
      }
    } catch (error) {
      setLastResult(error instanceof Error ? error.message : 'Ошибка запуска');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="shots-layout">
      <section className="panel">
        <h2>Список URL</h2>
        <p className="muted">Домены и страницы. Можно вставить список — каждый URL сохранится отдельно.</p>

        <textarea
          className="domains"
          value={domainsText}
          onChange={(e) => setDomainsText(e.target.value)}
          onPaste={onPaste}
          placeholder={'example.com\nexample.com/about\nhttps://site.ru/page/'}
          spellCheck={false}
          disabled={running}
        />

        {domains.length > 0 ? (
          <div className="chips">
            {domains.map((domain) => (
              <span key={domain} className="chip" title={domain}>
                {domain}
              </span>
            ))}
          </div>
        ) : null}

        <div className="field">
          <label>Плотность снимков</label>
          <div className="seg">
            {FREQUENCY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={frequency === opt.value ? 'seg-btn active' : 'seg-btn'}
                onClick={() => setFrequency(opt.value)}
                disabled={running}
              >
                <strong>{opt.label}</strong>
                <span>{opt.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="threshold-card">
          <div className="threshold-item">
            <span>Папка</span>
            <strong className="threshold-path" title={resultsDir || undefined}>
              {resultsDir ? resultsDir : 'не задана'}
            </strong>
          </div>
          <div className="threshold-item">
            <span>Макс. снимков</span>
            <strong>{maxSnapshots}</strong>
          </div>
          <div className="threshold-note">
            {resultsDir ? (
              'Параметры меняются в Настройках.'
            ) : (
              <>
                Укажите папку в{' '}
                <button type="button" className="linkish" onClick={onOpenSettings}>
                  Настройках
                </button>
                .
              </>
            )}
          </div>
        </div>

        <div className="actions">
          {!running ? (
            <button
              type="button"
              className="btn-primary"
              onClick={start}
              disabled={!domains.length || !resultsDir}
            >
              Запустить скриншоты
            </button>
          ) : (
            <button type="button" className="btn-danger" onClick={() => window.artfrance?.stopCapture()}>
              Остановить
            </button>
          )}
          {resultsDir ? (
            <button type="button" className="btn-ghost" onClick={() => window.artfrance?.openPath(resultsDir)}>
              Открыть папку
            </button>
          ) : null}
          {!running && domainsText ? (
            <button type="button" className="btn-ghost" onClick={() => setDomainsText('')}>
              Очистить
            </button>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <h2>Ход работы</h2>
        <p className="muted">CDX Wayback → скриншоты исторических версий на диск.</p>

        <div className="progress">
          <span style={{ width: `${progress?.percent ?? 0}%` }} />
        </div>
        <div className="muted">
          {progress?.currentDomain
            ? `${progress.currentDomain}${progress.currentDate ? ` · ${progress.currentDate}` : ''} (${progress.shotIndex}/${progress.shotTotal})`
            : running
              ? 'В процессе…'
              : 'Ожидание'}
        </div>

        {lastResult ? <div className="result-banner">{lastResult}</div> : null}

        <div className="logs">
          {logs.length === 0 ? (
            <div className="muted">Лог появится после запуска.</div>
          ) : (
            logs.map((item, index) => (
              <div key={`${index}-${item.message}`} className={`log-${item.level}`}>
                {item.message}
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </section>
    </div>
  );
}
