import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { negotiateLocale } from "../../src/i18n/i18n.js";

const PLURAL = new Set(["zero", "one", "two", "few", "many", "other"]);
const catalog = (name) =>
    JSON.parse(
        readFileSync(
            new URL(`../../src/i18n/${name}.json`, import.meta.url),
            "utf8",
        ),
    );
const isPlural = (node) => Object.keys(node).every((key) => PLURAL.has(key));

function keys(node, prefix = "") {
    return Object.entries(node).flatMap(([key, value]) =>
        typeof value === "object" && !isPlural(value)
            ? keys(value, `${prefix}${key}.`)
            : [`${prefix}${key}`],
    );
}

test("every locale has the same keys and negotiation falls back by language", () => {
    assert.deepEqual(keys(catalog("en")).sort(), keys(catalog("zh-CN")).sort());
    assert.equal(negotiateLocale(["en-GB", "zh-CN"]), "en");
    assert.equal(negotiateLocale(["zh-TW"]), "zh-CN");
    assert.equal(negotiateLocale(["ja"]), "en");
});
