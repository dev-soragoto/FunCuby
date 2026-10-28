// Original module 31254. Sharp placement: musicPreviewV2/page-frame.js,
// keyboard-display-stage .sharp-key-{original index} (not chromatic key index).
export const MAIN_KEYS = [
    60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84,
].map((note, i) => ({
    note,
    sharp: [0, 1, 3, 4, 5, 7, 8, 10, 11, 12].includes(i) ? note + 1 : null,
}));
export const SHARPS = [
    [0, "left", 14.13, -7.3],
    [1, "left", 35.87, -7.3],
    [3, "right", 15.62, -7.3],
    [4, "left", -6.22, 26.2],
    [5, "left", 14.13, 26.2],
    [7, "right", 37.36, 26.2],
    [8, "right", 15.5, 26.2],
    [10, "left", 13.93, 63.2],
    [11, "left", 35.87, 63.2],
    [12, "right", 37.44, 63.2],
].map(([index, side, value, top]) => ({
    side,
    value,
    top,
    note: MAIN_KEYS[index].sharp,
}));
export const ALL_NOTES = new Set(
    MAIN_KEYS.flatMap((k) => (k.sharp ? [k.note, k.sharp] : [k.note])),
);
