import en from "./en.json" with { type: "json" };
import zhCN from "./zh-CN.json" with { type: "json" };

const CATALOGS = { "zh-CN": zhCN, en };
export const LOCALES = Object.keys(CATALOGS);
/** Catalog the text is authored in; fills any key another catalog lacks. */
export const SOURCE_LOCALE = "zh-CN";
/** Shown to browsers whose languages are all unsupported. */
export const FALLBACK_LOCALE = "en";

let locale = FALLBACK_LOCALE;

/** Picks the first supported BCP 47 tag, matching on the primary language subtag ("en-GB" → "en"). */
export function negotiateLocale(requested = []) {
    for (const tag of requested) {
        const exact = LOCALES.find(
            (supported) => supported.toLowerCase() === tag.toLowerCase(),
        );
        if (exact) return exact;
        const language = tag.split("-")[0].toLowerCase();
        const partial = LOCALES.find(
            (supported) => supported.split("-")[0] === language,
        );
        if (partial) return partial;
    }
    return FALLBACK_LOCALE;
}

export function setLocale(tag) {
    locale = LOCALES.includes(tag) ? tag : FALLBACK_LOCALE;
    if (typeof document !== "undefined") document.documentElement.lang = locale;
}

export const getLocale = () => locale;

const lookup = (catalog, key) =>
    key.split(".").reduce((node, part) => node?.[part], catalog);

/**
 * Message for `key` with `{name}` placeholders filled from params. A message may be an
 * Intl.PluralRules map ({one, other}) selected by params.count. Parameters that are themselves
 * descriptors or errors are translated first. Missing keys fall back to the source locale, then the key.
 */
export function t(key, params = {}) {
    let text =
        lookup(CATALOGS[locale], key) ??
        lookup(CATALOGS[SOURCE_LOCALE], key) ??
        key;
    if (typeof text === "object") {
        const category = new Intl.PluralRules(locale).select(
            Number(params.count),
        );
        text = text[category] ?? text.other;
    }
    return text.replace(/\{(\w+)\}/g, (placeholder, name) =>
        name in params ? translate(params[name]) : placeholder,
    );
}

/** Text for a string, a {key, params} descriptor or a thrown value. */
export function translate(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "object" && typeof value.key === "string")
        return t(value.key, value.params);
    if (value instanceof Error) return value.message;
    return String(value);
}

export const formatNumber = (value, options) =>
    new Intl.NumberFormat(locale, options).format(value);

/**
 * Fills static markup: data-i18n="key" sets the text, data-i18n-attr="attr:key attr:key" sets attributes.
 * Elements carrying data-i18n must contain text only.
 */
export function translatePage(root = document) {
    for (const node of root.querySelectorAll("[data-i18n]"))
        node.textContent = t(node.dataset.i18n);
    for (const node of root.querySelectorAll("[data-i18n-attr]"))
        for (const pair of node.dataset.i18nAttr.split(/\s+/)) {
            const [attribute, key] = pair.split(":");
            node.setAttribute(attribute, t(key));
        }
}
