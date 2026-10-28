// osu!lazer-style timing judgment for rhythm mode; no DOM dependencies.
import { AppError } from "../message.js";

export const DEFAULT_OD = 5;
export const GRADES = { 300: 300, 100: 100, 50: 50, Miss: 0 };

// osu!lazer OsuHitWindows: floored difficulty windows, minus half a millisecond.
export function osuHitWindows(od = DEFAULT_OD) {
    if (!Number.isFinite(od) || od < 0 || od > 10)
        throw new AppError("errors.od");
    return {
        great: Math.floor(80 - 6 * od) - 0.5,
        ok: Math.floor(140 - 8 * od) - 0.5,
        meh: Math.floor(200 - 10 * od) - 0.5,
        miss: 400,
    };
}

export const HIT_WINDOW = osuHitWindows().meh;

export class TeachingJudge {
    /**
     * @param {{ note: number, timeMs: number }[]} notes
     * @param {{ od?: number }} [options]
     */
    constructor(notes, { od = DEFAULT_OD } = {}) {
        this.od = od;
        this.windows = osuHitWindows(od);
        this.notes = notes.map((note) => ({
            ...note,
            grade: null,
            errorMs: null,
        }));
        this.byPitch = new Map();
        for (const note of this.notes) {
            if (!this.byPitch.has(note.note))
                this.byPitch.set(note.note, { notes: [], head: 0 });
            this.byPitch.get(note.note).notes.push(note);
        }
        this.expired = 0;
        this.judged = 0;
        this.wrong = 0;
        this.combo = 0;
        this.maxCombo = 0;
        this.weight = 0;
        this.counts = { 300: 0, 100: 0, 50: 0, Miss: 0 };
        this.errors = [];
        this.errorSum = 0;
        this.comboScore = 0;
        this.maxComboScore = 0;
        for (let i = 1; i <= notes.length; i++)
            this.maxComboScore += 300 * Math.sqrt(i);
    }

    grade(note, grade, errorMs = null) {
        if (note.grade) return null;
        note.grade = grade;
        note.errorMs = errorMs;
        this.judged++;
        this.counts[grade]++;
        this.weight += GRADES[grade];
        if (grade === "Miss") this.combo = 0;
        else {
            this.combo++;
            this.maxCombo = Math.max(this.maxCombo, this.combo);
            this.comboScore += 300 * Math.sqrt(this.combo);
            this.errors.push(errorMs);
            this.errorSum += errorMs;
        }
        return { ...note };
    }

    advance(timeMs) {
        const results = [];
        while (
            this.expired < this.notes.length &&
            this.notes[this.expired].timeMs < timeMs - this.windows.meh
        ) {
            const result = this.grade(this.notes[this.expired++], "Miss");
            if (result) results.push(result);
        }
        return results;
    }

    press(note, timeMs) {
        this.advance(timeMs);
        if (
            !this.notes.length ||
            timeMs < this.notes[0].timeMs - this.windows.miss ||
            timeMs > this.notes.at(-1).timeMs + this.windows.meh
        )
            return null;
        const queue = this.byPitch.get(note);
        if (queue) {
            while (
                queue.head < queue.notes.length &&
                queue.notes[queue.head].grade
            )
                queue.head++;
        }
        // Keyboard lanes consume the earliest unjudged occurrence of the same pitch.
        const candidate = queue?.notes[queue.head];
        if (!candidate) {
            this.wrong++;
            return { note, grade: "Wrong", errorMs: null };
        }
        const errorMs = timeMs - candidate.timeMs,
            distance = Math.abs(errorMs);
        if (distance > this.windows.miss) return null;
        return this.grade(
            candidate,
            distance <= this.windows.great
                ? "300"
                : distance <= this.windows.ok
                  ? "100"
                  : distance <= this.windows.meh
                    ? "50"
                    : "Miss",
            errorMs,
        );
    }

    get complete() {
        return this.judged === this.notes.length;
    }

    get result() {
        const accuracy = this.judged ? this.weight / (300 * this.judged) : 1;
        const comboProgress = this.maxComboScore
            ? this.comboScore / this.maxComboScore
            : 0;
        const accuracyProgress = this.notes.length
            ? this.judged / this.notes.length
            : 0;
        // Current lazer ScoreProcessor, with tap notes only, no mods or bonus objects.
        const score = Math.round(
            500000 * accuracy * comboProgress +
                500000 * accuracy ** 5 * accuracyProgress,
        );
        return {
            score: Math.max(0, Math.min(1000000, score)),
            accuracy: accuracy * 100,
            maxCombo: this.maxCombo,
            combo: this.combo,
            wrong: this.wrong,
            counts: { ...this.counts },
            judged: this.judged,
            total: this.notes.length,
            od: this.od,
            comboProgress,
            meanErrorMs: this.errors.length
                ? this.errorSum / this.errors.length
                : null,
        };
    }
}
