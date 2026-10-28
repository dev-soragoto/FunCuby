import { CLOCK_EPSILON_MS, sameOnset } from "./epsilon.js";

// Follow mode consumes onset groups. A new press is required for every occurrence,
// and chord members must still be held together when the group is completed.
export class FollowPractice {
    constructor(notes) {
        this.notes = notes.map((note) => ({ ...note, grade: null }));
        this.groups = [];
        for (const note of this.notes) {
            let group = this.groups.at(-1);
            if (!group || !sameOnset(group.timeMs, note.timeMs)) {
                group = {
                    timeMs: note.timeMs,
                    notes: [],
                    armed: new Set(),
                    waited: false,
                };
                this.groups.push(group);
            }
            group.notes.push(note);
        }
        this.index = 0;
        this.waiting = false;
        this.completed = 0;
        this.wrong = 0;
        this.waits = 0;
    }

    get current() {
        return this.groups[this.index] || null;
    }

    get complete() {
        return this.index === this.groups.length;
    }

    advance(timeMs, held, allowEarly = false) {
        const results = [];
        if (
            allowEarly &&
            this.current?.notes.every(
                (note) =>
                    this.current.armed.has(note.note) && held.has(note.note),
            )
        ) {
            timeMs = Math.max(timeMs, this.current.timeMs);
        }
        while (
            this.current &&
            timeMs + CLOCK_EPSILON_MS >= this.current.timeMs
        ) {
            const group = this.current;
            if (
                !group.notes.every(
                    (note) => group.armed.has(note.note) && held.has(note.note),
                )
            ) {
                if (!group.waited) {
                    group.waited = true;
                    this.waits++;
                }
                this.waiting = true;
                return { position: group.timeMs, waiting: true, results };
            }
            for (const note of group.notes) {
                note.grade = "Done";
                results.push({ ...note, errorMs: null });
                this.completed++;
            }
            this.index++;
        }
        this.waiting = false;
        return { position: timeMs, waiting: false, results };
    }

    press(note) {
        const group = this.current;
        if (!group) return null;
        if (!group.notes.some((target) => target.note === note)) {
            this.wrong++;
            return { note, grade: "Wrong", errorMs: null };
        }
        group.armed.add(note);
        return null;
    }

    release(note) {
        this.current?.armed.delete(note);
    }

    clearHeld() {
        this.current?.armed.clear();
    }

    missing(held) {
        return (
            this.current?.notes
                .filter(
                    (note) =>
                        !this.current.armed.has(note.note) ||
                        !held.has(note.note),
                )
                .map((note) => note.note) || []
        );
    }

    get result() {
        return {
            completed: this.completed,
            total: this.notes.length,
            wrong: this.wrong,
            waits: this.waits,
        };
    }
}
