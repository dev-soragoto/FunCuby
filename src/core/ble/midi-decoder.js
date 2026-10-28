import { message } from "../message.js";
import { noteName } from "../music.js";
import { hex } from "./protocol.js";

const base128 = (bytes) =>
    bytes.reduce((sum, b, i) => sum + b * 2 ** (7 * i), 0);

export function decodeState(bytes) {
    if (
        bytes.length < 6 ||
        ![0xf0, 0x7d, 0x4a, 0x50].every((b, i) => bytes[i] === b) ||
        bytes.at(-1) !== 0xf7
    )
        return null;
    if (bytes.slice(4, -1).some((b) => b > 127) || ![1, 2].includes(bytes[4]))
        return null;
    const state = bytes[4] === 1 ? "playing" : "waiting";
    if (bytes.length === 11)
        return {
            kind: "state",
            state,
            tick: base128(bytes.slice(5, 10)),
            clock: "host",
        };
    if (bytes.length < 17) return null;
    const flags = bytes[5],
        result = {
            kind: "state",
            state,
            tick: base128(bytes.slice(6, 11)),
            ms: base128(bytes.slice(11, 16)),
            clock: "device",
        };
    let p = 16;
    if ((flags & 1) !== 0) {
        if (p + 2 > bytes.length - 1) return null;
        result.waitId = base128(bytes.slice(p, p + 2));
        p += 2;
    }
    if ((flags & 2) !== 0) {
        if (p >= bytes.length - 1) return null;
        const n = bytes[p++];
        if (p + n > bytes.length - 1) return null;
        result.pitches = bytes.slice(p, p + n);
    }
    return result;
}

function midiEvent(bytes) {
    const [status, note, velocity] = bytes,
        op = status & 0xf0,
        channel = (status & 15) + 1;
    if ([0x80, 0x90].includes(op) && ![15, 16].includes(channel))
        return {
            kind: op === 0x80 || !velocity ? "note-off" : "note-on",
            status,
            channel,
            note,
            noteName: noteName(note),
            velocity,
        };
    return {
        kind: "unknown",
        status,
        channel,
        bytes,
        reason: message(
            [15, 16].includes(channel)
                ? "rx.reservedChannel"
                : "rx.undefinedMessage",
        ),
    };
}

export class MidiDecoder {
    constructor() {
        this.reset();
    }

    reset() {
        this.sysex = [];
        this.pending = [];
        this.running = null;
        this.sources = [];
    }

    /**
     * @param {Iterable<number>} input
     * @param {{ format?: string, packetId?: string | null }} [options]
     */
    feed(input, { format = "auto", packetId = null } = {}) {
        const bytes = Array.from(input),
            events = [];
        const unknown = (key, params) =>
            events.push({
                kind: "unknown",
                reason: message(`rx.${key}`, params),
            });
        if (!bytes.length)
            return [{ kind: "unknown", reason: message("rx.empty") }];
        const framed =
            format === "ble" ||
            format === "legacy" ||
            (format === "auto" &&
                bytes[0] >= 0x80 &&
                bytes[0] <= 0xbf &&
                bytes.length >= 2 &&
                bytes[1] >= 0x80);
        if (framed && (bytes[0] < 0x80 || bytes[0] > 0xbf))
            return [
                {
                    kind: "unknown",
                    reason: message("rx.badHeader"),
                },
            ];
        if (!framed && !this.sysex.length && bytes[0] < 0x80)
            return [
                {
                    kind: "unknown",
                    reason: message("rx.noStatus"),
                },
            ];
        const legacy =
            format === "legacy" ||
            (format === "auto" &&
                framed &&
                bytes[0] === 0x80 &&
                bytes[1] === 0x80);
        let i = framed ? 1 : 0,
            boundary = true;
        // Per-packet running status; SysEx alone is allowed to span notifications.
        this.running = null;
        if (this.pending.length) {
            unknown("previousIncomplete");
            this.pending = [];
        }
        if (framed) {
            if (bytes[i] < 0x80)
                return [
                    { kind: "unknown", reason: message("rx.noTimestampLow") },
                ];
            i++;
            boundary = false;
        }
        for (; i < bytes.length; i++) {
            const b = bytes[i];
            if (b >= 0xf8) {
                events.push({ kind: "realtime", status: b });
                continue;
            }
            if (this.sysex.length) {
                if (!this.sources.includes(packetId))
                    this.sources.push(packetId);
                if (b === 0xf7) {
                    this.sysex.push(b);
                    events.push({
                        ...(decodeState(this.sysex) || {
                            kind: "unknown",
                            reason: message("rx.badSysex"),
                        }),
                        bytes: [...this.sysex],
                        packetIds: [...this.sources],
                    });
                    this.sysex = [];
                    this.sources = [];
                    boundary = true;
                } else if (b < 0x80) this.sysex.push(b);
                else if (b === 0xf0) {
                    unknown("sysexRestarted");
                    this.sysex = [b];
                    this.sources = [packetId];
                } else if (!framed) {
                    unknown("sysexStatus");
                    this.sysex = [];
                    this.sources = [];
                }
                // In framed SysEx, high-bit bytes between data bytes are timestamps.
                if (this.sysex.length > 4096) {
                    unknown("sysexOverflow", { max: 4096 });
                    this.sysex = [];
                    this.sources = [];
                }
                continue;
            }
            if (framed && boundary && b >= 0x80) {
                if (!legacy || (bytes[i + 1] >= 0x80 && b < 0xf0)) {
                    if (++i >= bytes.length) {
                        unknown("noDataAfterTimestamp");
                        break;
                    }
                }
            }
            const value = bytes[i];
            if (value === 0xf0) {
                this.sysex = [value];
                this.sources = [packetId];
                this.running = null;
                boundary = false;
                continue;
            }
            if (value >= 0x80) {
                if (this.pending.length) unknown("interrupted");
                this.pending = [];
                this.running = value < 0xf0 ? value : null;
                if (value >= 0xf0) {
                    unknown("unsupportedSystem", { status: hex([value]) });
                    boundary = true;
                    continue;
                }
                this.pending = [value];
                boundary = false;
            } else {
                if (!this.pending.length && this.running != null)
                    this.pending = [this.running];
                if (!this.pending.length) {
                    unknown("orphanData");
                    continue;
                }
                this.pending.push(value);
                boundary = false;
            }
            if (this.pending.length) {
                const expected = [0xc0, 0xd0].includes(this.pending[0] & 0xf0)
                    ? 2
                    : 3;
                if (this.pending.length === expected) {
                    events.push({
                        ...midiEvent(this.pending),
                        bytes: [...this.pending],
                    });
                    this.pending = [];
                    boundary = true;
                }
            }
        }
        if (this.pending.length) {
            unknown("trailingIncomplete");
            this.pending = [];
        }
        if (!events.length)
            events.push({
                kind: "fragment",
                reason: message(
                    this.sysex.length ? "rx.sysexPending" : "rx.noEvent",
                ),
            });
        return events;
    }
}
