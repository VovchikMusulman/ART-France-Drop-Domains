/**
 * Wayback history aligned with the Archive "Calendar" view for the host homepage.
 *
 * Bug we hit: matchType=domain + filter=statuscode:200 + limit=1 returned a
 * spurious deep URL (e.g. /milla/eng from 2009) while the UI showed 2013–2018.
 * We prefer root URL captures (http(s)://domain/) and accept 2xx/3xx.
 */
function isHomepageOriginal(original, domain) {
  try {
    const u = new URL(String(original || ''));
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    if (host !== domain.toLowerCase()) return false;
    const path = (u.pathname || '/').replace(/\/+$/, '') || '/';
    return path === '/';
  } catch {
    return false;
  }
}

function stampAgeYears(stamp) {
  if (!/^\d{14}$/.test(stamp)) return null;
  return new Date().getFullYear() - Number(stamp.slice(0, 4));
}

async function fetchCdx(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(25000),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Wayback HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch {
    const err = new Error('Wayback: не JSON');
    throw err;
  }
}

function collectStamps(rows, domain, { homepageOnly }) {
  const stamps = [];
  if (!Array.isArray(rows) || rows.length < 2) return stamps;
  for (let i = 1; i < rows.length; i += 1) {
    const stamp = String(rows[i][0] || '');
    const original = String(rows[i][1] || '');
    const code = String(rows[i][2] || '');
    if (!/^\d{14}$/.test(stamp)) continue;
    if (/^[45]\d\d$/.test(code)) continue;
    if (homepageOnly && original && !isHomepageOriginal(original, domain)) continue;
    stamps.push(stamp);
  }
  stamps.sort();
  return stamps;
}

async function checkOldSnapshot(domainRaw, minAgeYears = 2) {
  const domain = String(domainRaw || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];

  if (!domain) {
    return { ok: false, hasOldSnapshot: false, error: 'Пустой домен' };
  }

  const hostUrl =
    `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}` +
    `&matchType=host&output=json&fl=timestamp,original,statuscode&limit=200`;

  try {
    const rows = await fetchCdx(hostUrl);
    let stamps = collectStamps(rows, domain, { homepageOnly: true });
    let scope = 'homepage';

    // Fallback: if calendar root is empty, use host-wide (still no 4xx)
    if (!stamps.length) {
      stamps = collectStamps(rows, domain, { homepageOnly: false });
      scope = 'host';
    }

    if (!stamps.length) {
      return { ok: true, hasOldSnapshot: false, oldest: null, newest: null, captures: 0, scope };
    }

    const oldest = stamps[0];
    const newest = stamps[stamps.length - 1];
    const ageYears = stampAgeYears(oldest);
    const hasOldSnapshot = ageYears != null && ageYears >= minAgeYears;

    return {
      ok: true,
      hasOldSnapshot,
      oldest,
      newest,
      ageYears,
      captures: stamps.length,
      scope,
    };
  } catch (err) {
    return {
      ok: false,
      hasOldSnapshot: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

module.exports = { checkOldSnapshot, isHomepageOriginal };
