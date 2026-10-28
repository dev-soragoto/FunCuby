import { AppError } from "../message.js";
import { teachingBeats } from "./beats.js";
import { teachingNotes } from "./notes.js";
import { QUARTER_EPSILON } from "./epsilon.js";

const MAJOR_KEYS = [
    "C♭",
    "G♭",
    "D♭",
    "A♭",
    "E♭",
    "B♭",
    "F",
    "C",
    "G",
    "D",
    "A",
    "E",
    "B",
    "F♯",
    "C♯",
];
const MINOR_KEYS = [
    "A♭",
    "E♭",
    "B♭",
    "F",
    "C",
    "G",
    "D",
    "A",
    "E",
    "B",
    "F♯",
    "C♯",
    "G♯",
    "D♯",
    "A♯",
];
const LETTERS = ["C", "D", "E", "F", "G", "A", "B"],
    NATURAL = [0, 2, 4, 5, 7, 9, 11];
const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;

export function numberedKey(sharps = 0, minor = false) {
    const major = MAJOR_KEYS[sharps + 7],
        tonic = (minor ? MINOR_KEYS : MAJOR_KEYS)[sharps + 7];
    const letter = LETTERS.indexOf(major[0]),
        alteration = major.includes("♯") ? 1 : major.includes("♭") ? -1 : 0;
    return {
        sharps,
        minor,
        major,
        tonic,
        letter,
        root: 60 + NATURAL[letter] + alteration,
    };
}

export function numberedPitch(note, key = numberedKey()) {
    const relative = note - key.root,
        octave = Math.floor(relative / 12),
        pitch = mod(relative, 12);
    const degree = NATURAL.indexOf(pitch);
    if (degree !== -1) return { digit: String(degree + 1), octave };
    if (key.minor && pitch === 8) return { digit: "♯5", octave };
    // MIDI pitches have no enharmonic spelling. Prefer the simplest written pitch,
    // then follow the key's sharp/flat direction when two spellings are equivalent.
    const candidates = [];
    for (let i = 0; i < 7; i++) {
        for (const delta of [-1, 1]) {
            if (mod(NATURAL[i] + delta, 12) !== pitch) continue;
            const base = key.root + octave * 12 + NATURAL[i];
            const shiftedOctave = octave + (note - base - delta) / 12;
            const letterIndex = key.letter + i;
            const natural =
                60 +
                NATURAL[mod(letterIndex, 7)] +
                Math.floor(letterIndex / 7) * 12;
            const written = key.root + NATURAL[i] - natural + delta;
            candidates.push({
                digit: `${delta > 0 ? "♯" : "♭"}${i + 1}`,
                octave: shiftedOctave,
                rank:
                    Math.abs(written) * 2 +
                    (key.sharps < 0 ? delta > 0 : delta < 0),
            });
        }
    }
    candidates.sort((a, b) => a.rank - b.rank);
    const { digit, octave: resultOctave } = candidates[0];
    return { digit, octave: resultOctave };
}

function createTrackScore(song, track, events, bpm, grid) {
    const notes = teachingNotes({ ...song, events }, track.index, bpm);
    const scale = song.initialBpm / Number(bpm),
        pending = new Map(),
        ends = new Map();
    const sourceKeys = song.timing.keys || [];
    const changes = sourceKeys
        .filter((key) => key.track === 0 || key.track === track.index)
        .sort(
            (a, b) =>
                a.tick - b.tick ||
                Number(a.track === track.index) -
                    Number(b.track === track.index),
        );
    const keys = [{ quarter: 0, ...numberedKey(), explicit: false }];
    for (const change of changes) {
        const key = {
            quarter: grid.quarterAt(change.timeMs * scale),
            ...numberedKey(change.sharps, change.minor),
            explicit: true,
        };
        if (Math.abs(keys.at(-1).quarter - key.quarter) < QUARTER_EPSILON)
            keys[keys.length - 1] = key;
        else keys.push(key);
    }

    function keyAt(quarter) {
        let low = 0,
            high = keys.length;
        while (low + 1 < high) {
            const mid = (low + high) >>> 1;
            if (keys[mid].quarter <= quarter + QUARTER_EPSILON) low = mid;
            else high = mid;
        }
        return keys[low];
    }

    let endMs = notes.at(-1)?.timeMs || 0;
    for (const event of events) {
        endMs = Math.max(endMs, event.timeMs * scale);
        const key = `${event.sourceChannel}:${event.note}`;
        if (event.on) {
            if (!pending.has(key)) pending.set(key, { notes: [], head: 0 });
            pending.get(key).notes.push(event);
        } else {
            const queue = pending.get(key),
                press = queue?.notes[queue.head++];
            if (!press) continue;
            const id = `${press.timeMs * scale}:${press.note}`;
            ends.set(id, Math.max(ends.get(id) || 0, event.timeMs * scale));
            if (queue.head === queue.notes.length) pending.delete(key);
        }
    }
    const maxEnds = [];
    let maxEnd = -Infinity;
    for (const note of notes) {
        note.quarter = grid.quarterAt(note.timeMs);
        note.endQuarter = grid.quarterAt(
            ends.get(`${note.timeMs}:${note.note}`) ?? note.timeMs,
        );
        maxEnd = Math.max(maxEnd, note.endQuarter);
        maxEnds.push(maxEnd);
    }
    const endQuarter = Math.max(
        grid.quarterAt(endMs),
        (notes.at(-1)?.quarter || 0) + 0.0001,
    );
    return {
        index: track.index,
        name: track.name,
        notes,
        keys,
        keyAt,
        maxEnds,
        endQuarter,
    };
}

