const { searchOrganic: searchOrganicSerper } = require('./serper.cjs');
const { searchOrganicYandex } = require('./yandex-search.cjs');
const { DEFAULT_YANDEX_REGION_ID, findYandexRegion } = require('./yandex-regions.cjs');

/**
 * Единая точка поиска топ-N для пайплайна дропов.
 * @returns {Promise<{ organic: Array, provider: string, regionId?: number, regionName?: string }>}
 */
async function searchTopSources(options = {}) {
  const provider = String(options.searchProvider || 'serper').toLowerCase() === 'yandex' ? 'yandex' : 'serper';
  const query = options.query;
  const num = Number(options.num) > 0 ? Number(options.num) : 5;

  if (provider === 'yandex') {
    const result = await searchOrganicYandex({
      apiKey: options.yandexApiKey,
      folderId: options.yandexFolderId,
      query,
      num,
      regionId: options.yandexRegionId || DEFAULT_YANDEX_REGION_ID,
    });
    return {
      organic: result.organic,
      provider: 'yandex',
      regionId: result.regionId,
      regionName: result.regionName,
    };
  }

  const organic = await searchOrganicSerper(options.serperKey, query, num);
  return { organic, provider: 'serper' };
}

module.exports = {
  searchTopSources,
  DEFAULT_YANDEX_REGION_ID,
  findYandexRegion,
};
