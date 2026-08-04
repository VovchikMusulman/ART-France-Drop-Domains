# ART France — Drop Domains

Десктоп-программа для подбора free drop-доменов: поиск конкурентов → исходящие ссылки → проверка занятости и метрик → good/bad. Внутри также модуль скриншотов Wayback Machine.

## Для сотрудников

1. Скачайте **`ART-France-Drop-Domains.exe`** из [Releases](../../releases)
2. Запустите файл двойным кликом (установка не нужна)
3. В **Настройках** вставьте ключи API (выдаёт руководитель) → вкладка **Дропы**: введите запрос и нажмите поиск

Chromium уже внутри `.exe` — отдельно ничего ставить не нужно. Ключи хранятся только локально на ПК.

## Для разработчиков

```bash
npm install
npm run browsers
npm run dev
```

Сборка portable `.exe`:

```bash
npm run pack
```

Готовый файл: `release/ART-France-Drop-Domains.exe`
