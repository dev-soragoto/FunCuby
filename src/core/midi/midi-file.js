// Standard MIDI File 0/1: keep MTrk boundaries and merge their tempo timeline.
import { AppError } from "../message.js";

const invalid = (key, params) => new AppError(`errors.midi.${key}`, params);

class Reader {
    constructor(bytes) {
        this.bytes = bytes;
        this.pos = 0;
    }

    take(length) {
        if (length > this.bytes.length - this.pos) throw invalid("truncated");
        const bytes = this.bytes.subarray(this.pos, this.pos + length);
        this.pos += length;
        return bytes;
    }

    byte() {
        return this.take(1)[0];
    }

    uint(length) {
        return this.take(length).reduce((n, b) => n * 256 + b, 0);
    }

    tag() {
        return String.fromCharCode(...this.take(4));
    }

    variable() {
        let n = 0;
        for (let i = 0; i < 4; i++) {
            const b = this.byte();
            n = n * 128 + (b & 127);
            if ((b & 128) === 0) return n;
        }
        throw invalid("variableLength");
    }
}

const MAX_BYTES = 32 * 1024 * 1024;

/** @param {Blob} file */
export async function readMidiFile(file) {
    if (file.size > MAX_BYTES) throw invalid("tooLarge", { limit: 32 });
    return parseMidiFile(await file.arrayBuffer());
}

