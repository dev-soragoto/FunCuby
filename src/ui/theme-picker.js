import { byId } from "./dom.js";

const THEMES = ["light", "dark"];
const SCHEME_QUERY = {
    light: "(prefers-color-scheme: light)",
    dark: "(prefers-color-scheme: dark)",
};

// src/theme-boot.js sets data-theme before first paint; this keeps the picker, storage and browser chrome in sync.
function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
        const scheme = meta.dataset.scheme;
        meta.media =
            theme === "system"
                ? SCHEME_QUERY[scheme]
                : theme === scheme
                  ? "all"
                  : "not all";
    }
}

/** The picker always shows the scheme in effect; until the user picks one it tracks the OS. */
export function initThemePicker(preferences) {
    const picker = byId("theme");
    const saved = document.documentElement.dataset.theme;
    const dark = matchMedia(SCHEME_QUERY.dark);
    const showSystem = () => (picker.value = dark.matches ? "dark" : "light");
    if (THEMES.includes(saved)) {
        picker.value = saved;
        applyTheme(saved);
    } else {
        applyTheme("system");
        showSystem();
        dark.addEventListener("change", showSystem);
    }
    picker.addEventListener("change", () => {
        dark.removeEventListener("change", showSystem);
        applyTheme(picker.value);
        preferences.set("theme", picker.value);
    });
}
