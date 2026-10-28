import { AppError, message } from "../message.js";

function positive(value, field) {
    const number =
        typeof value === "string" && !value.trim() ? NaN : Number(value);
    if (!Number.isFinite(number) || number <= 0)
        throw new AppError("errors.positive", {
            field: message(`fields.${field}`),
        });
    return number;
}

export function shortestNoteMs(song, settings) {
    const pending = new Map();
    let shortest = Infinity;
    for (const event of song.events) {
        if (!settings[event.track]?.enabled) continue;
        const key = `${event.track}:${event.sourceChannel}:${event.note}`;
        if (event.on) {
            if (!pending.has(key)) pending.set(key, { notes: [], released: 0 });
            pending.get(key).notes.push(event.timeMs);
        } else {
            const queue = pending.get(key);
            if (!queue) continue;
            const duration = event.timeMs - queue.notes[queue.released++];
            if (duration > 0) shortest = Math.min(shortest, duration);
            if (queue.released === queue.notes.length) pending.delete(key);
        }
    }
    return Number.isFinite(shortest) ? shortest : null;
}

export function bpmForShortestNote(song, settings, targetMs) {
    const target = positive(targetMs, "targetShortest"),
        base = positive(song.initialBpm, "originalBpm");
    const shortest = shortestNoteMs(song, settings);
    return shortest === null
        ? null
        : positive((base * shortest) / target, "computedBpm");
}

export function retimeSong(song, bpm) {
    const tempo = positive(bpm, "bpm"),
        scale = positive(song.initialBpm, "originalBpm") / tempo;
    const durationMs = song.durationMs * scale;
    if (!Number.isFinite(durationMs)) throw new AppError("errors.bpmTooLow");
    return {
        ...song,
        initialBpm: tempo,
        durationMs,
        events: song.events.map((event) => ({
            ...event,
            timeMs: event.timeMs * scale,
        })),
    };
}