export function parseMidiFile(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length > MAX_BYTES) throw invalid("tooLarge", { limit: 32 });
    const file = new Reader(bytes);
    if (file.tag() !== "MThd") throw invalid("notSmf");
    const header = new Reader(file.take(file.uint(4)));
    const format = header.uint(2),
        count = header.uint(2),
        division = header.uint(2);
    if (![0, 1].includes(format)) throw invalid("format");
    if (!count || count > 1024 || (format === 0 && count !== 1))
        throw invalid("trackCount");
    let msPerTick;
    if (division & 0x8000) {
        const fps = 256 - (division >> 8),
            ticksPerFrame = division & 255;
        if (![24, 25, 29, 30].includes(fps) || !ticksPerFrame)
            throw invalid("smpte");
        msPerTick = 1000 / ((fps === 29 ? 30000 / 1001 : fps) * ticksPerFrame);
    } else if (!division) throw invalid("division");

    const tracks = [],
        timeline = [],
        text = new TextDecoder();
    let eventCount = 0,
        endTick = 0;
    while (tracks.length < count) {
        const tag = file.tag(),
            chunk = new Reader(file.take(file.uint(4)));
        if (tag !== "MTrk") continue;
        const track = {
            index: tracks.length,
            name: "",
            channels: [],
            program: 2,
            noteCount: 0,
        };
        const channels = new Set();
        let tick = 0,
            running = null,
            ended = false,
            programFound = false;
        while (chunk.pos < chunk.bytes.length) {
            if (++eventCount > 500000)
                throw invalid("tooManyEvents", { limit: 500000 });
            tick += chunk.variable();
            let status = chunk.byte();
            if (status < 128) {
                if (running === null)
                    throw invalid("missingStatus", { track: track.index + 1 });
                chunk.pos--;
                status = running;
            }
            if (status === 0xff) {
                running = null;
                const type = chunk.byte(),
                    data = chunk.take(chunk.variable());
                if (type === 0x03)
                    track.name = text.decode(data).replaceAll("\0", "").trim();
                if (type === 0x51) {
                    if (data.length !== 3) throw invalid("tempoLength");
                    const tempo = data.reduce((n, b) => n * 256 + b, 0);
                    if (!tempo) throw invalid("zeroTempo");
                    timeline.push({ tick, tempo });
                }
                if (type === 0x58) {
                    if (data.length !== 4 || !data[0] || data[1] > 7)
                        throw invalid("timeSignature");
                    timeline.push({
                        tick,
                        signature: {
                            numerator: data[0],
                            denominator: 2 ** data[1],
                        },
                    });
                }
                if (type === 0x59) {
                    const sharps = data[0] > 127 ? data[0] - 256 : data[0];
                    if (
                        data.length !== 2 ||
                        sharps < -7 ||
                        sharps > 7 ||
                        ![0, 1].includes(data[1])
                    )
                        throw invalid("keySignature");
                    timeline.push({
                        tick,
                        track: track.index,
                        keySignature: { sharps, minor: data[1] === 1 },
                    });
                }
                if (type === 0x2f) {
                    if (data.length) throw invalid("endLength");
                    ended = true;
                    break;
                }
            } else if (status === 0xf0 || status === 0xf7) {
                running = null;
                chunk.take(chunk.variable());
            } else if (status >= 0x80 && status <= 0xef) {
                running = status;
                const op = status & 0xf0,
                    channel = (status & 15) + 1;
                const data = chunk.take(op === 0xc0 || op === 0xd0 ? 1 : 2);
                if (data.some((b) => b > 127))
                    throw invalid("dataByte", { track: track.index + 1 });
                if (op === 0xc0 && !programFound) {
                    track.program = data[0];
                    programFound = true;
                }
                if (op === 0xb0 && data[0] === 64)
                    timeline.push({
                        tick,
                        pedal: data[1] >= 64,
                        sourceChannel: channel,
                    });
                if (op === 0x80 || op === 0x90) {
                    const on = op === 0x90 && data[1] > 0;
                    timeline.push({
                        tick,
                        track: track.index,
                        on,
                        note: data[0],
                        velocity: data[1],
                        sourceChannel: channel,
                    });
                    channels.add(channel);
                    if (on) track.noteCount++;
                }
            } else throw invalid("statusByte", { track: track.index + 1 });
        }
        if (!ended) throw invalid("missingEnd", { track: track.index + 1 });
        endTick = Math.max(endTick, tick);
        track.channels = [...channels].sort((a, b) => a - b);
        tracks.push(track);
    }
    // Stable sort preserves each track's original event order at equal ticks.
    timeline.sort((a, b) => a.tick - b.tick);
    let initialTempo = 500000;
    for (const event of timeline) {
        if (event.tick > 0) break;
        if (event.tempo !== undefined) initialTempo = event.tempo;
    }
    const events = [],
        pedals = new Set(),
        deferred = new Map();
    const tempos = [{ tick: 0, timeMs: 0, tempo: 500000 }];
    const signatures = [{ tick: 0, numerator: 4, denominator: 4 }];
    const keys = [];
    const appendChange = (list, value) => {
        if (list.at(-1).tick === value.tick) list[list.length - 1] = value;
        else list.push(value);
    };
    const releasePedal = (channel, tick, timeMs) => {
        for (const event of deferred.get(channel) || [])
            events.push({ ...event, tick, timeMs });
        deferred.delete(channel);
    };
    let tick = 0,
        timeMs = 0,
        tempo = 500000;
    for (const event of timeline) {
        timeMs += (event.tick - tick) * (msPerTick ?? tempo / division / 1000);
        tick = event.tick;
        if (event.tempo !== undefined) {
            tempo = event.tempo;
            appendChange(tempos, { tick, timeMs, tempo });
        } else if (event.signature)
            appendChange(signatures, { tick, ...event.signature });
        else if (event.keySignature)
            keys.push({
                tick,
                timeMs,
                track: event.track,
                ...event.keySignature,
            });
        else if (event.pedal !== undefined) {
            if (event.pedal) pedals.add(event.sourceChannel);
            else {
                pedals.delete(event.sourceChannel);
                releasePedal(event.sourceChannel, tick, timeMs);
            }
        } else if (!event.on && pedals.has(event.sourceChannel)) {
            if (!deferred.has(event.sourceChannel))
                deferred.set(event.sourceChannel, []);
            deferred.get(event.sourceChannel).push(event);
        } else events.push({ ...event, timeMs });
    }
    const durationMs =
        timeMs + (endTick - tick) * (msPerTick ?? tempo / division / 1000);
    // Emulate CC64 with note durations; EP1 need not understand pedal messages.
    for (const channel of deferred.keys())
        releasePedal(channel, endTick, durationMs);
    return {
        format,
        tracks,
        events,
        durationMs,
        initialBpm: 60000000 / initialTempo,
        timing: { division, msPerTick, endTick, tempos, signatures, keys },
    };
}
