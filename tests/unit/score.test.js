import assert from "node:assert/strict";
import { test } from "node:test";
import {
    createTeachingScore,
    numberedKey,
    numberedPitch,
    teachingRange,
} from "../../src/core/teaching/score.js";
import { parseMidiFile } from "../../src/core/midi/midi-file.js";
import { twoNotes } from "./fixtures.js";

test("numberedPitch spells degrees and octaves", () => {
    assert.deepEqual(numberedPitch(60), { digit: "1", octave: 0 });
    assert.deepEqual(numberedPitch(72), { digit: "1", octave: 1 });
    assert.deepEqual(numberedPitch(59), { digit: "7", octave: -1 });
    assert.deepEqual(numberedPitch(61), { digit: "♯1", octave: 0 });
    assert.deepEqual(numberedPitch(63), { digit: "♯2", octave: 0 });
    const fMajor = numberedKey(-1);
    assert.deepEqual(
        [fMajor.tonic, fMajor.major, fMajor.minor],
        ["F", "F", false],
    );
    assert.deepEqual(numberedPitch(70, fMajor), { digit: "4", octave: 0 });
    assert.deepEqual(numberedPitch(66, fMajor), { digit: "♭2", octave: 0 });
});

test("createTeachingScore lays out bars and teachingRange slices notes", () => {
    const score = createTeachingScore(parseMidiFile(twoNotes()), [0], 120);
    assert.equal(score.barCount, 1);
    assert.equal(score.endQuarter, 3);
    assert.deepEqual(score.locate(1), { bar: 1, beat: 2 });
    assert.deepEqual(
        score.barAt(1).beats.map((beat) => beat.quarter),
        [0, 1, 2],
    );
    const range = teachingRange(score, 0, 3);
    assert.equal(range.notes.length, 2);
    assert.equal(range.durationMs, 1500);
    assert.throws(() => teachingRange(score, 2, 3), {
        key: "errors.emptyRange",
    });
});
