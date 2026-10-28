import { AppError, message } from "../message.js";

export class KeyState {
    constructor() {
        this.offset = 0;
        this.calibrating = false;
        this.pressed = new Map();
    }

    clear() {
        this.pressed.clear();
        this.calibrating = false;
    }

    setOffset(offset) {
        if (!Number.isInteger(offset) || offset < -60 || offset > 67)
            throw new AppError("errors.integer", {
                field: message("fields.offset"),
                min: -60,
                max: 67,
            });
        this.pressed.clear();
        this.offset = offset;
    }

    apply(event) {
        if (!["note-on", "note-off"].includes(event.kind)) return;
        const id = `${event.channel}:${event.note}`;
        if (this.calibrating && event.kind === "note-on") {
            this.setOffset(event.note - 60);
            this.calibrating = false;
        }
        if (event.kind === "note-on")
            this.pressed.set(id, {
                ...event,
                position: event.note - this.offset,
            });
        else this.pressed.delete(id);
    }

    get positions() {
        return new Set([...this.pressed.values()].map((n) => n.position));
    }
}
