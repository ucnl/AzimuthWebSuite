/* Synchronous localization for classic scripts and direct file opening. */
(function (window, document) {
    'use strict';
    const languages = new Map(), bindings = new WeakMap(), selectors = new WeakSet();
    const attributes = ['title', 'placeholder', 'aria-label', 'data-empty-label'];
    const query = ['data-i18n', 'data-i18n-bound-text', 'data-language-selector',
        ...attributes.map(name => 'data-i18n-' + name)].map(name => '[' + name + ']').join(',');
    let language = 'en', initialized = false;

    function normalize(code) {
        if (typeof code !== 'string') return null;
        const normalized = code.trim().toLowerCase().replace(/_/g, '-');
        const base = normalized.split('-')[0];
        return languages.has(normalized) ? normalized : languages.has(base) ? base : null;
    }

    function registerLanguage(code, nativeName, messages) {
        if (typeof code !== 'string' || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(code)) {
            throw new TypeError('Invalid language code');
        }
        code = code.toLowerCase();
        const catalog = languages.get(code) || { messages: Object.create(null) };
        catalog.nativeName = String(nativeName);
        for (const [key, value] of Object.entries(messages || {})) {
            if (typeof value !== 'string') throw new TypeError('Translation must be a string: ' + key);
            catalog.messages[key] = value;
        }
        languages.set(code, catalog);
        if (initialized) apply(document);
    }

    function t(key, params = {}) {
        const text = languages.get(language)?.messages[key] ?? languages.get('en')?.messages[key] ?? String(key);
        return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) =>
            Object.prototype.hasOwnProperty.call(params || {}, name) ? String(params[name]) : match);
    }

    function html(key, params = {}) {
        return t(key, params).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    }

    function message(key, params = {}) { return { key, params: { ...params } }; }

    function bindText(element, key, params = {}) {
        if (!element) return;
        bindings.set(element, message(key, params));
        element.removeAttribute('data-i18n');
        element.removeAttribute('data-i18n-params');
        element.setAttribute('data-i18n-bound-text', '');
        element.textContent = t(key, params);
    }

    function unbindText(element) {
        if (!element) return;
        bindings.delete(element);
        element.removeAttribute('data-i18n-bound-text');
    }

    function parameters(element) {
        try {
            const value = JSON.parse(element.getAttribute('data-i18n-params') || '{}');
            return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        } catch (_) { return {}; }
    }

    function updateSelector(element) {
        element.replaceChildren(...Array.from(languages, ([code, catalog]) => {
            const option = document.createElement('option');
            option.value = code;
            option.textContent = catalog.nativeName;
            return option;
        }));
        if (!selectors.has(element)) element.addEventListener('change', () => setLanguage(element.value));
        selectors.add(element);
        element.value = language;
    }

    function apply(root = document) {
        const elements = root.nodeType === 1 ? [root] : [];
        if (root.querySelectorAll) elements.push(...root.querySelectorAll(query));
        for (const element of elements) {
            const params = parameters(element), binding = bindings.get(element);
            if (binding) element.textContent = t(binding.key, binding.params);
            else if (element.hasAttribute('data-i18n')) element.textContent = t(element.getAttribute('data-i18n'), params);
            for (const attr of attributes) {
                const key = element.getAttribute('data-i18n-' + attr);
                if (key) element.setAttribute(attr, t(key, params));
            }
            if (element.hasAttribute('data-language-selector')) updateSelector(element);
        }
    }

    function setLanguage(code, persist = true) {
        const next = normalize(code) || 'en', changed = next !== language;
        language = next;
        if (persist) {
            try { window.localStorage.setItem('azimuth_language', language); } catch (_) { /* Storage is optional. */ }
        }
        document.documentElement.lang = language;
        apply(document);
        if (changed) window.dispatchEvent(new window.CustomEvent('languagechange', { detail: { language } }));
        return language;
    }

    function init() {
        if (initialized) return;
        let saved = null;
        try { saved = window.localStorage.getItem('azimuth_language'); } catch (_) { /* Storage is optional. */ }
        const primary = window.navigator?.language || window.navigator?.languages?.[0] || '';
        initialized = true;
        setLanguage(normalize(saved) || (/^ru(?:[-_]|$)/i.test(primary) ? 'ru' : 'en'), false);
    }

    window.I18n = { registerLanguage, t, html, message, bindText, unbindText, apply, setLanguage, getLanguage: () => language, init };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})(window, document);
