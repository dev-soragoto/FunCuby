import assert from "node:assert/strict";
import { test } from "node:test";
import {
    classify,
    commandMessages,
    encodePackets,
    hex,
    parseHex,
    parseRawSequence,
} from "../../src/core/ble/protocol.js";
import { MidiDecoder } from "../../src/core/ble/midi-decoder.js";
import { noteName } from "../../src/core/music.js";
import { integer } from "../../src/core/validate.js";

test("hex and parseHex round-trip", () => {
    assert.equal(hex([0x80, 0x9f, 0x3c]), "80 9F 3C");
    assert.deepEqual([...parseHex("0x80, 9f 3C")], [0x80, 0x9f, 0x3c]);
    assert.throws(() => parseHex("80 9"));
});

test("parseRawSequence reads packets and sleeps, reporting the failing line", () => {
    assert.deepEqual(
        parseRawSequence("80 80 90 3C 55\n\nsleep 101.5\n80 80 80 3C 00").map(
            (step) => step.sleepMs ?? hex(step.bytes),
        ),
        ["80 80 90 3C 55", 101.5, "80 80 80 3C 00"],
    );
    assert.throws(() => parseRawSequence("80 80\nsleep x"), {
        key: "errors.rawLine",
        params: {
            line: 2,
            reason: { key: "errors.sleep", params: { max: 60000 } },
        },
    });
    assert.throws(() => parseRawSequence("sleep 10"));
});

test("integer validates range", () => {
    assert.equal(integer("12", 0, 127), 12);
    assert.throws(() => integer("", 0, 127));
    assert.throws(() => integer(1.5, 0, 127));
    assert.throws(() => integer(128, 0, 127));
});

test("noteName handles octaves and negatives", () => {
    assert.equal(noteName(60), "C4");
    assert.equal(noteName(61), "C♯4");
    assert.equal(noteName(-1), "B-2");
});

test("classify recognises EP1 / EP2 names", () => {
    assert.equal(classify("EP-123"), "EP1");
    assert.equal(classify("easyplay1_midi"), "EP1");
    assert.equal(classify("EP2 Pro"), "EP2");
    assert.equal(classify("Some Keyboard"), "UNKNOWN");
});

test("commandMessages builds note and program messages", () => {
    assert.deepEqual(
        commandMessages({
            command: "on",
            pitches: [60, 64],
            channel: 16,
            velocity: 85,
        }),
        [
            [0x9f, 60, 85],
            [0x9f, 64, 85],
        ],
    );
    assert.deepEqual(
        commandMessages({ command: "program", channel: 1, program: 5 }),
        [[0xc0, 5]],
    );
    assert.throws(() => commandMessages({ command: "on", pitches: [] }));
});

test("encodePackets frames messages with BLE MIDI timestamps and splits by size", () => {
    const on = [[0x90, 60, 85]];
    assert.deepEqual(encodePackets(on).map(hex), ["80 80 90 3C 55"]);
    assert.deepEqual(encodePackets(on, { format: "legacy" }).map(hex), [
        "80 80 90 3C 55",
    ]);
    assert.deepEqual(encodePackets(on, { timestamp: 200 }).map(hex), [
        "81 C8 90 3C 55",
    ]);
    const five = Array.from({ length: 5 }, (_, i) => [0x90, 60 + i, 85]);
    assert.deepEqual(
        encodePackets(five).map((packet) => packet.length),
        [17, 5],
    );
});

test("MidiDecoder decodes framed notes with running status", () => {
    const decoder = new MidiDecoder();
    const events = decoder.feed([0x80, 0x80, 0x90, 0x3c, 0x55, 0x3c, 0x00]);
    assert.deepEqual(
        events.map((e) => [e.kind, e.note, e.velocity, e.channel]),
        [
            ["note-on", 60, 85, 1],
            ["note-off", 60, 0, 1],
        ],
    );
    assert.equal(events[0].noteName, "C4");
});

test("MidiDecoder treats channels 15/16 as reserved and handles raw / empty input", () => {
    const decoder = new MidiDecoder();
    assert.equal(
        decoder.feed([0x80, 0x80, 0x9f, 0x3c, 0x55])[0].kind,
        "unknown",
    );
    assert.equal(
        decoder.feed([0x90, 0x40, 0x10], { format: "raw" })[0].kind,
        "note-on",
    );
    assert.deepEqual(decoder.feed([]), [
        { kind: "unknown", reason: { key: "rx.empty", params: {} } },
    ]);
});

test("MidiDecoder reassembles state SysEx across notifications", () => {
    const decoder = new MidiDecoder();
    assert.equal(
        decoder.feed([0xf0, 0x7d, 0x4a, 0x50], {
            format: "raw",
            packetId: "a",
        })[0].kind,
        "fragment",
    );
    const [event] = decoder.feed([0x01, 0x05, 0, 0, 0, 0, 0xf7], {
        format: "raw",
        packetId: "b",
    });
    assert.equal(event.kind, "state");
    assert.equal(event.state, "playing");
    assert.equal(event.tick, 5);
    assert.deepEqual(event.packetIds, ["a", "b"]);
});
