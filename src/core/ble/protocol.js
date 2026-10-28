import { AppError, describe } from "../message.js";
import { integer } from "../validate.js";

// Evidence: analysis/music-main.formatted.js modules 36436 / iQ / iV;
// musicPreviewV2/app-service.js: tE, tz, tG, tL and tH.
export const SERVICE = "03b80e5a-ede8-4b33-a751-6ce34ec4c700";
export const CHARACTERISTIC = "7772e5db-3868-4112-a1a9-f2669d106bf3";
/** @param {number[] | Uint8Array} bytes */
export const hex = (bytes) =>
    Array.from(bytes, (b) =>
        b.toString(16).padStart(2, "0").toUpperCase(),
    ).join(" ");

export function parseHex(text) {
    const clean = text
        .trim()
        .replace(/0x/gi, "")
        .replace(/[\s,]+/g, "");
    if (!clean || clean.length % 2 || !/^[\da-f]+$/i.test(clean))
        throw new AppError("errors.hex");
    return Uint8Array.from(clean.match(/../g), (b) => parseInt(b, 16));
}

function parseRawStep(line) {
    if (/^sleep\b/i.test(line)) {
        const match = /^sleep\s+(\d+(?:\.\d+)?)$/i.exec(line);
        if (!match || Number(match[1]) > 60000)
            throw new AppError("errors.sleep", { max: 60000 });
        return { sleepMs: Number(match[1]) };
    }
    const bytes = parseHex(line);
    if (bytes.length > 512)
        throw new AppError("errors.packetTooLong", { max: 512 });
    return { bytes };
}

export function parseRawSequence(text) {
    const steps = [];
    text.split(/\r\n|\n|\r/).forEach((line, index) => {
        line = line.trim();
        if (!line) return;
        try {
            steps.push(parseRawStep(line));
        } catch (error) {
            throw new AppError(
                "errors.rawLine",
                { line: index + 1, reason: describe(error) },
                { cause: error },
            );
        }
    });
    if (!steps.some((step) => step.bytes))
        throw new AppError("errors.rawEmpty");
    return steps;
}

export function classify(name = "") {
    const s = name.trim().toUpperCase();
    if (s.includes("KEYBOARD")) return "UNKNOWN";
    if (s.startsWith("EP2")) return "EP2";
    return s.startsWith("EP-") ||
        ["EP_MUSIC", "EASYPLAY", "EP-MIDI", "EASYPLAY1_MIDI"].some((t) =>
            s.includes(t),
        )
        ? "EP1"
        : "UNKNOWN";
}

export function commandMessages({
    command,
    pitches = [],
    channel = 1,
    velocity = 85,
    program = 2,
}) {
    if (command === "program")
        return [
            [
                0xc0 | (integer(channel, 1, 16, "channel") - 1),
                integer(program, 0, 127, "program"),
            ],
        ];
    if (!["on", "off"].includes(command))
        throw new AppError("errors.unknownCommand");
    if (!pitches.length) throw new AppError("errors.noPitches");
    const ch = integer(channel, 1, 16, "channel") - 1;
    const v = integer(velocity, 0, 127, "velocity");
    return pitches.map((p) => [
        (command === "on" ? 0x90 : 0x80) | ch,
        integer(p, 0, 127, "pitch"),
        v,
    ]);
}

export function encodePackets(
    messages,
    { format = "timestamp", timestamp = 0, maxBytes = 20 } = {},
) {
    if (!["timestamp", "legacy"].includes(format))
        throw new AppError("errors.unknownFormat");
    integer(maxBytes, 5, 512, "packetLength");
    const t =
        integer(
            Math.floor(timestamp),
            0,
            Number.MAX_SAFE_INTEGER,
            "timestamp",
        ) & 8191;
    const header = 0x80 | ((t >> 7) & 0x3f),
        low = 0x80 | (t & 0x7f);
    const packets = [];
    let packet = format === "legacy" ? [0x80, 0x80] : [header];
    for (const message of messages) {
        const length = [0xc0, 0xd0].includes(message[0] & 0xf0) ? 2 : 3;
        if (message.length !== length)
            throw new AppError("errors.messageLength");
        message.forEach((b) => integer(b, 0, 255, "byte"));
        const event = format === "legacy" ? message : [low, ...message];
        if (packet.length + event.length > maxBytes) {
            packets.push(Uint8Array.from(packet));
            packet = format === "legacy" ? [0x80, 0x80] : [header];
        }
        packet.push(...event);
    }
    if (messages.length) packets.push(Uint8Array.from(packet));
    return packets;
}
