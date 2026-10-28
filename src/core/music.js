export const noteName = (n) =>
    ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][
        ((n % 12) + 12) % 12
    ] +
    (Math.floor(n / 12) - 1);
