const ascii = (text) => [...text].map((char) => char.charCodeAt(0));
const uint32 = (n) => [
    (n >>> 24) & 255,
    (n >>> 16) & 255,
    (n >>> 8) & 255,
    n & 255,
];

export function smf(trackBytes, { format = 0, division = 480 } = {}) {
    const header = [
        ...ascii("MThd"),
        ...uint32(6),
        0,
        format,
        0,
        1,
        division >> 8,
        division & 255,
    ];
    return Uint8Array.from([
        ...header,
        ...ascii("MTrk"),
        ...uint32(trackBytes.length),
        ...trackBytes,
    ]);
}

// 3/4 at 120 BPM: C4 for one beat, then D4 for one beat (running-status note-off).
export const twoNotes = () =>
    smf([
        ...[0x00, 0xff, 0x03, 0x04, ...ascii("Lead")],
        ...[0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20],
        ...[0x00, 0xff, 0x58, 0x04, 0x03, 0x02, 0x18, 0x08],
        ...[0x00, 0xc0, 0x05],
        ...[0x00, 0x90, 0x3c, 0x64],
        ...[0x83, 0x60, 0x80, 0x3c, 0x40],
        ...[0x00, 0x90, 0x3e, 0x64],
        ...[0x83, 0x60, 0x3e, 0x00],
        ...[0x00, 0xff, 0x2f, 0x00],
    ]);
