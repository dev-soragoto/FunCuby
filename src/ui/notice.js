import { translate } from "../i18n/i18n.js";
import { byId } from "./dom.js";

let timer = null;

// `message` is text, a {key, params} descriptor or a thrown error.
export function notice(message, error = false) {
    const toast = byId("notice");
    clearTimeout(timer);
    toast.classList.toggle("error", error);
    toast.textContent = translate(message);
    toast.showPopover();
    timer = setTimeout(() => {
        toast.hidePopover();
        toast.textContent = "";
        timer = null;
    }, 2000);
}
