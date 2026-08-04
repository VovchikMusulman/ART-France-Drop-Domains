/** Регионы Yandex Search API (lr)
 * @see https://aistudio.yandex.ru/docs/ru/search-api/reference/regions.html
 */

const YANDEX_COUNTRIES = [
  { id: 225, name: 'Россия' },
  { id: 187, name: 'Украина' },
  { id: 149, name: 'Беларусь' },
  { id: 159, name: 'Казахстан' },
];

const YANDEX_CITIES = [
  { id: 20, name: 'Архангельск' },
  { id: 37, name: 'Астрахань' },
  { id: 197, name: 'Барнаул' },
  { id: 4, name: 'Белгород' },
  { id: 77, name: 'Благовещенск' },
  { id: 191, name: 'Брянск' },
  { id: 24, name: 'Великий Новгород' },
  { id: 75, name: 'Владивосток' },
  { id: 33, name: 'Владикавказ' },
  { id: 192, name: 'Владимир' },
  { id: 38, name: 'Волгоград' },
  { id: 21, name: 'Вологда' },
  { id: 193, name: 'Воронеж' },
  { id: 1106, name: 'Грозный' },
  { id: 54, name: 'Екатеринбург' },
  { id: 5, name: 'Иваново' },
  { id: 63, name: 'Иркутск' },
  { id: 41, name: 'Йошкар-Ола' },
  { id: 43, name: 'Казань' },
  { id: 22, name: 'Калининград' },
  { id: 64, name: 'Кемерово' },
  { id: 7, name: 'Кострома' },
  { id: 35, name: 'Краснодар' },
  { id: 62, name: 'Красноярск' },
  { id: 53, name: 'Курган' },
  { id: 8, name: 'Курск' },
  { id: 9, name: 'Липецк' },
  { id: 28, name: 'Махачкала' },
  { id: 1, name: 'Москва и Московская область' },
  { id: 213, name: 'Москва' },
  { id: 23, name: 'Мурманск' },
  { id: 1092, name: 'Назрань' },
  { id: 30, name: 'Нальчик' },
  { id: 47, name: 'Нижний Новгород' },
  { id: 65, name: 'Новосибирск' },
  { id: 66, name: 'Омск' },
  { id: 10, name: 'Орёл' },
  { id: 48, name: 'Оренбург' },
  { id: 49, name: 'Пенза' },
  { id: 50, name: 'Пермь' },
  { id: 25, name: 'Псков' },
  { id: 39, name: 'Ростов-на-Дону' },
  { id: 11, name: 'Рязань' },
  { id: 51, name: 'Самара' },
  { id: 2, name: 'Санкт-Петербург' },
  { id: 42, name: 'Саранск' },
  { id: 12, name: 'Смоленск' },
  { id: 239, name: 'Сочи' },
  { id: 36, name: 'Ставрополь' },
  { id: 973, name: 'Сургут' },
  { id: 13, name: 'Тамбов' },
  { id: 14, name: 'Тверь' },
  { id: 67, name: 'Томск' },
  { id: 15, name: 'Тула' },
  { id: 195, name: 'Ульяновск' },
  { id: 172, name: 'Уфа' },
  { id: 76, name: 'Хабаровск' },
  { id: 45, name: 'Чебоксары' },
  { id: 56, name: 'Челябинск' },
  { id: 1104, name: 'Черкесск' },
  { id: 16, name: 'Ярославль' },
];

const DEFAULT_YANDEX_REGION_ID = 213;

function findYandexRegion(id) {
  const n = Number(id);
  if (!Number.isFinite(n)) return null;
  return (
    YANDEX_COUNTRIES.find((r) => r.id === n) ||
    YANDEX_CITIES.find((r) => r.id === n) ||
    null
  );
}

function searchTypeForRegion(regionId) {
  const id = Number(regionId);
  if (id === 149) return 'SEARCH_TYPE_BE';
  if (id === 159) return 'SEARCH_TYPE_KK';
  // Украина и РФ / города — русский индекс
  return 'SEARCH_TYPE_RU';
}

module.exports = {
  YANDEX_COUNTRIES,
  YANDEX_CITIES,
  DEFAULT_YANDEX_REGION_ID,
  findYandexRegion,
  searchTypeForRegion,
};
