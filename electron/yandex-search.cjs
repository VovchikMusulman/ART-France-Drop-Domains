const {
  DEFAULT_YANDEX_REGION_ID,
  findYandexRegion,
  searchTypeForRegion,
} = require('./yandex-regions.cjs');
const { sleep } = require('./utils.cjs');

const WEB_SEARCH_URL = 'https://searchapi.api.cloud.yandex.net/v2/web/search';
const WEB_SEARCH_ASYNC_URL = 'https://searchapi.api.cloud.yandex.net/v2/web/searchAsync';
const OPERATIONS_URL = 'https://operation.api.cloud.yandex.net/operations/';

function stripTags(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseOrganicFromXml(xml, num) {
  const results = [];
  const docRe = /<doc\b[^>]*>([\s\S]*?)<\/doc>/gi;
  let match;
  while ((match = docRe.exec(xml)) && results.length < num) {
    const block = match[1];
    const urlMatch = block.match(/<url>([\s\S]*?)<\/url>/i);
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/i);
    const passageMatch = block.match(/<passage>([\s\S]*?)<\/passage>/i);
    const link = stripTags(urlMatch?.[1] || '');
    if (!link || !/^https?:\/\//i.test(link)) continue;
    results.push({
      position: results.length + 1,
      title: stripTags(titleMatch?.[1] || ''),
      link,
      snippet: stripTags(passageMatch?.[1] || ''),
    });
  }
  return results;
}

function buildSearchBody({ folderId, query, num, regionId }) {
  const searchType = searchTypeForRegion(regionId);
  return {
    query: {
      searchType,
      queryText: query,
      familyMode: 'FAMILY_MODE_NONE',
      page: 0,
      fixTypoMode: 'FIX_TYPO_MODE_ON',
    },
    sortSpec: {
      sortMode: 'SORT_MODE_BY_RELEVANCE',
      sortOrder: 'SORT_ORDER_DESC',
    },
    groupSpec: {
      groupMode: 'GROUP_MODE_DEEP',
      groupsOnPage: Math.max(1, Math.min(50, num)),
      docsInGroup: 1,
    },
    maxPassages: 2,
    region: String(regionId),
    l10n: 'LOCALIZATION_RU',
    folderId,
    responseFormat: 'FORMAT_XML',
  };
}

async function decodeRawData(payload) {
  const raw = payload?.rawData || payload?.response?.rawData;
  if (!raw) return '';
  return Buffer.from(raw, 'base64').toString('utf8');
}

async function searchSync(apiKey, body) {
  const res = await fetch(WEB_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Api-Key ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Yandex Search: не JSON (HTTP ${res.status})`);
  }
  if (!res.ok) {
    throw new Error(
      json?.message || json?.error || json?.details?.[0]?.message || `Yandex Search HTTP ${res.status}`
    );
  }
  return decodeRawData(json);
}

async function searchAsync(apiKey, body) {
  const startRes = await fetch(WEB_SEARCH_ASYNC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Api-Key ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const startText = await startRes.text();
  let startJson = null;
  try {
    startJson = startText ? JSON.parse(startText) : null;
  } catch {
    throw new Error(`Yandex Search Async: не JSON (HTTP ${startRes.status})`);
  }
  if (!startRes.ok) {
    throw new Error(
      startJson?.message ||
        startJson?.error ||
        startJson?.details?.[0]?.message ||
        `Yandex Search Async HTTP ${startRes.status}`
    );
  }
  const opId = startJson?.id;
  if (!opId) throw new Error('Yandex Search: нет id операции');

  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    await sleep(1000);
    const pollRes = await fetch(`${OPERATIONS_URL}${encodeURIComponent(opId)}`, {
      headers: { Authorization: `Api-Key ${apiKey}` },
      signal: AbortSignal.timeout(20000),
    });
    const pollText = await pollRes.text();
    let pollJson = null;
    try {
      pollJson = pollText ? JSON.parse(pollText) : null;
    } catch {
      continue;
    }
    if (!pollRes.ok) continue;
    if (pollJson?.done) {
      if (pollJson?.error) {
        throw new Error(
          pollJson.error.message || pollJson.error.code || 'Yandex Search: ошибка операции'
        );
      }
      return decodeRawData(pollJson.response || pollJson);
    }
  }
  throw new Error('Yandex Search: таймаут ожидания результата');
}

/**
 * Топ органики через Yandex Search API v2.
 * @see https://aistudio.yandex.ru/docs/ru/search-api/concepts/
 */
async function searchOrganicYandex({ apiKey, folderId, query, num = 5, regionId = DEFAULT_YANDEX_REGION_ID }) {
  const key = String(apiKey || '').trim();
  const folder = String(folderId || '').trim();
  const q = String(query || '').trim();
  const region = Number(regionId) || DEFAULT_YANDEX_REGION_ID;

  if (!key) throw new Error('Укажите Yandex API key в настройках');
  if (!folder) throw new Error('Укажите Yandex Folder ID в настройках');
  if (!q) throw new Error('Введите поисковый запрос');

  const body = buildSearchBody({ folderId: folder, query: q, num, regionId: region });

  let xml = '';
  try {
    xml = await searchSync(key, body);
  } catch (syncErr) {
    // Часть аккаунтов / квот работает только через async
    try {
      xml = await searchAsync(key, body);
    } catch (asyncErr) {
      const syncMsg = syncErr instanceof Error ? syncErr.message : String(syncErr);
      const asyncMsg = asyncErr instanceof Error ? asyncErr.message : String(asyncErr);
      throw new Error(`Yandex Search: ${asyncMsg || syncMsg}`);
    }
  }

  if (!xml) throw new Error('Yandex Search: пустой ответ');
  const organic = parseOrganicFromXml(xml, num);
  const regionMeta = findYandexRegion(region);
  return {
    organic,
    regionId: region,
    regionName: regionMeta?.name || String(region),
  };
}

module.exports = { searchOrganicYandex, parseOrganicFromXml };
