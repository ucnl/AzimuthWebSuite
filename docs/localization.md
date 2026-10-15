# Localization

The main application uses synchronous classic scripts in `localization/`: `i18n.js` is the runtime and `languages.js` contains a readable translation matrix. Direct `file://` opening needs no server or build step. Only the home bar and Settings contain language selectors.

A supported explicit choice saved in `azimuth_language` takes priority. Otherwise the primary browser language selects Russian when its base is `ru`; all other or unavailable languages select English. Region tags such as `ru-RU` and `en-US` are supported. Automatic detection is not saved. Missing translations fall back to English, and unknown keys remain visible.

## Add a language

In `localization/languages.js`, append the language code and native name to the header:

```js
const languages = [['ru', 'Русский'], ['en', 'English'], ['de', 'Deutsch']];
```

Add its translation as the third value in each applicable row:

```js
"main.language": ["Язык", "Language", "Sprache"],
"main.settings": ["⚙ Настройки", "⚙ Settings", "⚙ Einstellungen"],
```

Column order follows the header. Rows with no third value use English. Keep named placeholders such as `{count}` and `{address}` unchanged. Selectors list the new language automatically; no application-code or script-list edits are required. Bump `CACHE_REVISION` in `sw.js` when distributing changed catalogs to installed PWAs.

Alternatively, create `localization/de.js` with a flat registration:

```js
I18n.registerLanguage('de', 'Deutsch', {
    'main.language': 'Sprache',
    'main.settings': '⚙ Einstellungen'
});
```

Load that script in `index.html` after `localization/languages.js` and before business scripts. Add its path to `sw.js`'s `ASSETS` and bump the cache revision. Partial registrations use English for missing keys.

## Standalone tools

Each HTML file in `tools/` contains its own first `script data-localization` block with the same language-header/translation-matrix format. Edit that tool's header and columns independently. Each tool has one selector and its own saved-choice key: `azimuth_coord_language` or `azimuth_logparser_language`. Tools use the same browser default and English fallback, and need no main-app scripts, manifest or service worker.

## Presentation rules

Use semantic keys with `I18n.t(key, params)` for text, `I18n.html(key, params)` for escaped HTML text/quoted attributes, and `I18n.message(key, params)` for retained status descriptors. Translation values are plain text. Originally English labels remain English in both built-in columns. User text, native errors, device data and machine-readable exports retain their values.

`bindText(element, key, params)` replaces a dynamic text binding; `unbindText(element)` releases it before clearing or inserting raw data. Static leaf labels use `data-i18n`; attributes use `data-i18n-title`, `data-i18n-placeholder`, `data-i18n-aria-label` or `data-i18n-data-empty-label`. Optional `data-i18n-params` supplies a JSON object.

Call `I18n.apply(container)` after inserting marked content in the main app. Its runtime uses explicit application rather than observing DOM mutations. Render other generated presentation from existing state on `languagechange`, preserving connections, reports, input values, wizard steps and calibration. `setLanguage(code)` saves an explicit selection; `getLanguage()` reads the active code, and `init()` is idempotent.

## Local checks

Local tests and evidence live in ignored `work/`. Run `node --test work/tests/*.test.js`, `node --check localization/i18n.js`, `node --check localization/languages.js` and `git diff --check`. The checks retain baseline translation values, placeholder parity, storage/default behavior, partial added languages, live presentation state, standalone tools and precache paths. Browser checks should include direct file opening and installed-PWA language changes.
