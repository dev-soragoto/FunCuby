import {
    commandMessages,
    encodePackets,
    hex,
    parseRawSequence,
} from "../../core/ble/protocol.js";
import { AppError, message } from "../../core/message.js";
import { integer } from "../../core/validate.js";
import { translate } from "../../i18n/i18n.js";
import { byId } from "../dom.js";

const CONTROLS =
    "#send-form input, #send-form select, #send-form button, #raw-form textarea, #raw-form button";

/** Send tab: structured and raw HEX writes. setBusy(true) locks it while a song owns the queue. */
export function initSendPage({ transport, book, notice, run, cancelPlayback }) {
    function parsePitches() {
        const pitches = byId("pitches")
            .value.trim()
            .split(/[\s,，]+/)
            .map((n) => integer(n, 0, 127, "pitch"));
        if (pitches.length > 256)
            throw new AppError("errors.tooManyPitches", { max: 256 });
        return pitches;
    }

    function commandPackets() {
        const command = byId("command").value,
            format = byId("tx-format").value;
        const timestamp =
            format === "timestamp"
                ? integer(byId("tx-timestamp").value, 0, 8191, "timestamp")
                : 0;
        const messages = commandMessages({
            command,
            pitches: command === "program" ? [] : parsePitches(),
            channel: byId("channel").value,
            velocity: byId("velocity").value,
            program: byId("program-number").value,
        });
        return encodePackets(messages, { format, timestamp });
    }

    function preview() {
        const program = byId("command").value === "program",
            timestamp = byId("tx-format").value === "timestamp";
        if (program) byId("pitches").value = "";
        byId("pitches").disabled = program;
        byId("channel").disabled = false;
        byId("velocity").disabled = program;
        byId("program-number").disabled = !program;
        byId("program-field").hidden = !program;
        byId("tx-timestamp").disabled = !timestamp;
        byId("tx-timestamp-field").hidden = !timestamp;
        try {
            byId("send-preview").textContent = commandPackets()
                .map(hex)
                .join("\n");
        } catch (error) {
            byId("send-preview").textContent = translate(error);
        }
    }

    function setBusy(busy) {
        for (const input of document.querySelectorAll(CONTROLS))
            input.disabled = busy;
        if (!busy) preview();
    }

    async function sendCommand() {
        await transport.send(
            commandPackets(),
            message(`send.command.${byId("command").value}`),
        );
        notice(message("send.written"));
    }

    async function sendRaw() {
        const steps = parseRawSequence(byId("raw-hex").value),
            { generation, job } = transport;
        await transport.sendSequence(steps, message("tx.rawLines"));
        if (generation !== transport.generation || job !== transport.job)
            return;
        const packets = steps.filter((step) => step.bytes).length;
        notice(message("send.rawDone", { count: packets }));
    }

    async function cancel() {
        if (!(await cancelPlayback())) transport.cancel();
        book.record({
            source: "workbench",
            label: message("log.sendCancelled"),
            message: message("log.gattIrrevocable"),
        });
        notice(message("send.cancelled"));
    }

    const onSubmit = (action) => (event) => {
        event.preventDefault();
        run(action)();
    };
    byId("send-form").addEventListener("input", preview);
    byId("send-form").addEventListener("change", preview);
    byId("send-form").addEventListener("submit", onSubmit(sendCommand));
    byId("raw-form").addEventListener("submit", onSubmit(sendRaw));
    byId("cancel-send").addEventListener("click", run(cancel));
    transport.addEventListener("pending", (e) => {
        byId("pending-tasks").value = e.detail.lines.join("\n");
    });
    preview();
    return { setBusy };
}
