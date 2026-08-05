const net = require('node:net');
const { extractDomainFromUrl } = require('./utils.cjs');

/**
 * Authoritative WHOIS hosts for common drop TLDs.
 * Query format follows each registry's convention.
 */
function whoisTarget(domain) {
  const d = domain.toLowerCase();
  if (d.endsWith('.ru') || d.endsWith('.su')) {
    return { host: 'whois.tcinet.ru', query: domain };
  }
  if (d.endsWith('.рф') || d.endsWith('.xn--p1ai')) {
    return { host: 'whois.tcinet.ru', query: domain };
  }
  if (d.endsWith('.com') || d.endsWith('.net')) {
    return { host: 'whois.verisign-grs.com', query: domain };
  }
  if (d.endsWith('.org')) {
    return { host: 'whois.pir.org', query: domain };
  }
  if (d.endsWith('.info')) {
    return { host: 'whois.nic.info', query: domain };
  }
  if (d.endsWith('.biz')) {
    return { host: 'whois.nic.biz', query: domain };
  }
  if (d.endsWith('.name')) {
    return { host: 'whois.nic.name', query: domain };
  }
  if (d.endsWith('.io')) {
    return { host: 'whois.nic.io', query: domain };
  }
  if (d.endsWith('.co')) {
    return { host: 'whois.nic.co', query: domain };
  }
  if (d.endsWith('.me')) {
    return { host: 'whois.nic.me', query: domain };
  }
  if (d.endsWith('.tv')) {
    return { host: 'whois.nic.tv', query: domain };
  }
  if (d.endsWith('.cc')) {
    return { host: 'whois.nic.cc', query: domain };
  }
  if (d.endsWith('.pro')) {
    return { host: 'whois.nic.pro', query: domain };
  }
  if (d.endsWith('.online')) {
    return { host: 'whois.nic.online', query: domain };
  }
  if (d.endsWith('.site')) {
    return { host: 'whois.nic.site', query: domain };
  }
  if (d.endsWith('.store')) {
    return { host: 'whois.nic.store', query: domain };
  }
  if (d.endsWith('.xyz')) {
    return { host: 'whois.nic.xyz', query: domain };
  }
  if (d.endsWith('.top')) {
    return { host: 'whois.nic.top', query: domain };
  }
  if (d.endsWith('.club')) {
    return { host: 'whois.nic.club', query: domain };
  }
  return null;
}

function queryWhois(host, query, { timeoutMs = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port: 43, host }, () => {
      socket.write(`${query}\r\n`);
    });
    let data = '';
    socket.setEncoding('utf8');
    socket.setTimeout(timeoutMs);
    socket.on('data', (chunk) => {
      data += chunk;
      if (data.length > 200_000) {
        socket.destroy();
        reject(new Error('WHOIS: слишком большой ответ'));
      }
    });
    socket.on('end', () => resolve(data));
    socket.on('close', () => {
      if (data) resolve(data);
    });
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error(`WHOIS timeout (${host})`));
    });
    socket.on('error', reject);
  });
}

async function queryWhoisWithRetry(host, query, attempts = 2) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await queryWhois(host, query, { timeoutMs: 3500 + i * 1500 });
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 200 * (i + 1)));
      }
    }
  }
  throw lastErr;
}

const AVAILABLE_RE =
  /no\s+match|not\s+found|no\s+entries\s+found|no\s+data\s+found|status:\s*free|is\s+available|no\s+object\s+found|nothing\s+found|domain\s+not\s+found|not\s+registered|no\s+whois|queried\s+object\s+does\s+not\s+exist/i;

const REGISTERED_RE =
  /^(?:domain(?:\s+name)?|nserver|name\s*server|registrar|created|creation\s+date|registered|registrant|org(?:anization)?|paid-till|free-date|source:\s*TCI)\s*:/im;

/**
 * @returns {'available'|'registered'|'unknown'}
 */
function parseAvailability(text, domain) {
  const raw = String(text || '').trim();
  if (!raw) return 'unknown';

  const lower = raw.toLowerCase();

  // Nic.name sometimes returns only a Verisign legal disclaimer — not a real answer
  if (
    /disclaimer:\s*verisign/i.test(raw) &&
    !/domain\s+name:/i.test(raw) &&
    !/no\s+match/i.test(lower) &&
    !/^domain:/im.test(raw)
  ) {
    return 'unknown';
  }

  if (AVAILABLE_RE.test(lower)) {
    const hasStrongRegistration =
      /domain\s+name:\s*\S+/i.test(raw) &&
      /registrar:/i.test(raw) &&
      !/no\s+match/i.test(lower);
    if (!hasStrongRegistration) return 'available';
  }

  if (REGISTERED_RE.test(raw)) return 'registered';

  if (/registrar whois server:/i.test(raw) && new RegExp(domain.replace(/\./g, '\\.'), 'i').test(raw)) {
    return 'registered';
  }

  if (/^domain:\s+/im.test(raw) && /^nserver:\s+/im.test(raw)) return 'registered';
  if (/^domain:\s+/im.test(raw) && /^state:\s+/im.test(raw)) return 'registered';

  return 'unknown';
}

function pickCreatedFromWhois(text) {
  const patterns = [
    /created:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i,
    /creation date:\s*([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z?)/i,
    /creation date:\s*([0-9]{2}-[a-z]{3}-[0-9]{4})/i,
    /created on:\s*([^\r\n]+)/i,
    /registration time:\s*([^\r\n]+)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const d = new Date(m[1]);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/**
 * Classic WHOIS availability. Prefer this over RDAP 404 for "is it free?".
 */
async function checkWhoisAvailability(domainRaw) {
  const domain = extractDomainFromUrl(domainRaw);
  if (!domain) {
    return { domain: '', availability: 'unknown', error: 'Пустой домен' };
  }

  const target = whoisTarget(domain);
  if (!target) {
    return {
      domain,
      availability: 'unknown',
      error: `Нет WHOIS-сервера для зоны ${domain.split('.').slice(-1)[0]}`,
      source: null,
    };
  }

  try {
    const text = await queryWhoisWithRetry(target.host, target.query);
    const availability = parseAvailability(text, domain);
    const created = pickCreatedFromWhois(text);
    return {
      domain,
      availability,
      created: created ? created.toISOString() : null,
      source: `whois://${target.host}`,
      rawPreview: text.slice(0, 500),
    };
  } catch (err) {
    return {
      domain,
      availability: 'unknown',
      error: err instanceof Error ? err.message : String(err),
      source: `whois://${target.host}`,
    };
  }
}

module.exports = {
  checkWhoisAvailability,
  whoisTarget,
  parseAvailability,
  queryWhois,
};
