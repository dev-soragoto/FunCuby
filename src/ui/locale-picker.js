import {
    getLocale,
    LOCALES,
    negotiateLocale,
    setLocale,
    translatePage,
} from "../i18n/i18n.js";
import { byId } from "./dom.js";

/** Must run before any page renders text. A saved choice wins over navigator.languages. */
export function initLocalePicker(preferences) {
    const saved = preferences.get("locale");
    setLocale(
        LOCALES.includes(saved) ? saved : negotiateLocale(navigator.languages),
    );
    translatePage();
    const picker = byId("locale");
    picker.value = getLocale();
    picker.addEventListener("change", () => {
        preferences.set("locale", picker.value);
        location.reload();
    });
}
