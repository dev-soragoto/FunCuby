import { MAIN_KEYS, SHARPS } from "../core/keyboard/layout.js";
import { el } from "./dom.js";

// Renders the EP1 key layout into container; returns layout note → key element.
export function createKeyboard(container, extraClass = "") {
    const keys = new Map();
    const add = (note, className) => {
        const node = el(
            "div",
            "",
            [extraClass, className].filter(Boolean).join(" "),
        );
        node.dataset.note = note;
        node.setAttribute("role", "img");
        keys.set(note, node);
        return node;
    };
    for (const key of MAIN_KEYS)
        add(key.note, "circle-key").append(el("span", "", "note"));
    for (const key of SHARPS) {
        const node = add(key.note, "sharp-key");
        node.style[key.side] = `${key.value}%`;
        node.style.top = `${key.top}%`;
    }
    container.append(...keys.values());
    return keys;
}
