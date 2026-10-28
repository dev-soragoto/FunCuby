import { noteName } from "../../core/music.js";
import { CLOCK_EPSILON_MS, sameOnset } from "../../core/teaching/epsilon.js";
import { byId, el } from "../dom.js";
import { createKeyboard } from "../keyboard-view.js";

const PRESS_COLOR = "var(--press)";
const UPCOMING_LIMIT = 8;
const BURSTS_PER_KEY = 4;
const FLASH_MS = 300;

const isMiss = (grade) => grade === "Miss" || grade === "Wrong";

function gradeColor(grade) {
    if (isMiss(grade)) return "var(--grade-miss)";
    if (grade === "50") return "var(--grade-50)";
    if (grade === "100") return "var(--grade-100)";
    return "var(--grade-300)";
}

function burstLabel(grade) {
    if (grade === "Miss") return "×";
    if (grade === "Wrong") return "!";
    if (["Armed", "Done", "Calibrated"].includes(grade)) return "✓";
    return grade;
}

// Approach-ring scale shrinks from 2.5× to 1× as `remaining` goes from 1 to 0.
const ringScale = (remaining) =>
    `scale(${1 + Math.max(0, Math.min(1, remaining)) * 1.5})`;

/**
 * Practice keyboard visuals: approach rings, hit flashes, key bursts and the upcoming-note strip.
 * Notes are absolute MIDI pitches; getOffset() maps them onto layout keys.
 */
