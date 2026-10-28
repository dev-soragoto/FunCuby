// UI preferences in localStorage. Optional: failures fall back to defaults silently.
export const preferences = {
    get(key) {
        try {
            return localStorage.getItem(`ep1:${key}`);
        } catch {
            return null;
        }
    },
    set(key, value) {
        try {
            localStorage.setItem(`ep1:${key}`, String(value));
        } catch {
            /* Logs have their own error reporting. */
        }
    },
};
