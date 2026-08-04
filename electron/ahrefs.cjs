/**
 * Free Ahrefs Domain Rating API.
 * @see https://docs.ahrefs.com/en/api/reference/public/get-domain-rating-free
 * Attribution: "Domain Rating by Ahrefs" — https://ahrefs.com/
 */

async function fetchDomainRating(host, apiKey = '') {
  const domain = String(host || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];

  if (!domain) {
    return { ok: false, code: 'EMPTY', error: 'Пустой хост', dr: null };
  }

  const url = `https://api.ahrefs.com/v3/public/domain-rating-free?target=${encodeURIComponent(domain)}&output=json`;
  const headers = { Accept: 'application/json' };
  const key = String(apiKey || '').trim();
  if (key) headers.Authorization = `Bearer ${key}`;

  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      return {
        ok: false,
        code: 'PARSE',
        error: `Ahrefs DR: не JSON (HTTP ${res.status})`,
        dr: null,
        raw: text.slice(0, 300),
      };
    }

    if (!res.ok) {
      const errText =
        json?.error || json?.message || `Ahrefs DR HTTP ${res.status}`;
      const code =
        res.status === 401
          ? 'AHREFS_AUTH'
          : res.status === 429
            ? 'AHREFS_RATE'
            : 'HTTP';
      return { ok: false, code, error: String(errText), dr: null, raw: json };
    }

    const rawDr =
      json?.domain_rating?.domain_rating ??
      json?.domain_rating ??
      json?.domainRating ??
      null;
    const dr = typeof rawDr === 'number' && Number.isFinite(rawDr) ? rawDr : Number(rawDr);
    if (!Number.isFinite(dr)) {
      return { ok: false, code: 'NO_DR', error: 'Ahrefs не вернул DR', dr: null, raw: json };
    }

    return {
      ok: true,
      code: 'OK',
      host: domain,
      dr: Math.round(dr * 10) / 10,
      license: json?.domain_rating?.license || json?.license || null,
    };
  } catch (err) {
    return {
      ok: false,
      code: 'NETWORK',
      error: err instanceof Error ? err.message : String(err),
      dr: null,
    };
  }
}

module.exports = { fetchDomainRating };
