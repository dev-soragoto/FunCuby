// Classic blocking script: pins a saved theme before first paint so it never flashes the OS scheme.
// The key matches preferences.set('theme') in src/ui/theme-picker.js.
try {
    document.documentElement.dataset.theme =
        localStorage.getItem("ep1:theme") || "system";
} catch {
    document.documentElement.dataset.theme = "system";
}
