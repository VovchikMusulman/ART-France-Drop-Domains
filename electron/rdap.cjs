const dns = require('node:dns').promises;
const { extractDomainFromUrl } = require('./utils.cjs');

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function yearsBetween(from, to = new Date()) {
  if (!from) return null;
  const ms = to.getTime() - from.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000));
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/rdap+json, application/json' },
    redirect: 'follow',
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

function pickCreated(events) {
  if (!Array.isArray(events)) return null;
  const preferred = ['registration', 'registered', 'created', 'allocation'];
  for (const type of preferred) {
    const hit = events.find((e) => String(e.eventAction || '').toLowerCase() === type);
    const d = parseDate(hit?.eventDate);
    if (d) return d;
  }
  for (const e of events) {
    const d = parseDate(e.eventDate);
    if (d) return d;
  }
  return null;
}

async function probeDns(domain) {
  const result = { live: false, delegated: false, note: null };

  try {
    await dns.lookup(domain);
    return { live: true, delegated: true, note: null };
  } catch (err) {
    // ESERVFAIL / EAI_AGAIN: имя в DNS есть, но NS отвечают с ошибкой → домен занят
    if (err && (err.code === 'ESERVFAIL' || err.code === 'EAI_AGAIN')) {
      return {
        live: false,
        delegated: true,
        note: `DNS ${err.code} — зона делегирована (занят)`,
      };
    }
  }

  try {
    const a = await dns.resolve4(domain);
    if (a?.length) return { live: true, delegated: true, note: null };
  } catch (err) {
    if (err && err.code === 'ESERVFAIL') {
      return { live: false, delegated: true, note: 'DNS ESERVFAIL — зона делегирована (занят)' };
    }
  }

  try {
    const ns = await dns.resolveNs(domain);
    if (ns?.length) return { live: true, delegated: true, note: null };
  } catch (err) {
    if (err && err.code === 'ESERVFAIL') {
      return { live: false, delegated: true, note: 'DNS ESERVFAIL — зона делегирована (занят)' };
    }
  }

  return result;
}

async function hasDnsRecords(domain) {
  const probe = await probeDns(domain);
  return probe.live || probe.delegated;
}

function rdapEndpoints(domain) {
  const list = [];
  if (/\.ru$/i.test(domain) || /\.su$/i.test(domain) || /\.рф$/i.test(domain)) {
    list.push(`https://rdap.tcinet.ru/domain/${encodeURIComponent(domain)}`);
  }
  list.push(
    `https://rdap.org/domain/${encodeURIComponent(domain)}`,
    `https://www.rdap.net/domain/${encodeURIComponent(domain)}`
  );
  return list;
}

/**
 * RDAP + DNS. Never mark as free on RDAP 404 alone if DNS still resolves.
 */
async function lookupDomain(domainRaw) {
  const domain = extractDomainFromUrl(domainRaw);
  if (!domain) {
    return {
      domain: '',
      registered: null,
      created: null,
      ageYears: null,
      error: 'Пустой домен',
    };
  }

  const dnsProbe = await probeDns(domain);
  const dnsLive = dnsProbe.live || dnsProbe.delegated;
  let lastError = '';
  let sawNotFound = false;

  for (const url of rdapEndpoints(domain)) {
    try {
      const { ok, status, data } = await fetchJson(url);

      if (status === 404 || status === 4040) {
        sawNotFound = true;
        continue;
      }

      if (!ok || !data) {
        lastError = `RDAP HTTP ${status}`;
        continue;
      }

      const created = pickCreated(data.events);
      const ageYears = yearsBetween(created);
      const statusList = Array.isArray(data.status)
        ? data.status.map((s) => String(s).toLowerCase())
        : [];

      // Любая запись в RDAP = домен в реестре (занят / redemption и т.п.)
      return {
        domain: data.ldhName || data.handle || domain,
        registered: true,
        created: created ? created.toISOString() : null,
        ageYears,
        status: statusList,
        dnsLive,
        dnsDelegated: dnsProbe.delegated,
        dnsNote: dnsProbe.note,
        source: url,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  // RDAP says not found everywhere
  if (sawNotFound) {
    if (dnsLive) {
      return {
        domain,
        registered: true,
        created: null,
        ageYears: null,
        dnsLive: true,
        dnsDelegated: dnsProbe.delegated,
        dnsNote: dnsProbe.note,
        source: 'dns',
        note: dnsProbe.note || 'RDAP 404, но DNS/делегирование есть — считаем занятым',
      };
    }
    return {
      domain,
      registered: false,
      created: null,
      ageYears: null,
      dnsLive: false,
      dnsDelegated: false,
      source: 'rdap-404',
    };
  }

  // Unknown RDAP, but DNS up → occupied
  if (dnsLive) {
    return {
      domain,
      registered: true,
      created: null,
      ageYears: null,
      dnsLive: true,
      dnsDelegated: dnsProbe.delegated,
      dnsNote: dnsProbe.note,
      source: 'dns',
      note: dnsProbe.note || undefined,
      error: lastError || undefined,
    };
  }

  return {
    domain,
    registered: null,
    created: null,
    ageYears: null,
    dnsLive: false,
    dnsDelegated: false,
    error: lastError || 'RDAP недоступен',
  };
}

module.exports = { lookupDomain, yearsBetween, parseDate, hasDnsRecords, probeDns };
