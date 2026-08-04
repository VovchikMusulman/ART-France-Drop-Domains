/// <reference types="vite/client" />

declare module '*.svg' {
  const src: string;
  export default src;
}

export type JobProgress = {
  phase: 'outlinks' | 'check' | 'done';
  percent: number;
  current: string;
  sourceIndex: number;
  sourceTotal: number;
  message: string;
};

export type JobLog = {
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
};

export type CheckTrustPayload = {
  sqi?: number | null;
  ageYears?: number | null;
  webarchiveDays?: number | null;
  webarchiveFirst?: string | null;
  metrics?: Record<string, unknown> | null;
  error?: string;
  code?: string;
};

export type DomainRow = {
  domain: string;
  sourceDomain: string;
  sourceUrl: string;
  registered: boolean | null;
  created: string | null;
  ageYears: number | null;
  iks: number | null;
  /** Ahrefs Domain Rating (если есть источник) */
  dr: number | null;
  /** Semrush Authority Score */
  as: number | null;
  hasSnapshots2y: boolean;
  waybackOldest: string | null;
  reason: string;
  checkTrust?: CheckTrustPayload | null;
  checkedAt: string;
};

export type CaptureProgress = {
  phase: 'capture' | 'done';
  domainIndex: number;
  domainTotal: number;
  shotIndex: number;
  shotTotal: number;
  currentDomain: string;
  currentDate?: string;
  percent: number;
};

export type CaptureLog = {
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
};

export type SearchProvider = 'serper' | 'yandex';

export type AppSettings = {
  serperKey: string;
  searchProvider: SearchProvider;
  yandexApiKey: string;
  yandexFolderId: string;
  yandexRegionId: number;
  semrushEmail: string;
  semrushPassword: string;
  checkTrustKey: string;
  /** Free Ahrefs API key for Domain Rating */
  ahrefsApiKey: string;
  lastQuery: string;
  minAgeYears: number;
  minIks: number;
  /** Подсветка для Google (Serper): мин. Domain Rating */
  minDr: number;
  /** Подсветка для Google (Serper): мин. Authority Score (Semrush) */
  minAs: number;
  maxOutlinksPerSource: number;
  hasSemrushSession?: boolean;
  semrushLastLoginAt?: number;
  loginCooldownRemainingMs?: number;
  loginCooldownMinutes?: number;
  domains: string;
  frequency: 'yearly' | 'quarterly' | 'monthly' | 'all';
  resultsDir: string;
  maxSnapshots: number;
  uiMode?: 'drops' | 'shots' | 'settings' | 'checktrust';
};

export type CheckTrustLookupResult = {
  ok: boolean;
  code?: string;
  error?: string;
  host?: string;
  sqi?: number | null;
  ageYears?: number | null;
  webarchiveDays?: number | null;
  metrics?: Record<string, unknown> | null;
};

export type JobResult = {
  ok: boolean;
  aborted?: boolean;
  error?: string;
  message?: string;
  organic?: Array<{ position?: number; title?: string; link: string; domain: string }>;
  good?: DomainRow[];
  bad?: DomainRow[];
};

export type CaptureResult = {
  ok: boolean;
  error?: string;
  aborted?: boolean;
  resultsDir?: string;
  saved?: number;
  skipped?: number;
  failed?: number;
  domains?: number;
};

export type ArtFranceApi = {
  getSettings: () => Promise<AppSettings>;
  saveSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>;
  loginSemrush: (options?: { force?: boolean }) => Promise<{
    ok: boolean;
    error?: string;
    email?: string;
    hasSemrushSession?: boolean;
    loginCooldownRemainingMs?: number;
  }>;
  logoutSemrush: () => Promise<{
    ok: boolean;
    hasSemrushSession?: boolean;
    loginCooldownRemainingMs?: number;
  }>;
  startJob: (options: Partial<AppSettings> & { query: string }) => Promise<JobResult>;
  stopJob: () => Promise<{ ok: boolean }>;
  lookupCheckTrust: (payload: {
    host: string;
    applicationKey: string;
    maxAttempts?: number;
    delayMs?: number;
  }) => Promise<CheckTrustLookupResult>;
  exportCsv: (payload: { kind: 'good' | 'bad'; rows: DomainRow[] }) => Promise<{
    ok: boolean;
    path?: string;
    error?: string;
    canceled?: boolean;
  }>;
  pickResultsDir: () => Promise<string | null>;
  openPath: (targetPath: string) => Promise<string>;
  openExternal: (url: string) => Promise<{ ok: boolean }>;
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<void>;
  windowClose: () => Promise<void>;
  startCapture: (options: {
    domainsText: string;
    frequency: AppSettings['frequency'];
    resultsDir: string;
    maxSnapshots: number;
  }) => Promise<CaptureResult>;
  stopCapture: () => Promise<{ ok: boolean }>;
  onProgress: (handler: (payload: JobProgress) => void) => () => void;
  onLog: (handler: (payload: JobLog) => void) => () => void;
  onCaptureProgress: (handler: (payload: CaptureProgress) => void) => () => void;
  onCaptureLog: (handler: (payload: CaptureLog) => void) => () => void;
};

declare global {
  interface Window {
    artfrance: ArtFranceApi;
  }
}

export {};
