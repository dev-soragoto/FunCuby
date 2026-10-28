import { AppError, message } from "../message.js";
import { QUARTER_EPSILON } from "./epsilon.js";

function segmentAt(list, value, field) {
    let low = 0,
        high = list.length;
    while (low + 1 < high) {
        const middle = (low + high) >>> 1;
        if (list[middle][field] <= value) low = middle;
        else high = middle;
    }
    return list[low];
}

// Lazy beat lookup avoids allocating a beat for every tick of a long MIDI file.
export function teachingBeats(song, bpm) {
    const scale = song.initialBpm / Number(bpm);
    if (!Number.isFinite(scale) || scale <= 0)
        throw new AppError("errors.positive", { field: message("fields.bpm") });
    const timing = song.timing;
    if (!timing) throw new AppError("errors.noTiming");
    const tempos = timing.tempos.map((event) => ({ ...event }));
    for (let i = 0; i < tempos.length; i++) {
        const event = tempos[i],
            previous = tempos[i - 1];
        event.quarter =
            timing.msPerTick === undefined
                ? event.tick / timing.division
                : previous
                  ? previous.quarter +
                    ((event.timeMs - previous.timeMs) * 1000) / previous.tempo
                  : 0;
    }
    const quarterAt = (timeMs) => {
        const tempo = segmentAt(tempos, timeMs, "timeMs");
        return tempo.quarter + ((timeMs - tempo.timeMs) * 1000) / tempo.tempo;
    };
    const timeAt = (quarter) => {
        const tempo = segmentAt(tempos, quarter, "quarter");
        return tempo.timeMs + ((quarter - tempo.quarter) * tempo.tempo) / 1000;
    };
    const signatures = timing.signatures.map((event, index) => ({
        ...event,
        index,
        quarter:
            timing.msPerTick === undefined
                ? event.tick / timing.division
                : quarterAt(event.tick * timing.msPerTick),
    }));
    return {
        timeAt: (quarter) => timeAt(quarter) * scale,
        quarterAt: (timeMs) => quarterAt(timeMs / scale),
        signatures,
        next(timeMs) {
            const quarter = quarterAt(timeMs / scale),
                signature = segmentAt(signatures, quarter, "quarter");
            const unit = 4 / signature.denominator;
            const beat = Math.ceil(
                (quarter - signature.quarter) / unit - QUARTER_EPSILON,
            );
            const at = signature.quarter + beat * unit;
            const nextSignature = signatures[signature.index + 1];
            if (
                nextSignature &&
                at >= nextSignature.quarter - QUARTER_EPSILON
            ) {
                return {
                    timeMs: timeAt(nextSignature.quarter) * scale,
                    accent: true,
                    beat: 1,
                };
            }
            const number =
                (((beat % signature.numerator) + signature.numerator) %
                    signature.numerator) +
                1;
            return {
                timeMs: timeAt(at) * scale,
                accent: number === 1,
                beat: number,
            };
        },
    };
}