export function createTeachingScore(song, tracks, bpm) {
    const selected = new Set(Array.isArray(tracks) ? tracks : [tracks]);
    const sources = song.tracks.filter(
        (track) => selected.has(track.index) && track.noteCount,
    );
    if (!sources.length) throw new AppError("errors.noPracticeNotes");
    const grid = teachingBeats(song, bpm),
        events = new Map(sources.map((track) => [track.index, []]));
    for (const event of song.events) events.get(event.track)?.push(event);
    const lanes = sources.map((track) =>
        createTrackScore(song, track, events.get(track.index), bpm, grid),
    );
    const notes = teachingNotes(
            song,
            sources.map((track) => track.index),
            bpm,
        ),
        ends = new Map();
    for (const lane of lanes)
        for (const note of lane.notes) {
            const key = `${note.timeMs}:${note.note}`;
            ends.set(
                key,
                Math.max(ends.get(key) ?? -Infinity, note.endQuarter),
            );
        }
    for (const note of notes) {
        note.quarter = grid.quarterAt(note.timeMs);
        note.endQuarter = ends.get(`${note.timeMs}:${note.note}`);
    }
    const endQuarter = Math.max(...lanes.map((lane) => lane.endQuarter));
    const sections = [];
    let barCount = 0;
    for (const [index, signature] of grid.signatures.entries()) {
        if (signature.quarter >= endQuarter && sections.length) break;
        const end = Math.min(
            grid.signatures[index + 1]?.quarter ?? Infinity,
            endQuarter,
        );
        const unit = 4 / signature.denominator,
            length = signature.numerator * unit;
        const count = Math.max(
            1,
            Math.ceil((end - signature.quarter) / length - QUARTER_EPSILON),
        );
        sections.push({
            ...signature,
            end,
            unit,
            length,
            firstBar: barCount + 1,
            count,
        });
        barCount += count;
    }

    function barAt(number) {
        number = Math.max(1, Math.min(barCount, number));
        const section = sections.findLast(
            (section) => section.firstBar <= number,
        );
        const start =
            section.quarter + (number - section.firstBar) * section.length;
        const next = sections[sections.indexOf(section) + 1];
        const end = Math.min(start + section.length, next?.quarter ?? Infinity);
        const beats = [];
        for (
            let q = start, beat = 1;
            q < end - QUARTER_EPSILON;
            q += section.unit, beat++
        ) {
            beats.push({
                quarter: q,
                end: Math.min(end, q + section.unit),
                number: beat,
            });
        }
        return {
            number,
            start,
            end,
            beats,
            numerator: section.numerator,
            denominator: section.denominator,
        };
    }

    const lastQuarter = barAt(barCount).end;

    /** Bar and 1-based beat of a quarter position; beat is null at the very end of the last bar. */
    function locate(quarter) {
        if (quarter >= lastQuarter - QUARTER_EPSILON)
            return { bar: barCount, beat: null };
        const section =
            sections.findLast(
                (section) => section.quarter <= quarter + QUARTER_EPSILON,
            ) || sections[0];
        const offset = Math.floor(
            (quarter - section.quarter + QUARTER_EPSILON) / section.length,
        );
        const start = section.quarter + offset * section.length;
        return {
            bar: section.firstBar + offset,
            beat: Number(((quarter - start) / section.unit + 1).toFixed(3)),
        };
    }

    return {
        grid,
        notes,
        lanes,
        barCount,
        barAt,
        locate,
        endQuarter: lastQuarter,
        gapMs: (quarter, bars) => {
            const signature =
                grid.signatures.findLast(
                    (signature) =>
                        signature.quarter <= quarter + QUARTER_EPSILON,
                ) || grid.signatures[0];
            return (
                bars *
                (grid.timeAt(
                    quarter + (signature.numerator * 4) / signature.denominator,
                ) -
                    grid.timeAt(quarter))
            );
        },
    };
}

export function teachingRange(score, start, end) {
    if (!(
        start >= 0 &&
        end > start &&
        end <= score.endQuarter + QUARTER_EPSILON
    ))
        throw new AppError("errors.invalidRange");
    const startMs = score.grid.timeAt(start),
        endMs = score.grid.timeAt(end);
    const notes = score.notes
        .filter(
            (note) =>
                note.quarter >= start - QUARTER_EPSILON &&
                note.quarter < end - QUARTER_EPSILON,
        )
        .map((note, id) => ({ ...note, id, timeMs: note.timeMs - startMs }));
    if (!notes.length) throw new AppError("errors.emptyRange");
    return {
        notes,
        startMs,
        durationMs: endMs - startMs,
        grid: {
            next: (ms) => {
                const beat = score.grid.next(ms + startMs);
                return { ...beat, timeMs: beat.timeMs - startMs };
            },
        },
    };
}
