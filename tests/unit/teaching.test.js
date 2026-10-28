import assert from "node:assert/strict";
import { test } from "node:test";
import { osuHitWindows, TeachingJudge } from "../../src/core/teaching/judge.js";
import { FollowPractice } from "../../src/core/teaching/follow-practice.js";
import {
    calibrationOffset,
    colorTeachingNotes,
    CUE_COLORS,
} from "../../src/core/teaching/notes.js";
import { teachingBeats } from "../../src/core/teaching/beats.js";
import { parseMidiFile } from "../../src/core/midi/midi-file.js";
import { twoNotes } from "./fixtures.js";

const notes = () => [
    { id: 0, note: 60, timeMs: 1000 },
    { id: 1, note: 62, timeMs: 2000 },
];

test("osuHitWindows follows lazer formulas", () => {
    assert.deepEqual(osuHitWindows(5), {
        great: 49.5,
        ok: 99.5,
        meh: 149.5,
        miss: 400,
    });
    assert.throws(() => osuHitWindows(11));
});

test("TeachingJudge grades presses by distance", () => {
    const judge = new TeachingJudge(notes(), { od: 5 });
    assert.equal(judge.press(60, 500), null);
    assert.equal(judge.press(60, 1010).grade, "300");
    assert.equal(judge.press(62, 2120).grade, "50");
    const result = judge.result;
    assert.equal(judge.complete, true);
    assert.equal(result.accuracy.toFixed(2), "58.33");
    assert.deepEqual(result.counts, { 300: 1, 100: 0, 50: 1, Miss: 0 });
    assert.equal(result.meanErrorMs, 65);
});

test("TeachingJudge scores a perfect run at 1,000,000 and counts wrong keys / misses", () => {
    const perfect = new TeachingJudge(notes());
    perfect.press(60, 1000);
    perfect.press(62, 2000);
    assert.equal(perfect.result.score, 1000000);

    const sloppy = new TeachingJudge(notes());
    assert.equal(sloppy.press(70, 1000).grade, "Wrong");
    assert.deepEqual(
        sloppy.advance(2200).map((hit) => hit.grade),
        ["Miss", "Miss"],
    );
    assert.equal(sloppy.result.wrong, 1);
    assert.equal(sloppy.result.combo, 0);
});

test("FollowPractice waits for every chord member to be pressed and held", () => {
    const practice = new FollowPractice([
        { id: 0, note: 60, timeMs: 0 },
        { id: 1, note: 64, timeMs: 0 },
        { id: 2, note: 67, timeMs: 1000 },
    ]);
    assert.equal(practice.advance(0, new Set()).waiting, true);
    assert.equal(practice.press(60), null);
    assert.deepEqual(practice.missing(new Set([60])), [64]);
    practice.press(64);
    const step = practice.advance(0, new Set([60, 64]));
    assert.equal(step.waiting, false);
    assert.equal(step.results.length, 2);
    assert.equal(practice.press(61).grade, "Wrong");
    assert.deepEqual(practice.missing(new Set()), [67]);
    assert.deepEqual(practice.result, {
        completed: 2,
        total: 3,
        wrong: 1,
        waits: 1,
    });
});

test("calibrationOffset uses the median of at least five samples", () => {
    assert.equal(calibrationOffset([50, 10, 30, 20, 40]), 30);
    assert.equal(calibrationOffset([1, 2, 3, 4, 5, 6]), 4);
    assert.throws(() => calibrationOffset([1, 2, 3, 4]));
});

test("colorTeachingNotes colours by onset group", () => {
    const colored = colorTeachingNotes([
        { timeMs: 0 },
        { timeMs: 0 },
        { timeMs: 5 },
    ]);
    assert.deepEqual(
        colored.map((note) => note.cueColor),
        [CUE_COLORS[0], CUE_COLORS[0], CUE_COLORS[1]],
    );
});

test("teachingBeats walks the 3/4 grid and scales with BPM", () => {
    const song = parseMidiFile(twoNotes());
    assert.deepEqual(teachingBeats(song, 120).next(600), {
        timeMs: 1000,
        accent: false,
        beat: 3,
    });
    assert.deepEqual(teachingBeats(song, 240).next(600), {
        timeMs: 750,
        accent: true,
        beat: 1,
    });
});
