import { AppError } from "../message.js";
import { integer } from "../validate.js";

export const pitchKey = (event) => `${event.channel}:${event.note}`;

export function preparePerformance(song, settings) {
    const routes = song.tracks.map((track) => {
        const route = settings[track.index];
        if (!route?.enabled) return null;
        const channel = integer(route.channel, 1, 16, "channel"),
            minGapMs = Number(route.minGapMs),
            minDurationMs = Number(route.minDurationMs);
        if (!["timestamp", "legacy"].includes(route.format))
            throw new AppError("errors.trackFormat");
        if (typeof route.noteOff !== "boolean")
            throw new AppError("errors.trackMode");
        if (
            route.minGapMs === "" ||
            !Number.isFinite(minGapMs) ||
            minGapMs < 0 ||
            minGapMs > 5000
        )
            throw new AppError("errors.minGap");
        if (
            route.minDurationMs === "" ||
            !Number.isFinite(minDurationMs) ||
            minDurationMs < 0 ||
            minDurationMs > 5000
        )
            throw new AppError("errors.minDuration");
        return {
            channel,
            program: integer(route.program, 0, 127, "program"),
            format: route.format,
            noteOff: route.noteOff,
            minGapMs,
            minDurationMs,
        };
    });
    const events = song.events
        .filter((event) => routes[event.track])
        .map((event) => ({ ...event, ...routes[event.track] }));
    const pending = new Map();
    for (const event of events) {
        if (!event.noteOff) continue;
        // Pair within the original track/channel before merging output voices.
        const key = `${event.track}:${event.sourceChannel}:${event.note}`;
        if (event.on) {
            if (!pending.has(key)) pending.set(key, { notes: [], released: 0 });
            pending.get(key).notes.push(event);
        } else {
            const queue = pending.get(key);
            if (!queue) continue;
            const press = queue.notes[queue.released++];
            event.timeMs = Math.max(
                event.timeMs,
                press.timeMs + press.minDurationMs,
            );
            if (queue.released === queue.notes.length) pending.delete(key);
        }
    }
    // Stable ordering retains the file's event order when normalized times coincide.
    return events.sort((a, b) => a.timeMs - b.timeMs);
}

export function performancePrograms(events) {
    const channels = new Map();
    for (const event of events) {
        if (!event.on) continue;
        const previous = channels.get(event.channel);
        if (previous && previous.program !== event.program)
            throw new AppError("errors.programConflict", {
                channel: event.channel,
            });
        if (!previous)
            channels.set(event.channel, {
                channel: event.channel,
                program: event.program,
                format: event.format,
            });
    }
    return [...channels.values()];
}

// Resolve overlapping releases before filtering short rests. A press-only voice pins its pitch.
export function compilePerformance(events) {
    const counts = new Map(),
        output = [];
    for (const event of events) {
        const key = pitchKey(event),
            count = counts.get(key) || 0;
        if (event.on) {
            counts.set(key, count + 1);
            output.push({ ...event });
        } else if (event.noteOff && count) {
            if (count > 1) counts.set(key, count - 1);
            else {
                counts.delete(key);
                output.push({ ...event });
            }
        }
    }
    const nextPress = new Map(),
        filtered = [];
    let skipped = 0;
    for (let i = output.length - 1; i >= 0; i--) {
        const event = output[i],
            key = pitchKey(event);
        if (event.on) nextPress.set(key, event);
        else {
            const next = nextPress.get(key);
            if (next && next.timeMs - event.timeMs < event.minGapMs) {
                skipped++;
                continue;
            }
        }
        filtered.push(event);
    }
    return { events: filtered.reverse(), skipped };
}

export function performanceAt(source, scheduled, target) {
    const pending = new Map();
    for (const event of source) {
        if (event.timeMs > target) break;
        const key = `${event.track}:${event.sourceChannel}:${event.note}`,
            held = pending.get(key);
        if (event.on) {
            if (held) held.notes.push(event);
            else pending.set(key, { notes: [event], released: 0 });
        } else if (held && ++held.released === held.notes.length)
            pending.delete(key);
    }
    const sounding = new Map();
    let index = 0;
    while (index < scheduled.length && scheduled[index].timeMs <= target) {
        const event = scheduled[index++],
            key = pitchKey(event);
        if (event.on) sounding.set(key, event);
        else sounding.delete(key);
    }
    const held = [...pending.values()]
        .flatMap((queue) => queue.notes.slice(queue.released))
        .filter((event) => sounding.has(pitchKey(event)));
    const restored = new Set(held.map(pitchKey));
    // A suppressed release keeps the paired voice sounding through the short rest.
    for (const [key, event] of sounding)
        if (event.noteOff && !restored.has(key)) held.push(event);
    held.sort((a, b) => a.timeMs - b.timeMs);
    return { index, held };
}
