import { CHARACTERISTIC, hex, SERVICE } from "../../core/ble/protocol.js";
import { bluetoothAccessError } from "../../core/ble/access.js";
import { MidiDecoder } from "../../core/ble/midi-decoder.js";
import { KeyState } from "../../core/keyboard/key-state.js";
import { ALL_NOTES } from "../../core/keyboard/layout.js";
import { message } from "../../core/message.js";
import { noteName } from "../../core/music.js";
import { integer } from "../../core/validate.js";
import { t, translate } from "../../i18n/i18n.js";
import { byId } from "../dom.js";
import { createKeyboard } from "../keyboard-view.js";

const isOffset = (value) =>
    Number.isInteger(value) && value >= -60 && value <= 67;

/**
 * Device tab: connection, live key view and first-key calibration.
 * onNote(event, receivedAt) receives note events that are not consumed by calibration;
 * onMappingChange() runs whenever the displayed key mapping may have changed.
 */
export function initDevicePage({
    transport,
    book,
    preferences,
    notice,
    run,
    onNote,
    onMappingChange,
}) {
    const decoder = new MidiDecoder(),
        keys = new KeyState(),
        keyNodes = createKeyboard(byId("keyboard"));
    const accessError = bluetoothAccessError({
        bluetooth: transport.bluetooth,
    });
    const showAccessHint = (value, error = false) => {
        const hint = byId("bluetooth-access");
        hint.textContent = translate(value);
        hint.hidden = !value;
        hint.classList.toggle("warning", error);
    };
    let lastOffset = 0,
        rxSequence = 0;
    const offsetKey = () => transport.device && `offset:${transport.device.id}`;
    const saveOffset = () => {
        if (offsetKey()) preferences.set(offsetKey(), keys.offset);
    };

    function render() {
        const positions = keys.positions,
            firstKey = 60 + keys.offset;
        for (const [note, node] of keyNodes) {
            const active = positions.has(note),
                pitch = note + keys.offset;
            const label = node.querySelector(".note");
            if (label) label.textContent = noteName(pitch);
            node.classList.toggle("active", active);
            node.setAttribute(
                "aria-label",
                t(active ? "device.key.pressed" : "device.key.released", {
                    note: noteName(pitch),
                    pitch,
                }),
            );
        }
        byId("pressed-count").textContent = String(positions.size);
        byId("offset").value = keys.offset;
        byId("calibration-status").textContent = keys.calibrating
            ? t("device.calibration.waiting")
            : t("device.calibration.current", {
                  note: noteName(firstKey),
                  pitch: firstKey,
              });
        byId("calibrate").textContent = t(
            keys.calibrating
                ? "device.calibration.cancel"
                : "device.calibration.start",
        );
        onMappingChange();
    }

    function setOffset(value) {
        keys.calibrating = false;
        keys.setOffset(integer(value, -60, 67, "offset"));
        saveOffset();
        lastOffset = keys.offset;
        render();
    }

    function showNote(event) {
        byId("last-note").textContent = event.noteName;
        byId("last-event").textContent = t(
            event.kind === "note-on"
                ? "device.lastEvent.on"
                : "device.lastEvent.off",
            {
                pitch: event.note,
            },
        );
        byId("last-velocity").textContent = event.velocity;
        byId("last-channel").textContent = event.channel;
        byId("range-warning").hidden = ALL_NOTES.has(event.note - keys.offset);
    }

    function receive(bytes) {
        const receivedAt = performance.now();
        const packetId = book.enabled
            ? crypto.randomUUID()
            : `unrecorded:${++rxSequence}`;
        const events = decoder.feed(bytes, {
            format: byId("rx-format").value,
            packetId,
        });
        book.record({
            direction: "RX",
            bytes,
            events,
            packetId,
            label: events.map((e) => e.kind).join(", "),
        });
        for (const event of events) {
            if (event.kind === "state")
                byId("last-event").textContent = t("device.lastEvent.state", {
                    state: event.state,
                    tick: event.tick,
                });
            if (event.kind !== "note-on" && event.kind !== "note-off") continue;
            const calibrating = keys.calibrating;
            keys.apply(event);
            if (lastOffset !== keys.offset) {
                lastOffset = keys.offset;
                saveOffset();
                book.record({
                    label: message("log.calibrated"),
                    message: message("log.offsetLocal", {
                        offset: keys.offset,
                    }),
                });
            }
            showNote(event);
            if (!calibrating) onNote(event, receivedAt);
        }
        if (book.enabled) byId("last-hex").textContent = hex(bytes);
        render();
    }

    function showConnection(detail) {
        const ready = detail.state === "ready",
            busy = detail.state === "choosing" || detail.state === "connecting";
        byId("status-dot").className = ready
            ? "ready"
            : detail.state === "error"
              ? "error"
              : "";
        byId("connection-text").textContent = t(
            ready
                ? "device.connection.ready"
                : detail.state === "choosing"
                  ? "device.connection.choosing"
                  : busy
                    ? "device.connection.busy"
                    : "device.connection.disconnected",
        );
        byId("connect").disabled = !!accessError || ready || busy;
        byId("reconnect").disabled =
            !!accessError || ready || busy || !transport.device;
        byId("disconnect").disabled = !ready && !busy;
        if ("name" in detail)
            byId("device-name").textContent =
                detail.name || t("device.unnamed");
        if (detail.properties) {
            const supported = Object.keys(detail.properties).filter(
                (key) => detail.properties[key],
            );
            byId("properties").textContent = t("device.technical.current", {
                properties: supported.join(" / "),
                mode:
                    detail.writeMode ?? message("device.technical.notWritable"),
            });
        }
    }

    function updateStatus(detail) {
        showConnection(detail);
        showAccessHint(
            detail.state === "error"
                ? detail.message
                : detail.state === "choosing"
                  ? message("device.bluetoothPermissionHint")
                  : accessError,
            detail.state === "error" || !!accessError,
        );
        if (detail.state === "ready") {
            const saved = Number(preferences.get(offsetKey()) ?? 0);
            setOffset(isOffset(saved) ? saved : 0);
            if (detail.model === "UNKNOWN") notice(detail.message);
        } else {
            keys.clear();
            decoder.reset();
            byId("properties").textContent = t("device.technical.none");
            render();
        }
        book.record({
            direction: detail.state === "error" ? "ERR" : "SYS",
            label: detail.state,
            message: detail.message,
            device: detail.name,
            properties: detail.properties,
            writeMode: detail.writeMode,
        });
    }

    transport.addEventListener("status", (e) => updateStatus(e.detail));
    transport.addEventListener("rx", (e) => receive(e.detail.bytes));
    book.addEventListener("capture", () => {
        if (!book.enabled)
            byId("last-hex").textContent = t("device.captureOff");
    });
    byId("connect").addEventListener("click", () => {
        transport
            .connect({ byName: byId("scan-filter").value === "name" })
            .catch((error) => {
                showAccessHint(error, true);
                notice(error, true);
            });
    });
    byId("reconnect").addEventListener("click", () => {
        transport.connect({ reconnect: true }).catch((error) => {
            showAccessHint(error, true);
            notice(error, true);
        });
    });
    byId("disconnect").addEventListener("click", () => transport.disconnect());
    byId("calibrate").addEventListener("click", () => {
        keys.calibrating = !keys.calibrating;
        render();
        book.record({
            source: "workbench",
            label: message(
                keys.calibrating
                    ? "log.calibrationWaiting"
                    : "log.calibrationCancelled",
            ),
        });
    });
    byId("apply-offset").addEventListener(
        "click",
        run(() => {
            setOffset(byId("offset").value);
            book.record({
                source: "workbench",
                label: message("log.manualOffset"),
                message: message("log.offsetLocal", { offset: keys.offset }),
            });
        }),
    );
    byId("reset-offset").addEventListener("click", () => {
        setOffset(0);
        book.record({ source: "workbench", label: message("log.offsetReset") });
    });
    byId("rx-format").addEventListener("change", () => {
        decoder.reset();
        keys.clear();
        render();
        book.record({
            source: "workbench",
            label: message("log.rxFormat"),
            message: byId("rx-format").value,
        });
    });

    byId("service-id").textContent = SERVICE;
    byId("characteristic-id").textContent = CHARACTERISTIC;
    byId("last-hex").textContent = t("device.captureOff");
    showConnection({ state: transport.state });
    showAccessHint(accessError, !!accessError);
    render();
    return { getOffset: () => keys.offset, setOffset };
}
