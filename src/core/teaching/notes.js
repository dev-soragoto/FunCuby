import { AppError, message } from "../message.js";
import { sameOnset } from "./epsilon.js";

export const CUE_COLORS = [
    "var(--cue-1)",
    "var(--cue-2)",
    "var(--cue-3)",
    "var(--cue-4)",
];

export function colorTeachingNotes(notes) {
    let group = -1,
        previous = -Infinity;
    return notes.map((note) => {
        if (!sameOnset(note.timeMs, previous)) {
            group++;
            previous = note.timeMs;
        }
        return { ...note, cueColor: CUE_COLORS[group % CUE_COLORS.length] };
    });
}

export function teachingNotes(song, tracks, bpm) {
    const scale = song.initialBpm / Number(bpm);
    if (!Number.isFinite(scale) || scale <= 0)
        throw new AppError("errors.positive", { field: message("fields.bpm") });
    const selected = new Set(Array.isArray(tracks) ? tracks : [tracks]);
    const seen = new Map(),
        notes = [];
    for (const event of song.events) {
        if (!selected.has(event.track) || !event.on) continue;
        const key = `${event.timeMs}:${event.note}`;
        const existing = seen.get(key);
        if (existing) {
            if (!existing.tracks.includes(event.track))
                existing.tracks.push(event.track);
            continue;
        }
        const timeMs = event.timeMs * scale;
        if (!Number.isFinite(timeMs)) throw new AppError("errors.bpmTooLow");
        const note = {
            id: notes.length,
            note: event.note,
            timeMs,
            tracks: [event.track],
        };
        seen.set(key, note);
        notes.push(note);
    }
    return notes.sort((a, b) => a.timeMs - b.timeMs);
}

export function calibrationOffset(samples) {
    const valid = samples
        .filter(Number.isFinite)
        .slice()
        .sort((a, b) => a - b);
    if (valid.length < 5) throw new AppError("errors.tooFewTaps", { min: 5 });
    const middle = Math.floor(valid.length / 2);
    return Math.round(
        valid.length % 2
            ? valid[middle]
            : (valid[middle - 1] + valid[middle]) / 2,
    );
}
