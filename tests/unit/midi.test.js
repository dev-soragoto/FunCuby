import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMidiFile } from "../../src/core/midi/midi-file.js";
import {
    bpmForShortestNote,
    retimeSong,
    shortestNoteMs,
} from "../../src/core/midi/tempo.js";
import {
    compilePerformance,
    performancePrograms,
    preparePerformance,
} from "../../src/core/midi/performance-plan.js";
import { smf, twoNotes } from "./fixtures.js";

const round = (ms) => Math.round(ms * 1000) / 1000;

const route = (overrides) => ({
    enabled: true,
    channel: 1,
    program: 2,
    format: "timestamp",
    noteOff: true,
    minGapMs: 0,
    minDurationMs: 0,
    ...overrides,
});

test("parseMidiFile reads tracks, tempo, signature and notes", () => {
    const song = parseMidiFile(twoNotes());
    assert.equal(song.format, 0);
    assert.equal(song.initialBpm, 120);
    assert.equal(round(song.durationMs), 1000);
    assert.deepEqual(song.tracks[0], {
        index: 0,
        name: "Lead",
        channels: [1],
        program: 5,
        noteCount: 2,
    });
    assert.deepEqual(
        song.events.map((e) => [e.on, e.note, round(e.timeMs)]),
        [
            [true, 60, 0],
            [false, 60, 500],
            [true, 62, 500],
            [false, 62, 1000],
        ],
    );
    assert.deepEqual(song.timing.signatures, [
        { tick: 0, numerator: 3, denominator: 4 },
    ]);
});

test("parseMidiFile rejects malformed files", () => {
    assert.throws(() => parseMidiFile(new Uint8Array([1, 2, 3, 4])), {
        key: "errors.midi.notSmf",
    });
    assert.throws(
        () => parseMidiFile(smf([0x00, 0x90, 0x3c, 0x64])),
        /errors\.midi\.(truncated|missingEnd)/,
    );
});

test("tempo helpers compute shortest note and retime songs", () => {
    const song = parseMidiFile(twoNotes());
    assert.equal(round(shortestNoteMs(song, [{ enabled: true }])), 500);
    assert.equal(shortestNoteMs(song, [{ enabled: false }]), null);
    assert.equal(
        round(bpmForShortestNote(song, [{ enabled: true }], 250)),
        240,
    );
    const fast = retimeSong(song, 240);
    assert.equal(round(fast.durationMs), 500);
    assert.equal(round(fast.events[1].timeMs), 250);
    assert.throws(() => retimeSong(song, 0));
});

test("preparePerformance applies routes and minimum durations", () => {
    const song = parseMidiFile(twoNotes());
    const events = preparePerformance(song, [
        route({ channel: 3, minDurationMs: 800 }),
    ]);
    assert.deepEqual(
        events.map((e) => [e.on, e.note, round(e.timeMs), e.channel]),
        [
            [true, 60, 0, 3],
            [true, 62, 500, 3],
            [false, 60, 800, 3],
            [false, 62, 1300, 3],
        ],
    );
    assert.throws(() => preparePerformance(song, [route({ minGapMs: 9999 })]));
});

test("compilePerformance drops releases followed closely by the same pitch", () => {
    const base = { channel: 1, note: 60, noteOff: true, minGapMs: 101 };
    const { events, skipped } = compilePerformance([
        { ...base, on: true, timeMs: 0 },
        { ...base, on: false, timeMs: 100 },
        { ...base, on: true, timeMs: 150 },
        { ...base, on: false, timeMs: 300 },
    ]);
    assert.equal(skipped, 1);
    assert.deepEqual(
        events.map((e) => [e.on, e.timeMs]),
        [
            [true, 0],
            [true, 150],
            [false, 300],
        ],
    );
});

test("performancePrograms rejects conflicting programs on one channel", () => {
    const on = { on: true, channel: 1, format: "timestamp" };
    assert.deepEqual(performancePrograms([{ ...on, program: 2 }]), [
        { channel: 1, program: 2, format: "timestamp" },
    ]);
    assert.throws(() =>
        performancePrograms([
            { ...on, program: 2 },
            { ...on, program: 3 },
        ]),
    );
});
