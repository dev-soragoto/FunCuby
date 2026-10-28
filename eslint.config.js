import js from "@eslint/js";
import globals from "globals";

export default [
    { ignores: ["node_modules/", ".test-artifacts/"] },
    js.configs.recommended,
    {
        files: ["src/**/*.js"],
        languageOptions: { globals: globals.browser },
    },
    {
        files: ["*.js", "tests/**/*.{js,mjs}"],
        languageOptions: { globals: { ...globals.node, ...globals.browser } },
    },
    {
        rules: {
            "no-unused-vars": [
                "error",
                { caughtErrors: "none", ignoreRestSiblings: true },
            ],
        },
    },
];
