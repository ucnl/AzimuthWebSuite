

# AzimuthWebSuite

**Web-приложение для работы с гидроакустической системой позиционирования Zima2 USBL.**

Полностью браузерное PWA (Progressive Web Application). Не требует установки, работает через Web Serial API. Заменяет десктопное приложение AzimuthSuite.

## Возможности

- **Подключение к Zima2 USBL** через последовательный порт (USB/RS-232/RS-422)
- **Подключение внешнего GNSS-компаса** (NMEA 0183) — второй последовательный порт
- **Топопривязка** — автоматическая через GNSS или ручной ввод координат и курса
- **Отображение маяков-ответчиков** в реальном времени — дистанция, азимут, глубина, сигнал, напряжение
- **Треки маяков и станции** с сохранением и экспортом
- **DH-фильтр** (Distance-Heading) и сглаживание для отсеивания выбросов
- **Калибровка углового смещения антенны** (φ)
- **Запись и воспроизведение логов** обмена с устройством
- **Анализ логов** — статистика маяков, детекция аномалий компаса
- **Экспорт данных:**
  - CSV (треки маяков и станции)
  - NMEA GGA (с hex-адресацией маяков)
  - NMEA PSIMSSB (эмуляция HiPAP)
  - KML (для Google Earth/QGIS)
- **Три темы оформления:** Indoor, Light (для яркого солнца), Dark Contrast
- **Адаптивный дизайн** — десктоп, планшет, телефон

## Использование

### Онлайн (GitHub Pages)

Откройте `https://docs.unavlab.com/AzimuthWebSuite/` в браузере Chrome/Edge.

### Локально

Скопируйте все файлы в папку и откройте `index.html` в браузере. Сервер не требуется.

### На Android

Используйте [UCNL Launcher](https://github.com/ucnl/UCNL_Launcher) — WebView-обёртку с поддержкой Web Serial API для Android-устройств.

## Поддерживаемые браузеры

- Google Chrome 89+
- Microsoft Edge 89+
- Opera 75+
- Другие браузеры на базе Chromium

> Firefox и Safari **не поддерживают** Web Serial API.

## Формат логов

Совместим с логами AzimuthSuite (C#). Можно загружать и проигрывать логи, присланные пользователями десктопной версии.

## Лицензия

[GNU GPL v3.0](https://github.com/ucnl/AzimuthWebSuite/blob/main/LICENSE)

## Ссылки

- [Документация Zima2](https://docs.unavlab.com/navigation_and_tracking_systems_ru.html#zima)
- [UCNL Launcher (Android WebView)](https://github.com/ucnl/UCNL_Launcher)
- [AzimuthSuite (десктоп)](https://github.com/ucnl/AzimuthConsole)

---

&copy; 2026 UC&NL