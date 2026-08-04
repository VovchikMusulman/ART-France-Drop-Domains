const NOISE_DOMAINS = new Set([
  'facebook.com',
  'fb.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  't.co',
  'linkedin.com',
  'youtube.com',
  'youtu.be',
  'google.com',
  'google.ru',
  'googleapis.com',
  'gstatic.com',
  'wikipedia.org',
  'wikimedia.org',
  'pinterest.com',
  'pinimg.com',
  'tiktok.com',
  'vk.com',
  'ok.ru',
  'telegram.org',
  't.me',
  'whatsapp.com',
  'apple.com',
  'microsoft.com',
  'office.com',
  'live.com',
  'yandex.ru',
  'yandex.com',
  'ya.ru',
  'mail.ru',
  'cdninstagram.com',
  'doubleclick.net',
  'googletagmanager.com',
  'google-analytics.com',
  'g.page',
  'bit.ly',
  'goo.gl',
]);

function rootDomain(hostname) {
  const host = String(hostname || '')
    .toLowerCase()
    .replace(/^www\./, '')
    .split('/')[0]
    .split(':')[0]
    .trim();
  if (!host) return '';
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  const multi = new Set(['co.uk', 'com.au', 'co.jp', 'com.br', 'co.za', 'com.tr']);
  const last2 = parts.slice(-2).join('.');
  if (multi.has(last2) && parts.length >= 3) return parts.slice(-3).join('.');
  return last2;
}

function extractDomainFromUrl(urlOrHost) {
  try {
    const raw = String(urlOrHost || '').trim();
    if (!raw) return '';
    if (raw.includes('://')) {
      return rootDomain(new URL(raw).hostname);
    }
    return rootDomain(raw);
  } catch {
    return rootDomain(urlOrHost);
  }
}

function isNoiseDomain(domain, sourceDomain = '') {
  const d = rootDomain(domain);
  const src = rootDomain(sourceDomain);
  if (!d) return true;
  if (src && d === src) return true;
  if (NOISE_DOMAINS.has(d)) return true;
  for (const noise of NOISE_DOMAINS) {
    if (d.endsWith(`.${noise}`)) return true;
  }
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  NOISE_DOMAINS,
  rootDomain,
  extractDomainFromUrl,
  isNoiseDomain,
  sleep,
};
