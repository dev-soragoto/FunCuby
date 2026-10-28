import assert from "node:assert/strict";
import { test } from "node:test";
import { KeyState } from "../../src/core/keyboard/key-state.js";
import { parseImport } from "../../src/core/storage/log-store.js";

test("KeyState tracks presses and calibrates from the first key", () => {
    const keys = new KeyState();
    keys.calibrating = true;
    keys.apply({ kind: "note-on", channel: 1, note: 62 });
    assert.equal(keys.offset, 2);
    assert.equal(keys.calibrating, false);
    assert.deepEqual([...keys.positions], [60]);
    keys.apply({ kind: "note-off", channel: 1, note: 62 });
    assert.equal(keys.positions.size, 0);
    assert.throws(() => keys.setOffset(100));
});

test("parseImport validates ep1-log v2 JSONL", () => {
    const head = JSON.stringify({ schema: "ep1-log", version: 2 });
    const row = JSON.stringify({
        direction: "RX",
        bytes: [0x80, 0x90],
        seq: 7,
        source: "device",
    });
    const [parsed] = parseImport(`${head}\n${row}\n`);
    assert.equal(parsed.source, "import");
    assert.equal(parsed.originalSeq, 7);
    assert.deepEqual(parsed.bytes, [0x80, 0x90]);
    assert.throws(() => parseImport(`${head}\n{"direction":"XX","bytes":[]}`), {
        key: "errors.log.badRow",
        params: { line: 2 },
    });
    assert.throws(() => parseImport('{"schema":"other"}'));
});
