(function(root) {
  'use strict';

  var dict = {
    ru: {
      'ui.sidebar.sources': 'Источники',
      'ui.sidebar.liveStats': 'Живая статистика',
      'ui.sidebar.filter': 'Фильтр',
      'ui.sidebar.savedFilters': 'Сохранённые фильтры',
      'ui.sidebar.highlights': 'Выделение ключевых слов',
      'ui.sidebar.controls': 'Управление',
      'ui.sidebar.theme': 'Тема',
      'ui.sidebar.resizerAria': 'Изменить ширину панели',

      'ui.stats.total': 'Всего',
      'ui.stats.visible': 'Видно',
      'ui.stats.errors': 'Ошибки',
      'ui.stats.warns': 'Предупреждения',

      'ui.filter.placeholder': 'Фильтровать логи…',
      'ui.filter.clearAria': 'Очистить фильтр',
      'ui.filter.regex': 'Регулярное выражение',
      'ui.filter.case': 'Учитывать регистр',
      'ui.filter.invert': 'Инвертировать',
      'ui.filter.level.error': 'Ошибки',
      'ui.filter.level.warn': 'Предупреждения',
      'ui.filter.level.info': 'Инфо',
      'ui.filter.level.debug': 'Отладка',

      'ui.savedFilters.namePlaceholder': 'Имя фильтра…',
      'ui.savedFilters.saveAria': 'Сохранить текущий фильтр',
      'ui.savedFilters.saveTitle': 'Сохранить текущий фильтр',
      'ui.savedFilters.deleteAria': 'Удалить сохранённый фильтр',

      'ui.highlights.inputPlaceholder': 'Добавить слово…',
      'ui.highlights.addAria': 'Добавить выделение',
      'ui.highlights.removeAria': 'Удалить выделение',

      'ui.controls.pauseAria': 'Пауза / Продолжить',
      'ui.controls.pauseLabelPause': 'Пауза',
      'ui.controls.pauseLabelResume': 'Продолжить',
      'ui.controls.clear': 'Очистить',
      'ui.controls.wrap': 'Перенос',
      'ui.controls.timestamp': 'Время',
      'ui.controls.colors': 'Подсветка',
      'ui.controls.readFromStart': 'Старт',
      'ui.controls.startLines': 'Задать X',
      'ui.controls.download': 'Скачать',
      'ui.controls.clearAria': 'Очистить логи',
      'ui.controls.wrapAria': 'Переключить перенос строк',
      'ui.controls.timestampAria': 'Переключить временные метки',
      'ui.controls.colorsAria': 'Переключить подсветку логов',
      'ui.controls.readFromStartAria': 'Читать с начала файла',
      'ui.controls.readStartXAria': 'Читать последние 1000 строк',
      'ui.controls.readStartLabel': 'Старт 1000',
      'ui.controls.startLinesAria': 'Задать, сколько строк загружает «Старт X»',
      'ui.controls.startLabel': 'Старт-X',
      'ui.controls.readStartXAriaN': 'Читать последние {n} строк',
      'ui.controls.startXTitle': 'Загрузить только последние {n} строк',
      'ui.controls.startLinesTitle': 'Сколько строк загружает «Старт X» (сейчас {n})',
      'ui.controls.downloadAria': 'Скачать лог-файл',
      'ui.controls.downloadSanitizedAria': 'Скачать лог-файл без ANSI-цветов',
      'ui.controls.downloadSanitizedLabel': 'Без цветов',
      'ui.controls.downloadFilteredAria': 'Скачать видимые строки',
      'ui.controls.downloadFilteredLabel': 'Отфильтрованные',

      'ui.theme.dark': 'Тёмная',
      'ui.theme.light': 'Светлая',
      'ui.theme.solar': 'Соляр',
      'ui.status.connected': 'Подключено',
      'ui.status.disconnected': 'Отключено',
      'ui.status.connectionError': 'Ошибка соединения',
      'ui.status.reconnecting': 'Переподключение…',

      'ui.connection.connecting': 'Подключение…',
      'ui.connection.connected': 'Подключено',
      'ui.connection.disconnected': 'Отключено',
      'ui.connection.error': 'Ошибка подключения',
      'ui.connection.reconnecting': 'Переподключение…',

      'ui.empty.title': 'Ожидание логов…',
      'ui.empty.subtitle': 'Строки появятся здесь при поступлении.',
      'ui.empty.scrollAria': 'Прокрутить вниз',

      'ui.updateBanner.title': 'Доступна новая версия.',
      'ui.updateBanner.refresh': 'Обновить',
      'ui.updateBanner.dismissAria': 'Закрыть',

      'ui.modal.largeFile.title': 'Обнаружен большой файл',
      'ui.modal.largeFile.body': 'Этот файл превышает 50 МБ. Загрузка может занять время и использовать много памяти.',
      'ui.modal.largeFile.cancel': 'Отмена',
      'ui.modal.largeFile.loadAnyway': 'Загрузить в любом случае',
      'ui.modal.largeFile.download': 'Скачать файл',

      'ui.toast.filterApplied': 'Применён фильтр «{name}»',
      'ui.toast.filterTypeFirst': 'Введите фильтр перед сохранением',
      'ui.toast.filterUpdated': 'Фильтр «{name}» обновлён',
      'ui.toast.filterSaved': 'Фильтр «{name}» сохранён',
      'ui.toast.nothingToDownload': 'Нечего скачивать — нет видимых строк',
      'ui.toast.downloadedLines': 'Скачано {count} видимых строк',
      'ui.toast.ansiSkipped': '"{source}" уже содержит ANSI-цвета — автоопределение цветов пропущено для этих строк',
      'ui.toast.bipWord': 'Bip: слово → следующее',
      'ui.toast.alreadyHighlighting': 'Уже выделяется: {word}',
      'ui.toast.highlighting': 'Выделение: {word}',
      'ui.toast.paused': 'Приостановлено — накапливаются новые строки',
      'ui.toast.resumed': 'Поток возобновлён',
      'ui.toast.cleared': 'Лог очищен',
      'ui.toast.wrapOn': 'Перенос строк включён',
      'ui.toast.wrapOff': 'Перенос строк выключен',
      'ui.toast.wrapTrimmed': 'Перенос включён: показываю последние {n} строк, иначе вкладка повисает',
      'ui.toast.timestampsOn': 'Временные метки показаны',
      'ui.toast.timestampsOff': 'Временные метки скрыты',
      'ui.toast.colorsOn': 'Подсветка логов включена',
      'ui.toast.colorsOff': 'Подсветка логов выключена',
      'ui.toast.downloadingContainer': 'Скачивание логов контейнера…',
      'ui.toast.downloadingJournal': 'Скачивание журнала…',
      'ui.toast.downloadingRemote': 'Скачивание удалённого файла…',
      'ui.toast.downloadingFile': 'Скачивание файла…',
      'ui.toast.downloadingSanitized': 'Скачивание без цветов…',
      'ui.toast.fileSize': 'Размер файла: {bytes}',
      'ui.toast.loadingFull': 'Загрузка всего файла… это может занять время',
      'ui.toast.requestingLogs': 'Запрос логов…',
      'ui.toast.loadingLastN': 'Загрузка последних {n} строк…',
      'ui.toast.startXUpdated': '«Старт X» теперь загружает последние {n} строк',
      'ui.toast.startXRange': 'Введите число от 1 до 1000000',
      'ui.toast.themeChanged': 'Тема: {theme}',

      'ui.bip.off': '🔕 Выкл',
      'ui.bip.first': '🔔 Первое',
      'ui.bip.each': '🔔 Каждое',
      'ui.bip.toggle': 'Переключить bip',
      'ui.bip.title': 'Режим bip: {mode}',

      'ui.topbar.filterActive': 'Активен фильтр — показана часть строк',
      'ui.topbar.menuAria': 'Меню',
      'ui.topbar.menuTitle': 'Меню / Показать боковую панель',

      'ui.ansiBadge.title': 'Этот источник уже содержит ANSI-коды цвета — автоопределение форматов пропущено для этих строк',
      'ui.ansiBadge.mixed': 'Смешанные цвета',
      'ui.ansiBadge.ansi': 'ANSI цвета',

      'ui.sourceChip.all': 'Все',
      'ui.topbar.allSources': 'Все источники',
      'ui.topbar.skipped': 'пропущено',

      'ui.modal.setX.title': 'Задать количество строк для «Старт X»',
      'ui.modal.setX.hint': 'Допустимый диапазон: 1–1000000',
      'ui.modal.setX.save': 'Сохранить',
      'ui.modal.setX.cancel': 'Отмена',

      'ui.settings.title': 'Настройки',
      'ui.settings.defaultX.label': 'X по умолчанию',
      'ui.settings.defaultX.hint': 'Количество строк для «Старт X» (1–1000000)',
      'ui.settings.language.label': 'Язык',
      'ui.settings.language.auto': 'Авто (по браузеру)',
      'ui.settings.language.ru': 'Русский',
      'ui.settings.language.en': 'English',
      'ui.settings.logDirsTitle': 'Подключённые каталоги',
      'ui.settings.logDirsRefresh': 'Обновить',
      'ui.settings.logDirsHint': 'Файлы в этих каталогах можно включить или отключить. Отключённые не показываются в списке источников.',
      'ui.settings.logDirsEmpty': 'Каталоги не подключены',
      'ui.settings.logDirsCount': '{n} файлов',
      'ui.settings.save': 'Сохранить',
      'ui.settings.cancel': 'Отмена',
      'ui.settings.reset': 'Сбросить',

      'ui.toast.settingsSaved': 'Настройки сохранены',
      'ui.toast.logDirsRefreshed': 'Каталоги перечитаны: {n} файлов',
      'ui.toast.logDirsRefreshFailed': 'Не удалось перечитать каталоги: {message}',
      'ui.toast.disconnected': 'нет связи с сервером',
      'ui.toast.settingsReset': 'Настройки сброшены',
      'ui.toast.noSourcesSelected': 'Ни один источник не выбран — включите файлы в настройках',
      'ui.filter.all': 'Все',
      'ui.toast.bufferRange': 'Введите число от 100 до 1000000',
      'ui.settings.bufferLimit.label': 'Буфер лога',
      'ui.settings.bufferLimit.hint': 'Сколько строк держать в живой ленте (100–1000000)',
      'ui.sidebar.emptySources': 'Источники не выбраны — включите каталоги в настройках',
      'ui.toast.pausedShort': 'Приостановлено',
      'ui.toast.resumedShort': 'Продолжено',
      'ui.toast.streamingStart': 'Чтение лога с начала…',
      'ui.toast.historyDone': 'Загрузка истории завершена',

      'ui.live': 'LIVE',
      'ui.topbar.gearAria': 'Настройки',
      'ui.topbar.gearTitle': 'Настройки',

      'ui.copyright': '© {year} hbenali &mdash; <a href="https://github.com/hbenali/frontail" target="_blank" rel="noopener">GitHub</a> &mdash; <a href="https://github.com/sponsors/hbenali" target="_blank" rel="noopener">Sponsor</a>'
    },
    en: {
      'ui.sidebar.sources': 'Sources',
      'ui.sidebar.liveStats': 'Live Stats',
      'ui.sidebar.filter': 'Filter',
      'ui.sidebar.savedFilters': 'Saved Filters',
      'ui.sidebar.highlights': 'Highlight Keywords',
      'ui.sidebar.controls': 'Controls',
      'ui.sidebar.theme': 'Theme',
      'ui.sidebar.resizerAria': 'Resize sidebar',

      'ui.stats.total': 'Total',
      'ui.stats.visible': 'Visible',
      'ui.stats.errors': 'Errors',
      'ui.stats.warns': 'Warns',

      'ui.filter.placeholder': 'Filter logs…',
      'ui.filter.clearAria': 'Clear filter',
      'ui.filter.regex': 'Regex',
      'ui.filter.case': 'Case',
      'ui.filter.invert': 'Invert',
      'ui.filter.level.error': 'Error',
      'ui.filter.level.warn': 'Warn',
      'ui.filter.level.info': 'Info',
      'ui.filter.level.debug': 'Debug',

      'ui.savedFilters.namePlaceholder': 'Name this filter…',
      'ui.savedFilters.saveAria': 'Save current filter',
      'ui.savedFilters.saveTitle': 'Save current filter',
      'ui.savedFilters.deleteAria': 'Delete saved filter',

      'ui.highlights.inputPlaceholder': 'Add keyword…',
      'ui.highlights.addAria': 'Add highlight',
      'ui.highlights.removeAria': 'Remove highlight',

      'ui.controls.pauseAria': 'Pause/Resume',
      'ui.controls.pauseLabelPause': 'Pause',
      'ui.controls.pauseLabelResume': 'Resume',
      'ui.controls.clear': 'Clear',
      'ui.controls.wrap': 'Wrap',
      'ui.controls.timestamp': 'Time',
      'ui.controls.colors': 'Colors',
      'ui.controls.readFromStart': 'Start',
      'ui.controls.startLines': 'Set X',
      'ui.controls.download': 'Download',
      'ui.controls.clearAria': 'Clear logs',
      'ui.controls.wrapAria': 'Toggle word wrap',
      'ui.controls.timestampAria': 'Toggle timestamps',
      'ui.controls.colorsAria': 'Toggle log colorizing',
      'ui.controls.readFromStartAria': 'Read from file beginning',
      'ui.controls.readStartXAria': 'Read last 1000 lines',
      'ui.controls.readStartLabel': 'Start 1000',
      'ui.controls.startLinesAria': 'Set how many lines Start X loads',
      'ui.controls.startLabel': 'Start-X',
      'ui.controls.readStartXAriaN': 'Read last {n} lines',
      'ui.controls.startXTitle': 'Load only the last {n} lines',
      'ui.controls.startLinesTitle': 'How many lines Start X loads (now {n})',
      'ui.controls.downloadAria': 'Download log file',
      'ui.controls.downloadSanitizedAria': 'Download log file with ANSI colors stripped',
      'ui.controls.downloadSanitizedLabel': 'Sanitized',
      'ui.controls.downloadFilteredAria': 'Download currently visible lines',
      'ui.controls.downloadFilteredLabel': 'Filtered',

      'ui.theme.dark': 'Dark',
      'ui.theme.light': 'Light',
      'ui.theme.solar': 'Solar',
      'ui.status.connected': 'Connected',
      'ui.status.disconnected': 'Disconnected',
      'ui.status.connectionError': 'Connection error',
      'ui.status.reconnecting': 'Reconnecting…',

      'ui.connection.connecting': 'Connecting…',
      'ui.connection.connected': 'Connected',
      'ui.connection.disconnected': 'Disconnected',
      'ui.connection.error': 'Connection error',
      'ui.connection.reconnecting': 'Reconnecting…',

      'ui.empty.title': 'Waiting for log data…',
      'ui.empty.subtitle': 'Lines will appear here as they stream in.',
      'ui.empty.scrollAria': 'Scroll to bottom',

      'ui.updateBanner.title': 'A new version has been deployed.',
      'ui.updateBanner.refresh': 'Refresh',
      'ui.updateBanner.dismissAria': 'Dismiss',

      'ui.modal.largeFile.title': 'Large file detected',
      'ui.modal.largeFile.body': 'This file exceeds 50 MB. Loading may take a while and use a lot of memory.',
      'ui.modal.largeFile.cancel': 'Cancel',
      'ui.modal.largeFile.loadAnyway': 'Load anyway',
      'ui.modal.largeFile.download': 'Download file',

      'ui.toast.filterApplied': 'Applied filter "{name}"',
      'ui.toast.filterTypeFirst': 'Type a filter before saving',
      'ui.toast.filterUpdated': 'Updated saved filter "{name}"',
      'ui.toast.filterSaved': 'Saved filter "{name}"',
      'ui.toast.nothingToDownload': 'Nothing visible to download',
      'ui.toast.downloadedLines': 'Downloaded {count} visible lines',
      'ui.toast.ansiSkipped': '"{source}" already contains ANSI colors — autodetected format colorizing skipped for those lines',
      'ui.toast.bipWord': 'Bip: word → next',
      'ui.toast.alreadyHighlighting': 'Already highlighting: {word}',
      'ui.toast.highlighting': 'Highlighting: {word}',
      'ui.toast.paused': 'Paused — buffering new lines',
      'ui.toast.resumed': 'Resumed streaming',
      'ui.toast.cleared': 'Log cleared',
      'ui.toast.wrapOn': 'Word wrap on',
      'ui.toast.wrapOff': 'Word wrap off',
      'ui.toast.wrapTrimmed': 'Wrap on: showing the last {n} lines, more freezes the tab',
      'ui.toast.timestampsOn': 'Timestamps visible',
      'ui.toast.timestampsOff': 'Timestamps hidden',
      'ui.toast.colorsOn': 'Log colorizing on',
      'ui.toast.colorsOff': 'Log colorizing off',
      'ui.toast.downloadingContainer': 'Downloading container logs…',
      'ui.toast.downloadingJournal': 'Downloading journal…',
      'ui.toast.downloadingRemote': 'Downloading remote file…',
      'ui.toast.downloadingFile': 'Downloading file…',
      'ui.toast.downloadingSanitized': 'Downloading sanitized (colors stripped)…',
      'ui.toast.fileSize': 'File size: {bytes}',
      'ui.toast.loadingFull': 'Loading full file… this may take a moment',
      'ui.toast.requestingLogs': 'Requesting logs…',
      'ui.toast.loadingLastN': 'Loading the last {n} lines…',
      'ui.toast.startXUpdated': 'Start X now loads the last {n} lines',
      'ui.toast.startXRange': 'Enter a number between 1 and 1000000',
      'ui.toast.themeChanged': 'Theme: {theme}',

      'ui.bip.off': '🔕 Off',
      'ui.bip.first': '🔔 First',
      'ui.bip.each': '🔔 Each',
      'ui.bip.toggle': 'Toggle bip',
      'ui.bip.title': 'Bip mode: {mode}',

      'ui.topbar.filterActive': 'A filter is active — showing a subset of lines',
      'ui.topbar.menuAria': 'Menu',
      'ui.topbar.menuTitle': 'Menu / Show sidebar',

      'ui.ansiBadge.title': 'This source already contains ANSI color codes — autodetected format colorizing skipped for those lines',
      'ui.ansiBadge.mixed': 'Mixed colors',
      'ui.ansiBadge.ansi': 'ANSI colors',

      'ui.sourceChip.all': 'All',
      'ui.topbar.allSources': 'All sources',
      'ui.topbar.skipped': 'skipped',

      'ui.modal.setX.title': 'Set lines for "Start X"',
      'ui.modal.setX.hint': 'Allowed range: 1–1000000',
      'ui.modal.setX.save': 'Save',
      'ui.modal.setX.cancel': 'Cancel',

      'ui.settings.title': 'Settings',
      'ui.settings.defaultX.label': 'Default X',
      'ui.settings.defaultX.hint': 'Number of lines for "Start X" (1–1000000)',
      'ui.settings.language.label': 'Language',
      'ui.settings.language.auto': 'Auto (browser)',
      'ui.settings.language.ru': 'Русский',
      'ui.settings.language.en': 'English',
      'ui.settings.logDirsTitle': 'Connected directories',
      'ui.settings.logDirsRefresh': 'Refresh',
      'ui.settings.logDirsHint': 'Files in these directories can be enabled or disabled. Disabled files do not appear in the sources list.',
      'ui.settings.logDirsEmpty': 'No directories connected',
      'ui.settings.logDirsCount': '{n} files',
      'ui.settings.save': 'Save',
      'ui.settings.cancel': 'Cancel',
      'ui.settings.reset': 'Reset',

      'ui.toast.settingsSaved': 'Settings saved',
      'ui.toast.logDirsRefreshed': 'Directories re-read: {n} files',
      'ui.toast.logDirsRefreshFailed': 'Could not re-read the directories: {message}',
      'ui.toast.disconnected': 'not connected to the server',
      'ui.toast.settingsReset': 'Settings reset',
      'ui.toast.noSourcesSelected': 'No sources selected — tick files in the settings',
      'ui.filter.all': 'All',
      'ui.toast.bufferRange': 'Enter a number between 100 and 1000000',
      'ui.settings.bufferLimit.label': 'Log buffer',
      'ui.settings.bufferLimit.hint': 'Lines kept in the live view (100–1000000)',
      'ui.sidebar.emptySources': 'No sources selected — enable directories in settings',
      'ui.toast.pausedShort': 'Paused',
      'ui.toast.resumedShort': 'Resumed',
      'ui.toast.streamingStart': 'Streaming from the beginning…',
      'ui.toast.historyDone': 'Finished loading history',

      'ui.live': 'LIVE',
      'ui.topbar.gearAria': 'Settings',
      'ui.topbar.gearTitle': 'Settings',

      'ui.copyright': '© {year} hbenali &mdash; <a href="https://github.com/hbenali/frontail" target="_blank" rel="noopener">GitHub</a> &mdash; <a href="https://github.com/sponsors/hbenali" target="_blank" rel="noopener">Sponsor</a>'
    }
  };

  var currentLang = 'auto';
  var resolvedLang = 'en';
  var listeners = [];

  function resolveAuto() {
    var nav = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
    return nav.startsWith('ru') ? 'ru' : 'en';
  }

  function setLanguage(mode) {
    currentLang = mode;
    resolvedLang = mode === 'auto' ? resolveAuto() : mode;
    notify();
  }

  function getLanguage() {
    return currentLang;
  }

  function getResolvedLanguage() {
    return resolvedLang;
  }

  function t(key, params) {
    var langDict = dict[resolvedLang] || dict.en;
    var str = langDict[key] || key;
    // `{year}` is used by the copyright line, which is rendered through
    // applyToDOM() without parameters - default it so the placeholder
    // never reaches the page as literal text.
    var vars = Object.assign({ year: new Date().getFullYear() }, params || {});
    if (vars) {
      Object.keys(vars).forEach(function(k) {
        str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
      });
    }
    return str;
  }

  function onChange(cb) {
    listeners.push(cb);
    return function() {
      var idx = listeners.indexOf(cb);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }

  function notify() {
    listeners.forEach(function(cb) { cb(resolvedLang); });
  }

  function applyToDOM() {
    document.querySelectorAll('[data-i18n]').forEach(function(el) {
      var key = el.getAttribute('data-i18n');
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        var ph = t(key);
        if (ph) el.placeholder = ph;
      } else {
        el.innerHTML = t(key);
      }
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function(el) {
      var key = el.getAttribute('data-i18n-aria');
      el.setAttribute('aria-label', t(key));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function(el) {
      var key = el.getAttribute('data-i18n-title');
      el.setAttribute('title', t(key));
    });
  }

  var api = {
    t: t,
    setLanguage: setLanguage,
    getLanguage: getLanguage,
    getResolvedLanguage: getResolvedLanguage,
    onChange: onChange,
    applyToDOM: applyToDOM
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.FrontailI18n = api;
})(typeof window !== 'undefined' ? window : globalThis);