export function createStage(getOffset) {
    const keys = createKeyboard(byId("teach-keyboard"), "teach-key");
    const rings = new Map(),
        flashes = new Map(),
        effects = new Map();
    let upcomingSignature = "";
    const keyFor = (note) => keys.get(note - getOffset());

    function relabel(offset) {
        for (const [base, node] of keys) {
            const label = node.querySelector(".note");
            if (label) label.textContent = noteName(base + offset);
            node.setAttribute(
                "aria-label",
                `${noteName(base + offset)} · MIDI ${base + offset}`,
            );
        }
    }

    function showHeld(pitches) {
        for (const [base, node] of keys)
            node.classList.toggle("active", pitches.has(base + getOffset()));
    }

    function peek(note) {
        const node = keyFor(note);
        if (!node) return;
        node.classList.add("peek");
        setTimeout(() => node.classList.remove("peek"), 500);
    }

    function markSatisfied(note) {
        keyFor(note)?.classList.add("satisfied");
    }

    function burst(note, grade = "Press", color = PRESS_COLOR) {
        const node = keyFor(note);
        if (!node) return;
        const previous = [...effects.values()].filter(
            (effect) => effect.parent === node,
        );
        if (previous.length >= BURSTS_PER_KEY) previous[0].cleanup();
        const kind =
            grade === "Press"
                ? "burst-press"
                : isMiss(grade)
                  ? "burst-miss"
                  : "burst-hit";
        const effect = el("span", "", `key-burst ${kind}`);
        effect.style.setProperty("--effect-color", color);
        effect.setAttribute("aria-hidden", "true");
        if (grade !== "Press")
            effect.append(el("span", burstLabel(grade), "key-hit-label"));
        let timer;
        const cleanup = () => {
            clearTimeout(timer);
            effect.remove();
            effects.delete(effect);
        };
        effect.addEventListener("animationend", cleanup, { once: true });
        timer = setTimeout(cleanup, 450);
        effects.set(effect, { parent: node, cleanup });
        node.append(effect);
    }

    function removeRing(id) {
        rings.get(id)?.remove();
        rings.delete(id);
    }

    function flash(hit) {
        const node = keyFor(hit.note);
        if (!node) return;
        const missed = isMiss(hit.grade),
            color = gradeColor(hit.grade);
        clearTimeout(flashes.get(node)?.timer);
        const entry = { until: performance.now() + FLASH_MS, missed };
        entry.timer = setTimeout(() => {
            if (flashes.get(node) !== entry) return;
            node.classList.remove("hit", "missed");
            flashes.delete(node);
        }, FLASH_MS);
        flashes.set(node, entry);
        node.style.setProperty("--hit-color", color);
        node.classList.toggle("hit", !missed);
        node.classList.toggle("missed", missed);
        burst(hit.note, hit.grade, color);
    }

    function clear(clearFeedback = true) {
        for (const ring of rings.values()) ring.remove();
        rings.clear();
        upcomingSignature = "";
        for (const node of keys.values()) {
            node.classList.remove("target", "satisfied");
            if (clearFeedback) node.classList.remove("hit", "missed");
        }
        if (!clearFeedback) return;
        for (const entry of flashes.values()) clearTimeout(entry.timer);
        flashes.clear();
        for (const cleanup of [...effects.values()].map(
            (effect) => effect.cleanup,
        ))
            cleanup();
    }

    function ringFor(id, node, color, className) {
        let ring = rings.get(id);
        if (!ring) {
            ring = el("span", "", className);
            ring.style.setProperty("--cue-color", color);
            node.append(ring);
            rings.set(id, ring);
        }
        return ring;
    }

    /**
     * Draws rings for unjudged notes within leadMs of raw, starting at notes[from].
     * isSatisfied(note) marks chord members already pressed in follow mode.
     * nextRound ({startMs, notes}) previews the next loop's opening notes.
     * Returns the upcoming-note list for drawUpcoming().
     */
    function drawCues({ notes, from, raw, leadMs, isSatisfied, nextRound }) {
        const horizon = raw + leadMs + CLOCK_EPSILON_MS,
            visible = new Set(),
            upcoming = [];
        for (const node of keys.values())
            node.classList.remove("target", "satisfied");
        const firstTime = notes[from]?.timeMs;
        for (let i = from; i < notes.length; i++) {
            const note = notes[i];
            if (!note.grade && upcoming.length < UPCOMING_LIMIT)
                upcoming.push(note);
            if (note.timeMs > horizon) break;
            if (note.grade) continue;
            const node = keyFor(note.note);
            if (!node) continue;
            if (isSatisfied(note)) {
                node.classList.add("satisfied");
                continue;
            }
            if (!node.classList.contains("target"))
                node.style.setProperty("--cue-color", note.cueColor);
            visible.add(note.id);
            node.classList.add("target");
            const ring = ringFor(note.id, node, note.cueColor, "approach-ring");
            const current = sameOnset(note.timeMs, firstTime),
                remaining = Math.max(
                    0,
                    Math.min(1, (note.timeMs - raw) / leadMs),
                );
            ring.classList.toggle("current-cue", current);
            ring.style.transform = ringScale(remaining);
            ring.style.opacity = String(
                (current ? 1 : 0.55) * (1 - remaining * 0.3),
            );
        }
        for (const note of nextRound?.notes ?? []) {
            const at = nextRound.startMs + note.timeMs;
            if (at > horizon) break;
            const id = `next:${note.id}`,
                node = keyFor(note.note);
            if (!node) continue;
            visible.add(id);
            ringFor(
                id,
                node,
                note.cueColor,
                "approach-ring next-round-ring",
            ).style.transform = ringScale((at - raw) / leadMs);
            if (upcoming.length < UPCOMING_LIMIT)
                upcoming.push({ ...note, id, preview: true });
        }
        for (const id of rings.keys()) if (!visible.has(id)) removeRing(id);
        return upcoming;
    }

    function drawFlashes(now) {
        for (const [node, entry] of flashes) {
            const lit = now < entry.until;
            node.classList.toggle("hit", !entry.missed && lit);
            node.classList.toggle("missed", entry.missed && lit);
            if (!lit) {
                clearTimeout(entry.timer);
                flashes.delete(node);
            }
        }
    }

    function drawUpcoming(upcoming) {
        const signature = upcoming.map((note) => note.id).join(",");
        if (signature === upcomingSignature) return;
        upcomingSignature = signature;
        byId("teach-upcoming").replaceChildren(
            ...upcoming.map((note) => {
                const span = el(
                    "span",
                    `${note.preview ? "↻ " : ""}${noteName(note.note)}`,
                );
                span.style.setProperty("--cue-color", note.cueColor);
                return span;
            }),
        );
    }

    return {
        relabel,
        showHeld,
        peek,
        markSatisfied,
        burst,
        removeRing,
        flash,
        clear,
        drawCues,
        drawFlashes,
        drawUpcoming,
    };
}
