async function searchOrganic(apiKey, query, num = 5) {
  const key = String(apiKey || '').trim();
  const q = String(query || '').trim();
  if (!key) throw new Error('Укажите Serper API key в настройках');
  if (!q) throw new Error('Введите поисковый запрос');

  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q, num }),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Serper вернул не JSON (HTTP ${res.status})`);
  }

  if (!res.ok) {
    throw new Error(data?.message || data?.error || `Serper HTTP ${res.status}`);
  }

  const organic = Array.isArray(data.organic) ? data.organic : [];
  return organic.slice(0, num).map((item, index) => ({
    position: item.position || index + 1,
    title: item.title || '',
    link: item.link || '',
    snippet: item.snippet || '',
  }));
}

module.exports = { searchOrganic };
